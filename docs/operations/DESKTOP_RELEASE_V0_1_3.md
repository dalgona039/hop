# Desktop Release v0.1.3 1-Pager

## Background

Windows still showed a blank secondary editor window after the first new-window fix. The stuck secondary WebView also blocked close, print, file open, and PDF flows because subsequent desktop IPC could not complete cleanly.

## Problem

The v0.1.2 release did not fully avoid Windows WebView2 deadlock or blank-window behavior when creating a second editor window.

## Goal

Release v0.1.3 with a narrower and more explicit secondary-window creation path: create editor WebViews off the command worker path and avoid cloning the primary Tauri window config for new editor windows.

## Non-goals

Do not change upstream `third_party/rhwp`, redesign the editor UI, alter release asset names, or rewrite existing release tags.

## Constraints

Use `pnpm`, keep the app version aligned with the release tag, preserve macOS, Windows, and Linux behavior, and avoid logging secrets or document contents.

## Implementation outline

Bump the root package, desktop package, Rust crate, Cargo lock entry, and Tauri config to `0.1.3`. Keep the Windows blank-window fix scoped to the Tauri desktop shell by running `create_editor_window` through a blocking worker and creating secondary WebViews with explicit URL, title, size, and minimum-size settings.

## Verification plan

Run focused desktop tests and Rust clippy before committing. After pushing `v0.1.3`, dispatch the desktop release workflow with `build_ref=v0.1.3`, `release_tag=v0.1.3`, all desktop platforms enabled, and draft release creation enabled.

## Rollback or recovery notes

If the release workflow fails before publishing, fix forward on `main` and create a new patch release. Do not move or reuse a published release tag unless explicitly approved.
