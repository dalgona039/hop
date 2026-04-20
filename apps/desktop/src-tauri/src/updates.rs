#[cfg(not(debug_assertions))]
use crate::state::AppState;
use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_updater::UpdaterExt;

pub fn install_startup_update_check(app: &AppHandle) {
    #[cfg(debug_assertions)]
    {
        let _ = app;
    }

    #[cfg(not(debug_assertions))]
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = check_and_install_update(app).await {
                eprintln!("[updater] update check failed: {error}");
            }
        });
    }
}

#[cfg(not(debug_assertions))]
async fn check_and_install_update(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };

    if has_dirty_documents(&app) {
        return Ok(());
    }

    let bytes = update.download(|_, _| {}, || {}).await?;

    if has_dirty_documents(&app) {
        return Ok(());
    }

    update.install(bytes)?;

    if !has_dirty_documents(&app) {
        app.restart();
    }

    Ok(())
}

#[cfg(not(debug_assertions))]
fn has_dirty_documents(app: &AppHandle) -> bool {
    app.state::<AppState>()
        .sessions
        .lock()
        .map(|sessions| sessions.has_dirty_sessions())
        .unwrap_or(true)
}
