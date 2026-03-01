# Custom OpenAI-Compatible Provider UI

**Priority:** P1
**Status:** 🔨 Partial (assigned)
**Issue:** [#6163](https://github.com/Kilo-Org/kilocode/issues/6163)

## What Exists

The Settings → Providers tab shows the list of built-in providers and lets users enable/disable them and set API keys. There is no UI for adding custom OpenAI-compatible providers (e.g., Ollama, LM Studio, enterprise endpoints). Users must manually edit `opencode.json`.

The web/TUI app (`packages/app`) already has a full custom provider dialog (`dialog-custom-provider.tsx`) with form validation.

## Remaining Work

- Port the `DialogCustomProvider` component from `packages/app/src/components/dialog-custom-provider.tsx` to the extension's webview
- Add a "Add custom provider" button to the Providers tab in the Settings view
- The dialog should collect:
  - Provider ID (unique identifier)
  - Display name
  - Base URL (with format validation)
  - API key (supports `{env:VAR_NAME}` syntax)
  - One or more model entries (model ID + display name)
  - Optional: custom HTTP headers
- On save, write the new provider to the CLI config via the existing `handleUpdateConfig()` endpoint (HTTP POST to `/global/config`)
- Validate inputs before saving; show inline errors
- After adding, the new provider should appear in the providers list and its models should be available in the model selector

## Implementation Notes

- The backend plumbing already exists: `KiloProvider.handleUpdateConfig()` and the `/global/config` HTTP endpoint
- Auth for the new provider can be set via `/global/auth/set` endpoint
- Reference the web app implementation closely — do not duplicate validation logic differently
