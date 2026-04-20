# Desktop Release v0.1.2 1-Pager

## Background

HOP desktop now includes a Tauri updater path that reads GitHub's stable latest release manifest from `latest.json`. The release workflow must publish signed updater artifacts and stable installer assets.

## Problem

The next release needs to carry the updater implementation, use app version `0.1.2`, and be built from a matching `v0.1.2` tag so the updater cannot loop on a mismatched version.

## Goal

Commit the updater and release workflow changes, bump the desktop app version to `0.1.2`, tag the exact release commit as `v0.1.2`, push it, and start the GitHub desktop release workflow.

## Non-goals

Do not change upstream `third_party/rhwp`, rename release assets, or rewrite existing release history.

## Constraints

Use `pnpm`, preserve macOS, Windows, and Linux release paths, keep updater signing secrets out of logs and source, and build from the tag that matches `apps/desktop/src-tauri/tauri.conf.json`.

## Implementation outline

Bump the root, desktop package, Rust crate, Cargo lock package entry, and Tauri config versions to `0.1.2`. Commit only the release-related changes, create tag `v0.1.2`, push the branch and tag, then dispatch `.github/workflows/hop-desktop.yml` with `create_release=true` and `build_ref=v0.1.2`.

## Verification plan

Run focused desktop/studio tests, Rust clippy, release-mode Rust check, workflow YAML parsing, and an updater-artifact signing build before committing. After pushing, verify that the GitHub Actions run starts successfully.

## Rollback or recovery notes

If the workflow fails before a release is published, fix forward on `main`, create a new patch tag, and dispatch the workflow again. Do not move or reuse a published release tag unless explicitly approved.
