# Default Model Selection

**Priority:** P1
**Status:** ❌ Not started
**Issue:** [#6074](https://github.com/Kilo-Org/kilocode/issues/6074)

## Problem

When a new chat session is started, the model selector always shows `kilo/auto` regardless of:

- The user's configured default model (set in the CLI/backend)
- The model the user last used in a previous session

This means users who have a preferred model (e.g. Claude Opus) must re-select it every time they start a new session. The `kilo/auto` model is hardcoded as the default in the VS Code extension, bypassing the default model logic that already exists in the CLI backend.

## Expected Behavior (Mark's View)

The model used when starting a new session should follow this priority order:

1. **Last used model** — if the user previously selected a model in the extension, use that
2. **Backend default model** — if no last-used model is stored, fetch the default from the CLI backend (which already implements default model logic shared with the CLI and Roo-based extension)
3. **`kilo/auto`** — fall back to this only if neither of the above is available

The current behavior skips steps 1 and 2 entirely and always falls back to step 3.

## Scope

This spec covers two related but distinct issues:

1. **#6074 — Use correct default model**: The extension ignores the backend's configured default model and always starts with `kilo/auto`.
2. **#6211 — Remember last model choice**: The extension does not persist the user's last selected model across sessions.

Both must be fixed together to deliver correct behavior.

## Remaining Work

- Read the default model from the CLI backend when starting a new session instead of hardcoding `kilo/auto`
- When the user changes the model in the chat input, persist the choice to `vscode.ExtensionContext.globalState`
- When creating a new session, pre-populate the model selector with the last-used model (from `globalState`), falling back to the backend default, falling back to `kilo/auto`
- Existing in-progress sessions are unaffected — they keep their current model
- If the stored model is no longer available (provider disabled, model removed), fall back gracefully to the backend default

## Implementation Notes

- The backend already has correct default model logic — the extension just needs to query it rather than override it
- Model selection state is managed in the webview; persisting it requires a message from the webview to the extension host on each change
- On model change: webview posts a message → extension saves to `globalState.update('lastModel', modelId)`
- On new session: extension reads `globalState.get('lastModel')` and passes it as the initial model, or queries the backend default endpoint if not set
- The backend default can be retrieved from the existing providers/models API — check how the CLI and Roo extension resolve the default to replicate the same logic
