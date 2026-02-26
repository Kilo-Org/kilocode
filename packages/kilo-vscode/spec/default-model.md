# Default Model

**Issue:** [#6074](https://github.com/Kilo-Org/kilocode/issues/6074)

## Desired Behavior

The **default model** configured in Settings should be used as the starting model for every new session. The model selector in the chat input only affects the current session — it does not change the default.

### Settings

The Settings tab has a "Default model" picker (currently wired to the CLI backend config `model` field). Whatever model is selected there is the default for all new sessions.

### New Session

When a new session is created, the model selector is pre-populated with the default model from Settings. It is never hardcoded to `kilo/auto`.

### Model Selector in Chat Input

Changing the model in the chat input changes it **only for the current session**. It has no effect on future sessions. The default in Settings remains unchanged.

### No Persistence of Last-Used Model

The model selector does not remember the last-used model across sessions. Each new session starts fresh with the Settings default. (This is distinct from #6211, which proposes remembering last-used — that is out of scope here.)

## Current Behavior (Bug)

The extension hardcodes `kilo/auto` as the default and ignores the Settings default model entirely. The VS Code settings `kilo-code.new.model.providerID` / `kilo-code.new.model.modelID` exist but are not exposed in any UI. The CLI backend config `model` field (shown in the Settings tab) is also ignored for this purpose.
