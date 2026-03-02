# Remember Last Model Choice

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6211](https://github.com/Kilo-Org/kilocode/issues/6211)

## Problem

Every new session defaults to "Kilo: Auto" regardless of the user's previous model selection. Users who prefer a specific model must re-select it each time they start a new session.

## Remaining Work

- When the user changes the model selector in the chat input, persist the choice
- When creating a new session, pre-select the last-used model instead of the default
- Existing sessions are unaffected — they keep their model
- The persisted value should survive extension restarts (use `vscode.ExtensionContext.globalState`)

## Implementation Notes

- Model selection state is currently managed in the webview
- On model change: webview posts a message to the extension → extension saves to `globalState.update('lastModel', modelId)`
- On new session creation: extension reads `globalState.get('lastModel')` and passes it as the initial model to the session create request (or as a default in the webview's session context)
- If the stored model is no longer available (provider disabled, etc.), fall back to the default gracefully
