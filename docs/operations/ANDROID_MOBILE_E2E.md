# Android Mobile E2E Checklist

## Preconditions

1. Android SDK/NDK/JDK is configured.
2. Android project is initialized.
3. Native URI bridge source is applied.

```bash
pnpm --filter hop-desktop tauri android init
pnpm run android:bridge:setup
pnpm run android:bridge:check
```

## Build And Launch

```bash
pnpm --filter hop-desktop tauri android dev
```

## Scenario 1: Metadata File Name Resolution

1. Open a `.hwp` file from an app that provides an opaque URI like `content://media/external/file/1023`.
2. Verify document title/status uses display name from metadata (not URI id).
3. Verify editing works without path-based errors.

Pass criteria:

- UI shows readable file name with `.hwp/.hwpx` extension.
- Document loads and page count is displayed.

## Scenario 2: Read-only URI Save Fallback

1. Open an attachment that is read-only (for example from mail/messenger).
2. Edit document and run Save.
3. Confirm writable target picker appears.
4. Pick a new URI and save.

Pass criteria:

- App does not crash on initial write failure.
- Save completes after selecting new writable URI.
- Dirty marker is cleared after save.

## Scenario 3: Large File Materialization

1. Open a large document (`>24MB`).
2. Confirm app still opens the file.
3. Confirm no freeze/OOM while loading.

Pass criteria:

- Load succeeds through cache materialization path.
- Editing and save still works for the opened document.

## Scenario 4: Lifecycle Recovery

1. Open document, make edits, do not save.
2. Send app to background.
3. Force reclaim (or kill process from recents).
4. Relaunch app.
5. Accept draft restore prompt.

Pass criteria:

- Restore prompt is shown.
- Restored content matches latest unsaved state.

## Scenario 5: Mobile Shell UX

1. Launch on phone-sized viewport.
2. Verify desktop menu/toolbar are hidden.
3. Verify bottom quick-action bar is visible.
4. Long-press on editor area.
5. Verify contextual action sheet appears.

Pass criteria:

- Mobile shell controls are visible and interactive.
- Long-press action sheet executes expected commands.

## Notes

- Generated Android files under `apps/desktop/src-tauri/gen/android` are not committed.
- Re-run setup/check scripts whenever Android project is regenerated.
