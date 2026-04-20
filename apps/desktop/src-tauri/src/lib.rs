mod commands;
#[cfg(target_os = "macos")]
mod menu;
mod pdf_export;
mod state;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod updates;
mod windows;

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

use commands::{
    commit_external_hwp_save,
    check_external_modification, close_document, create_document, create_editor_window,
    destroy_current_window, export_pdf, export_pdf_from_hwp_bytes, mark_document_dirty,
    mutate_document, open_document, open_document_with_bytes, open_document_with_payload,
    print_webview, query_document, render_page_svg, reveal_in_folder, save_document,
    save_document_as, save_hwp_bytes, take_pending_open_paths,
    export_hwp_bytes_for_external_save,
};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .enable_macos_default_menu(false)
        .manage(AppState::default())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
                let paths = document_paths_from_args(&args, &cwd);
                queue_open_paths(app, paths);
                let payload = serde_json::json!({ "args": args, "cwd": cwd });
                let _ = app.emit("hop-second-instance", payload);
            }));
    }

    let app = builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            menu::install(app)?;

            #[cfg(any(target_os = "windows", target_os = "linux"))]
            app.set_menu(tauri::menu::Menu::new(app)?)?;

            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            if let Some(window) = app.get_webview_window("main") {
                windows::install_editor_window_minimum(&window);
                windows::attach_document_drop_handler(app.handle(), &window);
            }

            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            updates::install_startup_update_check(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_document,
            create_editor_window,
            open_document,
            close_document,
            mark_document_dirty,
            save_document,
            save_document_as,
            render_page_svg,
            query_document,
            mutate_document,
            export_pdf,
            export_pdf_from_hwp_bytes,
            print_webview,
            destroy_current_window,
            open_document_with_bytes,
            open_document_with_payload,
            save_hwp_bytes,
            export_hwp_bytes_for_external_save,
            commit_external_hwp_save,
            check_external_modification,
            take_pending_open_paths,
            reveal_in_folder,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build HOP desktop app");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter_map(document_target_from_path)
                .collect();
            queue_open_paths(app, paths);
        }
    });
}

fn queue_open_paths(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    if let Ok(mut pending) = app.state::<AppState>().pending_open_paths.lock() {
        pending.extend(paths.iter().cloned());
    }

    let payload = serde_json::json!({ "paths": paths });
    if let Some(label) = crate::windows::target_window_label(app) {
        let _ = app.emit_to(label, "hop-open-paths", payload);
    } else {
        let _ = app.emit("hop-open-paths", payload);
    }
}

fn document_paths_from_args(args: &[String], cwd: &str) -> Vec<String> {
    args.iter()
        .filter_map(|arg| document_target_from_arg(arg, cwd))
        .collect()
}

fn document_target_from_arg(arg: &str, cwd: &str) -> Option<String> {
    if let Ok(url) = tauri::Url::parse(arg) {
        if url.scheme() == "content" {
            return document_target_from_content_uri(&url);
        }
        if let Ok(path) = url.to_file_path() {
            return document_target_from_path(path);
        }
    }

    let path = PathBuf::from(arg);
    let resolved = if path.is_absolute() {
        path
    } else {
        Path::new(cwd).join(path)
    };
    document_target_from_path(resolved)
}

fn document_target_from_content_uri(url: &tauri::Url) -> Option<String> {
    if !is_supported_document_target(url.path()) {
        return None;
    }
    Some(url.to_string())
}

fn document_target_from_path(path: PathBuf) -> Option<String> {
    let path_str = path.to_string_lossy().to_string();
    if !is_supported_document_target(&path_str) {
        return None;
    }
    Some(path_str)
}

fn is_supported_document_target(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let normalized = lower.split('?').next().unwrap_or(&lower);
    normalized.ends_with(".hwp") || normalized.ends_with(".hwpx")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_path_from_path_accepts_hwp_and_hwpx_case_insensitively() {
        assert!(document_target_from_path(PathBuf::from("/tmp/doc.hwp")).is_some());
        assert!(document_target_from_path(PathBuf::from("/tmp/doc.HWPX")).is_some());
    }

    #[test]
    fn document_path_from_path_rejects_other_extensions() {
        assert!(document_target_from_path(PathBuf::from("/tmp/doc.pdf")).is_none());
        assert!(document_target_from_path(PathBuf::from("/tmp/doc")).is_none());
    }

    #[test]
    fn document_path_from_arg_resolves_relative_paths_against_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy();
        let expected = dir.path().join("docs/sample.hwp");

        assert_eq!(
            document_target_from_arg("docs/sample.hwp", &cwd),
            Some(expected.to_string_lossy().to_string())
        );
    }

    #[test]
    fn document_path_from_arg_accepts_file_urls() {
        let path = std::env::temp_dir().join("sample.hwpx");
        let url = tauri::Url::from_file_path(&path).unwrap().to_string();

        assert_eq!(
            document_target_from_arg(&url, "/ignored"),
            Some(path.to_string_lossy().to_string())
        );
    }

    #[test]
    fn document_path_from_arg_accepts_supported_content_uris() {
        let uri = "content://com.example.documents/hwp/sample.hwp";

        assert_eq!(document_target_from_arg(uri, "/ignored"), Some(uri.to_string()));
    }

    #[test]
    fn document_path_from_arg_rejects_unsupported_content_uris() {
        let uri = "content://com.example.documents/notes/readme.txt";

        assert_eq!(document_target_from_arg(uri, "/ignored"), None);
    }

    #[test]
    fn document_paths_from_args_filters_unsupported_args() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy();
        let paths = document_paths_from_args(
            &[
                "first.hwp".to_string(),
                "notes.txt".to_string(),
                "second.HWPX".to_string(),
            ],
            &cwd,
        );

        assert_eq!(
            paths,
            vec![
                dir.path().join("first.hwp").to_string_lossy().to_string(),
                dir.path().join("second.HWPX").to_string_lossy().to_string()
            ]
        );
    }
}
