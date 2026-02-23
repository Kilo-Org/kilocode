# File Permission Dialogs

Batch approval UI for file read operations.

## Location

Permissions are now rendered through kilo-ui's `DataProvider` pattern using `Dialog` + `BasicTool` + `data-component="permission-prompt"`. There is no standalone `BatchFilePermission.tsx` — the permission UI is integrated into the kilo-ui message rendering pipeline.

## Interactions

- Batch file read approval interface
- Per-file permission management
- Approve/deny multiple file read requests

## Suggested migration

**Reimplement?** Partial (UI can stay; semantics need remapping).

- Kilo CLI uses a permission-request queue (asked/replied) model; the extension host must translate Kilo CLI permission events into Kilo's existing approval UX per [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1).
- If Kilo CLI permission prompts are per-tool-call (not "batch per-file"), you may need to:
  - either keep a batch UI but respond to permissions one-by-one, or
  - simplify the UI to match Kilo CLI's permission granularity.
- Kilo CLI UI reference: permission prompt actions exist in [`packages/ui/src/components/message-part.tsx`](https://github.com/Kilo-Org/kilocode/blob/main/packages/ui/src/components/message-part.tsx:1).

## TODO: Render permissions inline instead of in a modal Dialog

Both the desktop app ([`packages/app/src/pages/session.tsx:2727-2774`](../../packages/app/src/pages/session.tsx:2727)) and the old extension render permission prompts **inline in the prompt area**, replacing the text input while a permission is pending. The current vscode rebuild uses a modal `Dialog` wrapper instead.

This should be changed to match the inline pattern:

- Render the `BasicTool` + `permission-prompt` block in the prompt dock area (where `PromptInput` sits), conditionally replacing the input when `permissions().length > 0`.
- Remove the `Dialog` / `useDialog()` wrapper.
- This also enables the prompt area to naturally block user input while permissions are pending, matching the app's `blocked()` memo pattern.
