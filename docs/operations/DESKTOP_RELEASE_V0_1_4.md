# Desktop Release v0.1.4 1-Pager

## Background

The v0.1.3 build fixed Windows secondary-window creation, but resizing a Windows editor window could make the WebView contents shrink, repaint incorrectly, and eventually stop responding.

## Problem

The desktop shell was handling every native resize event by reapplying minimum size and sometimes calling `set_size`. On Windows, changing native window size while processing resize events can create a recursive resize/repaint loop.

## Goal

Release v0.1.4 with the resize-event size guard removed. The app should set minimum editor size once at window creation/setup time and let Tauri/OS constraints handle subsequent user resizing.

## Non-goals

Do not change upstream `third_party/rhwp`, redesign viewport rendering, rename release assets, or move existing release tags.

## Constraints

Use `pnpm`, keep the app version aligned with the release tag, preserve macOS, Windows, and Linux behavior, and keep `v0.1.3` as a historical tag while withdrawing the broken public release from latest.

## Implementation outline

Rename the size guard helper to an install-time minimum-size helper, remove the `WindowEvent::Resized` listener, and remove runtime `set_size` calls. Bump root, desktop package, Rust crate, Cargo lock entry, and Tauri config versions to `0.1.4`.

## Verification plan

Run focused desktop tests, Rust clippy, and diff checks before committing. After pushing `v0.1.4`, dispatch the desktop release workflow with `build_ref=v0.1.4`, `release_tag=v0.1.4`, all desktop platforms enabled, and release creation enabled.

## Rollback or recovery notes

If the workflow fails before publishing, fix forward with another patch version. Do not move or reuse a published release tag unless explicitly approved.
