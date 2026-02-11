# Ghost → Autocomplete Rename Investigation

Investigation of all "ghost" references related to `src/services/ghost/` and its usage across the codebase.

---

## 1. Files in `src/services/ghost/`

### Root-level files

| File                         | Ghost-prefixed identifiers                                              | Rename?                          |
| ---------------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| `GhostCodeActionProvider.ts` | `GhostCodeActionProvider` class                                         | ✅ RENAME                        |
| `GhostJetbrainsBridge.ts`    | `GhostJetbrainsBridge` class, `registerGhostJetbrainsBridge()`          | ✅ RENAME                        |
| `GhostModel.ts`              | `GhostModel` class                                                      | ✅ RENAME                        |
| `GhostServiceManager.ts`     | `GhostServiceManager` class                                             | ✅ RENAME                        |
| `GhostStatusBar.ts`          | `GhostStatusBar` class                                                  | ✅ RENAME                        |
| `index.ts`                   | `registerGhostProvider()` export                                        | ✅ RENAME                        |
| `types.ts`                   | `GhostContextProvider`, `GhostSuggestionContext`, `extractPrefixSuffix` | ✅ RENAME (Ghost-prefixed types) |

### `classic-auto-complete/` subdirectory

| File                               | Ghost-prefixed identifiers                                                                                                  | Rename?                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `GhostInlineCompletionProvider.ts` | `GhostInlineCompletionProvider` class, `INLINE_COMPLETION_ACCEPTED_COMMAND` (`"kilocode.ghost.inline-completion.accepted"`) | ✅ RENAME                                          |
| `AutocompleteTelemetry.ts`         | No Ghost-prefix                                                                                                             | ✅ Rename file location only (move with directory) |
| `contextualSkip.ts`                | No Ghost-prefix                                                                                                             | ✅ Rename file location only                       |
| `FillInTheMiddle.ts`               | No Ghost-prefix                                                                                                             | ✅ Rename file location only                       |
| `getProcessedSnippets.ts`          | No Ghost-prefix                                                                                                             | ✅ Rename file location only                       |
| `HoleFiller.ts`                    | No Ghost-prefix                                                                                                             | ✅ Rename file location only                       |
| `uselessSuggestionFilter.ts`       | No Ghost-prefix                                                                                                             | ✅ Rename file location only                       |
| `language-filters/`                | No Ghost-prefix                                                                                                             | ✅ Rename file location only                       |

### `chat-autocomplete/` subdirectory

| File                              | Ghost-prefixed identifiers | Rename?                      |
| --------------------------------- | -------------------------- | ---------------------------- |
| `ChatTextAreaAutocomplete.ts`     | No Ghost-prefix            | ✅ Rename file location only |
| `handleChatCompletionAccepted.ts` | No Ghost-prefix            | ✅ Rename file location only |
| `handleChatCompletionRequest.ts`  | No Ghost-prefix            | ✅ Rename file location only |

### `context/` subdirectory

| File                    | Ghost-prefixed identifiers | Rename?                      |
| ----------------------- | -------------------------- | ---------------------------- |
| `VisibleCodeTracker.ts` | No Ghost-prefix            | ✅ Rename file location only |

### `utils/` subdirectory

| File                | Ghost-prefixed identifiers | Rename?                      |
| ------------------- | -------------------------- | ---------------------------- |
| `kilocode-utils.ts` | No Ghost-prefix            | ✅ Rename file location only |

### Test files in `__tests__/`

| File                                                                    | Rename?                 |
| ----------------------------------------------------------------------- | ----------------------- |
| `__tests__/GhostJetbrainsBridge.spec.ts`                                | ✅ RENAME               |
| `__tests__/GhostModel.spec.ts`                                          | ✅ RENAME               |
| `__tests__/GhostServiceManager.spec.ts`                                 | ✅ RENAME               |
| `__tests__/MockWorkspace.spec.ts`                                       | ✅ Rename location only |
| `__tests__/MockWorkspace.ts`                                            | ✅ Rename location only |
| `__tests__/MockWorkspaceEdit.ts`                                        | ✅ Rename location only |
| `chat-autocomplete/__tests__/ChatTextAreaAutocomplete.spec.ts`          | ✅ Rename location only |
| `classic-auto-complete/__tests__/AutocompleteTelemetry.test.ts`         | ✅ Rename location only |
| `classic-auto-complete/__tests__/contextualSkip.spec.ts`                | ✅ Rename location only |
| `classic-auto-complete/__tests__/GhostContextProvider.test.ts`          | ✅ RENAME               |
| `classic-auto-complete/__tests__/GhostInlineCompletionProvider.test.ts` | ✅ RENAME               |
| `classic-auto-complete/__tests__/HoleFiller.test.ts`                    | ✅ Rename location only |
| `classic-auto-complete/__tests__/uselessSuggestionFilter.test.ts`       | ✅ Rename location only |
| `context/__tests__/VisibleCodeTracker.spec.ts`                          | ✅ Rename location only |
| `utils/kilocode-utils.test.ts`                                          | ✅ Rename location only |

---

## 2. Imports of ghost service

| File                                                        | Import                                                                                                               | Rename?                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `src/extension.ts:49`                                       | `import { registerGhostProvider } from "./services/ghost"`                                                           | ✅ RENAME import path + symbol |
| `src/core/webview/webviewMessageHandler.ts:93`              | `import { GhostServiceManager } from "../../services/ghost/GhostServiceManager"`                                     | ✅ RENAME                      |
| `src/core/webview/webviewMessageHandler.ts:94`              | `import { handleChatCompletionRequest } from "../../services/ghost/chat-autocomplete/handleChatCompletionRequest"`   | ✅ RENAME path                 |
| `src/core/webview/webviewMessageHandler.ts:95`              | `import { handleChatCompletionAccepted } from "../../services/ghost/chat-autocomplete/handleChatCompletionAccepted"` | ✅ RENAME path                 |
| `src/core/webview/sttHandlers.ts:7`                         | `import { VisibleCodeTracker } from "../../services/ghost/context/VisibleCodeTracker"`                               | ✅ RENAME path                 |
| `src/test-llm-autocompletion/utils.ts:1`                    | `import { GhostSuggestionContext } from "../services/ghost/types.js"`                                                | ✅ RENAME                      |
| `src/test-llm-autocompletion/mock-context-provider.ts:1-9`  | Multiple imports from `../services/ghost/`                                                                           | ✅ RENAME                      |
| `src/test-llm-autocompletion/ghost-provider-tester.ts:2-14` | Multiple imports from `../services/ghost/`                                                                           | ✅ RENAME file + imports       |

---

## 3. VS Code Command IDs (`kilo-code.ghost.*`)

| Command ID                                          | File(s)                                                                             | Rename?   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | --------- |
| `kilo-code.ghost.reload`                            | `src/services/ghost/index.ts`, `src/core/webview/webviewMessageHandler.ts` (5 refs) | ✅ RENAME |
| `kilo-code.ghost.codeActionQuickFix`                | `src/services/ghost/index.ts`                                                       | ✅ RENAME |
| `kilo-code.ghost.generateSuggestions`               | `src/services/ghost/index.ts`, `src/package.json:257,447`                           | ✅ RENAME |
| `kilo-code.ghost.showIncompatibilityExtensionPopup` | `src/services/ghost/index.ts`, `src/package.json:453`                               | ✅ RENAME |
| `kilo-code.ghost.disable`                           | `src/services/ghost/index.ts`                                                       | ✅ RENAME |
| `kilo-code.ghost.cancelSuggestions`                 | `src/package.json:262,442`                                                          | ✅ RENAME |
| `kilo-code.ghost.applyCurrentSuggestions`           | `src/package.json:267`                                                              | ✅ RENAME |
| `kilo-code.ghost.applyAllSuggestions`               | `src/package.json:272`                                                              | ✅ RENAME |
| `kilo-code.ghost.goToNextSuggestion`                | `src/package.json:277`                                                              | ✅ RENAME |
| `kilo-code.ghost.goToPreviousSuggestion`            | `src/package.json:282`                                                              | ✅ RENAME |

### Command title NLS keys (`src/package.nls.json`)

| Key                                     | Value                                            | Rename?       |
| --------------------------------------- | ------------------------------------------------ | ------------- |
| `ghost.input.title`                     | "Press 'Enter' to confirm or 'Escape' to cancel" | ✅ RENAME key |
| `ghost.input.placeholder`               | "Describe what you want to do..."                | ✅ RENAME key |
| `ghost.commands.generateSuggestions`    | "Generate Suggested Edits"                       | ✅ RENAME key |
| `ghost.commands.displaySuggestions`     | "Display Suggested Edits"                        | ✅ RENAME key |
| `ghost.commands.cancelSuggestions`      | "Cancel Suggested Edits"                         | ✅ RENAME key |
| `ghost.commands.applyCurrentSuggestion` | "Apply Current Suggested Edit"                   | ✅ RENAME key |
| `ghost.commands.applyAllSuggestions`    | "Apply All Suggested Edits"                      | ✅ RENAME key |
| `ghost.commands.goToNextSuggestion`     | "Go To Next Suggestion"                          | ✅ RENAME key |
| `ghost.commands.goToPreviousSuggestion` | "Go To Previous Suggestion"                      | ✅ RENAME key |

---

## 4. Settings Storage Keys (Global State)

⚠️ **DO NOT RENAME - data persistence key**

| Key                    | Usage                                                                                                  | File(s)                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `ghostServiceSettings` | `ContextProxy.instance.getGlobalState("ghostServiceSettings")`                                         | `src/services/ghost/GhostServiceManager.ts:74,121` |
| `ghostServiceSettings` | `ContextProxy.instance.setValues({ ghostServiceSettings: ... })`                                       | `src/services/ghost/GhostServiceManager.ts:97`     |
| `ghostServiceSettings` | `updateGlobalState("ghostServiceSettings", ...)`                                                       | `src/core/webview/webviewMessageHandler.ts:1974`   |
| `ghostServiceSettings` | `contextProxy.getValue("ghostServiceSettings")` / `contextProxy.setValue("ghostServiceSettings", ...)` | `src/extension.ts:403-404`                         |
| `ghostServiceSettings` | Schema definition: `ghostServiceSettings: ghostServiceSettingsSchema`                                  | `packages/types/src/global-settings.ts:230`        |
| `ghostServiceSettings` | Default value: `ghostServiceSettings: {}`                                                              | `packages/types/src/global-settings.ts:390`        |

**Reason**: Renaming this key would break existing user settings stored in VS Code global state. A migration would be required. Keep as-is.

### Message type `"ghostServiceSettings"` (webview ↔ extension communication)

| File                                                  | Context                                                                       | Rename?                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/core/webview/webviewMessageHandler.ts:1968`      | `case "ghostServiceSettings":` message handler                                | 🔶 CONSIDER - this is a message type, not a storage key. Could be renamed if desired but must match both sides. |
| `webview-ui/src/components/settings/SettingsView.tsx` | `postMessage({ type: "ghostServiceSettings", values: ghostServiceSettings })` | 🔶 CONSIDER - must match handler                                                                                |

---

## 5. Telemetry Events

⚠️ **DO NOT RENAME — preserve analytics continuity**

| Event Name                                                               | File(s)                                                 | Rename?                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------ |
| `TelemetryEventName.GHOST_SERVICE_DISABLED` = `"Ghost Service Disabled"` | `packages/types/src/telemetry.ts:51` (definition)       | ⛔ DO NOT RENAME — preserve analytics continuity |
| `TelemetryEventName.GHOST_SERVICE_DISABLED`                              | `packages/types/src/telemetry.ts:238` (in schema)       | ⛔ DO NOT RENAME                                 |
| `TelemetryEventName.GHOST_SERVICE_DISABLED`                              | `src/services/ghost/GhostServiceManager.ts:130` (usage) | ⛔ DO NOT RENAME                                 |

---

## 6. i18n Translation Keys

### Backend i18n (`src/i18n/locales/`)

All locale files have a `"ghost"` top-level key in `kilocode.json`:

| Locale files                                                                                                  | Key prefix         | Rename?                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------- |
| `src/i18n/locales/{en,de,es,fr,it,ja,ko,nl,pl,pt-BR,ru,zh-CN,zh-TW,ar,ca,cs,hi,id,th,tr,uk,vi}/kilocode.json` | `"ghost": { ... }` | ✅ RENAME key namespace |

Keys used (from `GhostStatusBar.ts`, `GhostServiceManager.ts`, `GhostCodeActionProvider.ts`):

- `kilocode:ghost.statusBar.enabled`
- `kilocode:ghost.statusBar.warning`
- `kilocode:ghost.statusBar.snoozed`
- `kilocode:ghost.statusBar.cost.*`
- `kilocode:ghost.statusBar.tooltip.*`
- `kilocode:ghost.incompatibilityExtensionPopup.*`
- `kilocode:ghost.codeAction.title`

### Webview i18n (`webview-ui/src/i18n/locales/`)

All locale files have ghost keys in both `settings.json` and `kilocode.json`:

**`settings.json`** entries:

- `sections.ghost` - Tab label (e.g., "Autocomplete", "Ghost", "自动补全")
- `ghost: { ... }` - Settings section with all ghost-specific UI strings

**`kilocode.json`** entries:

- `ghost: { ... }` - Ghost-specific strings (title, settings labels, descriptions)

| Locale files                                  | Files affected                         | Rename?   |
| --------------------------------------------- | -------------------------------------- | --------- |
| `webview-ui/src/i18n/locales/*/settings.json` | `sections.ghost` key + `ghost` section | ✅ RENAME |
| `webview-ui/src/i18n/locales/*/kilocode.json` | `ghost` section                        | ✅ RENAME |

---

## 7. VS Code Context Keys (`kilocode.ghost.*`)

| Context Key                                      | File(s)                                                                         | Rename?   |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | --------- |
| `kilocode.ghost.hasSuggestions`                  | `src/package.json:444` (keybinding `when` clause)                               | ✅ RENAME |
| `kilocode.ghost.enableSmartInlineTaskKeybinding` | `src/package.json:450,456`, `src/services/ghost/GhostServiceManager.ts:288`     | ✅ RENAME |
| `kilocode.ghost.inline-completion.accepted`      | `src/services/ghost/classic-auto-complete/GhostInlineCompletionProvider.ts:172` | ✅ RENAME |

---

## 8. Type Definitions in Shared Packages

| File                                            | Identifier                                                            | Rename?                                                                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/types/src/kilocode/kilocode.ts:9`     | `ghostServiceSettingsSchema` (zod schema)                             | 🔶 CONSIDER - This is the schema name, not the storage key. Could be renamed. But since it maps to the `ghostServiceSettings` storage key, keeping alignment may be clearer. |
| `packages/types/src/kilocode/kilocode.ts:21`    | `GhostServiceSettings` type                                           | ✅ RENAME (this is a TypeScript type, no persistence concern)                                                                                                                |
| `packages/types/src/global-settings.ts:17`      | `import { ghostServiceSettingsSchema } from "./kilocode/kilocode.js"` | 🔶 Follows schema rename decision                                                                                                                                            |
| `packages/types/src/global-settings.ts:230`     | `ghostServiceSettings: ghostServiceSettingsSchema` (schema field)     | ⛔ DO NOT RENAME - field name is the storage key                                                                                                                             |
| `packages/types/src/__tests__/kilocode.test.ts` | Tests for `ghostServiceSettingsSchema`                                | 🔶 Follows schema rename decision                                                                                                                                            |

---

## 9. Webview Files Referencing Ghost

| File                                                                                  | Nature of reference                                                                                                                                   | Rename?                                                 |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `webview-ui/src/context/ExtensionStateContext.tsx`                                    | `GhostServiceSettings` type import, `ghostServiceSettings` state field, `setGhostServiceSettings` setter                                              | ✅ RENAME type; ⚠️ state field name maps to storage key |
| `webview-ui/src/components/settings/SettingsView.tsx`                                 | `GhostServiceSettingsView` component, `ghostServiceSettings` prop, `"ghost"` tab id, `t("kilocode:ghost.title")`                                      | ✅ RENAME component + tab id + i18n refs                |
| `webview-ui/src/components/kilocode/settings/GhostServiceSettings.tsx`                | `GhostServiceSettingsView` component, `GhostServiceSettingsViewProps` type, `GHOST_SERVICE_KEYBINDING_COMMAND_IDS`, many `t("kilocode:ghost.*")` refs | ✅ RENAME file + all identifiers                        |
| `webview-ui/src/components/kilocode/settings/__tests__/GhostServiceSettings.spec.tsx` | Tests for GhostServiceSettings                                                                                                                        | ✅ RENAME                                               |
| `webview-ui/src/components/chat/ChatTextArea.tsx`                                     | `useChatGhostText` hook import, `ghostServiceSettings`, `ghostText`, `handleGhostTextKeyDown`, etc.                                                   | ✅ RENAME hook + local variables                        |
| `webview-ui/src/components/chat/hooks/useChatGhostText.ts`                            | `useChatGhostText` hook, `ghostText` state, `clearGhostText`, `syncGhostTextVisibility`                                                               | ✅ RENAME file + identifiers                            |
| `webview-ui/src/components/chat/hooks/__tests__/useChatGhostText.spec.tsx`            | Tests for useChatGhostText                                                                                                                            | ✅ RENAME                                               |
| `webview-ui/src/components/ui/button.tsx`                                             | `variant: "ghost"` — **this is a shadcn/ui button variant, NOT related to ghost service**                                                             | ⛔ DO NOT RENAME - unrelated                            |
| Other webview files (ApiConfigSelector, TaskHeader, etc.)                             | Likely reference `ghostServiceSettings` state or `"ghost"` string in settings context                                                                 | ✅ RENAME where referring to ghost service              |

---

## 10. Test Files

### `src/services/ghost/__tests__/`

| Test file                      | Tests for                    | Rename?                 |
| ------------------------------ | ---------------------------- | ----------------------- |
| `GhostJetbrainsBridge.spec.ts` | `GhostJetbrainsBridge` class | ✅ RENAME               |
| `GhostModel.spec.ts`           | `GhostModel` class           | ✅ RENAME               |
| `GhostServiceManager.spec.ts`  | `GhostServiceManager` class  | ✅ RENAME               |
| `MockWorkspace.spec.ts`        | Mock workspace utilities     | ✅ Rename location only |
| `MockWorkspace.ts`             | Mock helper                  | ✅ Rename location only |
| `MockWorkspaceEdit.ts`         | Mock helper                  | ✅ Rename location only |

### `src/services/ghost/classic-auto-complete/__tests__/`

| Test file                               | Tests for               | Rename?                 |
| --------------------------------------- | ----------------------- | ----------------------- |
| `AutocompleteTelemetry.test.ts`         | Telemetry               | ✅ Rename location only |
| `contextualSkip.spec.ts`                | Contextual skip         | ✅ Rename location only |
| `GhostContextProvider.test.ts`          | Ghost context provider  | ✅ RENAME               |
| `GhostInlineCompletionProvider.test.ts` | Ghost inline completion | ✅ RENAME               |
| `HoleFiller.test.ts`                    | HoleFiller              | ✅ Rename location only |
| `uselessSuggestionFilter.test.ts`       | Filter                  | ✅ Rename location only |

### `src/services/ghost/chat-autocomplete/__tests__/`

| Test file                          | Rename?                 |
| ---------------------------------- | ----------------------- |
| `ChatTextAreaAutocomplete.spec.ts` | ✅ Rename location only |

### `src/services/ghost/context/__tests__/`

| Test file                    | Rename?                 |
| ---------------------------- | ----------------------- |
| `VisibleCodeTracker.spec.ts` | ✅ Rename location only |

### Other test files

| Test file                                       | Reference                               | Rename?                                                      |
| ----------------------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| `src/__tests__/extension.spec.ts:175,186`       | `ghostServiceSettings` in test fixtures | 🔶 Keep field name (storage key), rename if referencing type |
| `packages/types/src/__tests__/kilocode.test.ts` | Tests for `ghostServiceSettingsSchema`  | 🔶 Follows schema rename decision                            |

---

## 11. JetBrains Plugin References

| File                                                         | Reference                                                                          | Rename?                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------- |
| `jetbrains/.../ContextManager.kt:20-21,37`                   | Comments: `kilocode.ghost.enableQuickInlineTaskKeybinding`                         | ✅ RENAME (comments + key strings) |
| `jetbrains/.../InlineCompletionConstants.kt:14,16`           | `INLINE_COMPLETION_ACCEPTED_COMMAND = "kilocode.ghost.inline-completion.accepted"` | ✅ RENAME                          |
| `jetbrains/.../InlineCompletionService.kt:19`                | Comment: "Ghost service"                                                           | ✅ RENAME comment                  |
| `jetbrains/.../KiloCodeInlineCompletionProvider.kt:15-20,45` | Comments: "Ghost service" references                                               | ✅ RENAME comments                 |
| `jetbrains/.../SetContextCommands.kt:12,50-52,64`            | Comments: `GhostProvider`, `kilocode.ghost.*` keys                                 | ✅ RENAME                          |
| `jetbrains/.../ReflectUtilsStatusBarTest.kt:110-113`         | Test data: `"ghost-extension"`, `"ghost-status"`, `"Ghost Status"`, `"Ghost (5)"`  | ✅ RENAME test data                |

---

## 12. Test LLM Autocompletion Directory

| File                                                   | References                                                            | Rename?           |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ----------------- |
| `src/test-llm-autocompletion/ghost-provider-tester.ts` | File name + imports from ghost service                                | ✅ RENAME         |
| `src/test-llm-autocompletion/mock-context-provider.ts` | Imports `GhostContextProvider`, `GhostModel`, etc. from ghost service | ✅ RENAME imports |
| `src/test-llm-autocompletion/utils.ts`                 | Imports `GhostSuggestionContext`                                      | ✅ RENAME import  |

---

## Summary

### Categories of changes needed:

1. **Directory rename**: `src/services/ghost/` → `src/services/autocomplete/` (or similar)
2. **Class/type renames**: ~15 Ghost-prefixed classes/types
3. **VS Code command IDs**: ~10 `kilo-code.ghost.*` commands
4. **VS Code context keys**: 3 `kilocode.ghost.*` context keys
5. **i18n key namespaces**: `ghost.*` keys in ~22+ locale files (backend) + ~22+ locale files (webview) × 2 JSON files each
6. **NLS keys**: 9 `ghost.*` keys in `package.nls.json`
7. **Telemetry**: No changes — preserve analytics continuity
8. **Webview components**: ~6 files with Ghost-prefixed components/hooks
9. **JetBrains plugin**: ~6 files with ghost references
10. **Test files**: ~15+ test files to rename/update

### DO NOT RENAME (data persistence):

- **`ghostServiceSettings`** as a global state storage key (used in `getGlobalState`/`setValues`/`updateGlobalState`). This would require a data migration.
- **`variant: "ghost"`** in `button.tsx` — this is a shadcn/ui button variant, completely unrelated.

### Consider carefully:

- **`ghostServiceSettingsSchema`** Zod schema variable name — can be renamed since it's just TypeScript, but must keep the field name `ghostServiceSettings` in the global settings object.
- **`"ghostServiceSettings"` message type** — internal webview ↔ extension protocol, can be renamed if both sides are updated together.

---

## Execution Plan

This plan is split into two commits to preserve git rename tracking.

### Commit 1 — File/directory renames (git mv only, no content changes)

Run these commands in order. The directory rename moves all files; individual `git mv` commands below rename Ghost-prefixed files within the new directory.

```bash
# Step 1: Rename the top-level directory
git mv src/services/ghost src/services/autocomplete

# Step 2: Rename Ghost-prefixed files in src/services/autocomplete/
git mv src/services/autocomplete/GhostCodeActionProvider.ts src/services/autocomplete/AutocompleteCodeActionProvider.ts
git mv src/services/autocomplete/GhostJetbrainsBridge.ts src/services/autocomplete/AutocompleteJetbrainsBridge.ts
git mv src/services/autocomplete/GhostModel.ts src/services/autocomplete/AutocompleteModel.ts
git mv src/services/autocomplete/GhostServiceManager.ts src/services/autocomplete/AutocompleteServiceManager.ts
git mv src/services/autocomplete/GhostStatusBar.ts src/services/autocomplete/AutocompleteStatusBar.ts

# Step 3: Rename Ghost-prefixed files in classic-auto-complete/
git mv src/services/autocomplete/classic-auto-complete/GhostInlineCompletionProvider.ts src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider.ts

# Step 4: Rename Ghost-prefixed test files
git mv src/services/autocomplete/__tests__/GhostJetbrainsBridge.spec.ts src/services/autocomplete/__tests__/AutocompleteJetbrainsBridge.spec.ts
git mv src/services/autocomplete/__tests__/GhostModel.spec.ts src/services/autocomplete/__tests__/AutocompleteModel.spec.ts
git mv src/services/autocomplete/__tests__/GhostServiceManager.spec.ts src/services/autocomplete/__tests__/AutocompleteServiceManager.spec.ts
git mv src/services/autocomplete/classic-auto-complete/__tests__/GhostContextProvider.test.ts src/services/autocomplete/classic-auto-complete/__tests__/AutocompleteContextProvider.test.ts
git mv src/services/autocomplete/classic-auto-complete/__tests__/GhostInlineCompletionProvider.test.ts src/services/autocomplete/classic-auto-complete/__tests__/AutocompleteInlineCompletionProvider.test.ts

# Step 5: Rename Ghost-prefixed file in test-llm-autocompletion/
git mv src/test-llm-autocompletion/ghost-provider-tester.ts src/test-llm-autocompletion/autocomplete-provider-tester.ts

# Step 6: Rename Ghost-prefixed webview files
git mv webview-ui/src/components/kilocode/settings/GhostServiceSettings.tsx webview-ui/src/components/kilocode/settings/AutocompleteServiceSettings.tsx
git mv webview-ui/src/components/kilocode/settings/__tests__/GhostServiceSettings.spec.tsx webview-ui/src/components/kilocode/settings/__tests__/AutocompleteServiceSettings.spec.tsx
git mv webview-ui/src/components/chat/hooks/useChatGhostText.ts webview-ui/src/components/chat/hooks/useChatAutocompleteText.ts
git mv webview-ui/src/components/chat/hooks/__tests__/useChatGhostText.spec.tsx webview-ui/src/components/chat/hooks/__tests__/useChatAutocompleteText.spec.tsx
```

**Files that move with the directory rename (no further `git mv` needed):**

- `index.ts`, `types.ts` — move to `src/services/autocomplete/`
- `chat-autocomplete/` subdirectory — all files move as-is
- `classic-auto-complete/` subdirectory — non-Ghost-prefixed files move as-is (AutocompleteTelemetry.ts, contextualSkip.ts, FillInTheMiddle.ts, getProcessedSnippets.ts, HoleFiller.ts, uselessSuggestionFilter.ts, language-filters/)
- `context/` subdirectory — VisibleCodeTracker.ts moves as-is
- `utils/` subdirectory — kilocode-utils.ts moves as-is
- All `__tests__/` files without Ghost prefix move as-is

After running, verify with: `git status` and `git diff --staged --stat`

---

### Commit 2 — Content changes

#### 2.1 Class / Type / Interface renames

| Old name                                 | New name                               | File(s)                                                                                                                                                                              |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GhostCodeActionProvider`                | `AutocompleteCodeActionProvider`       | AutocompleteCodeActionProvider.ts, AutocompleteServiceManager.ts, AutocompleteServiceManager.spec.ts                                                                                 |
| `GhostJetbrainsBridge`                   | `AutocompleteJetbrainsBridge`          | AutocompleteJetbrainsBridge.ts, AutocompleteJetbrainsBridge.spec.ts                                                                                                                  |
| `GhostModel`                             | `AutocompleteModel`                    | AutocompleteModel.ts, AutocompleteModel.spec.ts, AutocompleteServiceManager.ts, AutocompleteServiceManager.spec.ts, FillInTheMiddle.ts, HoleFiller.ts, test-llm-autocompletion files |
| `GhostServiceManager`                    | `AutocompleteServiceManager`           | AutocompleteServiceManager.ts, AutocompleteServiceManager.spec.ts, index.ts, AutocompleteJetbrainsBridge.ts, webviewMessageHandler.ts, extension.ts                                  |
| `GhostStatusBar`                         | `AutocompleteStatusBar`                | AutocompleteStatusBar.ts, AutocompleteServiceManager.ts, AutocompleteServiceManager.spec.ts                                                                                          |
| `GhostInlineCompletionProvider`          | `AutocompleteInlineCompletionProvider` | AutocompleteInlineCompletionProvider.ts, AutocompleteInlineCompletionProvider.test.ts, AutocompleteServiceManager.ts, AutocompleteServiceManager.spec.ts                             |
| `GhostContextProvider`                   | `AutocompleteContextProvider`          | types.ts, FillInTheMiddle.ts, HoleFiller.ts, AutocompleteContextProvider.test.ts, test-llm-autocompletion/mock-context-provider.ts                                                   |
| `GhostSuggestionContext`                 | `AutocompleteSuggestionContext`        | types.ts, test-llm-autocompletion/utils.ts                                                                                                                                           |
| `GhostTabAutocompleteExtensions`         | `AutocompleteTabExtensions`            | types.ts                                                                                                                                                                             |
| `GhostPrompt`                            | `AutocompletePrompt`                   | types.ts, AutocompleteInlineCompletionProvider.ts                                                                                                                                    |
| `FimGhostPrompt`                         | `FimAutocompletePrompt`                | types.ts, FillInTheMiddle.ts                                                                                                                                                         |
| `HoleFillerGhostPrompt`                  | `HoleFillerAutocompletePrompt`         | types.ts, HoleFiller.ts                                                                                                                                                              |
| `GhostStatusBarStateProps`               | `AutocompleteStatusBarStateProps`      | types.ts, AutocompleteStatusBar.ts                                                                                                                                                   |
| `GhostServiceSettings` (TypeScript type) | `AutocompleteServiceSettings`          | packages/types/src/kilocode/kilocode.ts, all consumers                                                                                                                               |
| `GhostServiceSettingsView`               | `AutocompleteServiceSettingsView`      | AutocompleteServiceSettings.tsx, AutocompleteServiceSettings.spec.tsx, SettingsView.tsx                                                                                              |
| `GhostServiceSettingsViewProps`          | `AutocompleteServiceSettingsViewProps` | AutocompleteServiceSettings.tsx                                                                                                                                                      |
| `FimPromptBuilder`                       | No rename needed                       | (no Ghost prefix)                                                                                                                                                                    |

#### 2.2 Function / Variable renames

| Old name                                   | New name                                      | File(s)                                                                        |
| ------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------ |
| `registerGhostProvider`                    | `registerAutocompleteProvider`                | src/services/autocomplete/index.ts, src/extension.ts                           |
| `registerGhostJetbrainsBridge`             | `registerAutocompleteJetbrainsBridge`         | AutocompleteJetbrainsBridge.ts, index.ts                                       |
| `GHOST_SERVICE_KEYBINDING_COMMAND_IDS`     | `AUTOCOMPLETE_SERVICE_KEYBINDING_COMMAND_IDS` | AutocompleteServiceSettings.tsx                                                |
| `useChatGhostText`                         | `useChatAutocompleteText`                     | useChatAutocompleteText.ts, useChatAutocompleteText.spec.tsx, ChatTextArea.tsx |
| `ghostText` (local state in hook)          | `autocompleteText`                            | useChatAutocompleteText.ts, useChatAutocompleteText.spec.tsx, ChatTextArea.tsx |
| `clearGhostText` (hook method)             | `clearAutocompleteText`                       | useChatAutocompleteText.ts, ChatTextArea.tsx                                   |
| `syncGhostTextVisibility` (internal)       | `syncAutocompleteTextVisibility`              | useChatAutocompleteText.ts                                                     |
| `savedGhostTextRef` (internal)             | `savedAutocompleteTextRef`                    | useChatAutocompleteText.ts                                                     |
| `handleGhostTextKeyDown`                   | `handleAutocompleteTextKeyDown`               | ChatTextArea.tsx                                                               |
| `handleGhostTextInputChange`               | `handleAutocompleteTextInputChange`           | ChatTextArea.tsx                                                               |
| `handleGhostTextFocus`                     | `handleAutocompleteTextFocus`                 | ChatTextArea.tsx                                                               |
| `handleGhostTextBlur`                      | `handleAutocompleteTextBlur`                  | ChatTextArea.tsx                                                               |
| `handleGhostTextSelect`                    | `handleAutocompleteTextSelect`                | ChatTextArea.tsx                                                               |
| `setGhostServiceSettings` (context setter) | `setAutocompleteServiceSettings`              | ExtensionStateContext.tsx, SettingsView.tsx                                    |
| `setGhostServiceSettingsField` (local)     | `setAutocompleteServiceSettingsField`         | SettingsView.tsx                                                               |
| `onGhostServiceSettingsChange` (prop)      | `onAutocompleteServiceSettingsChange`         | AutocompleteServiceSettings.tsx, SettingsView.tsx                              |
| `defaultGhostServiceSettings` (test)       | `defaultAutocompleteServiceSettings`          | AutocompleteServiceSettings.spec.tsx                                           |

#### 2.3 VS Code command IDs

Update in `src/package.json`, `src/services/autocomplete/index.ts`, and all references:

| Old command ID                                      | New command ID                                             |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `kilo-code.ghost.reload`                            | `kilo-code.autocomplete.reload`                            |
| `kilo-code.ghost.codeActionQuickFix`                | `kilo-code.autocomplete.codeActionQuickFix`                |
| `kilo-code.ghost.generateSuggestions`               | `kilo-code.autocomplete.generateSuggestions`               |
| `kilo-code.ghost.showIncompatibilityExtensionPopup` | `kilo-code.autocomplete.showIncompatibilityExtensionPopup` |
| `kilo-code.ghost.disable`                           | `kilo-code.autocomplete.disable`                           |
| `kilo-code.ghost.cancelSuggestions`                 | `kilo-code.autocomplete.cancelSuggestions`                 |
| `kilo-code.ghost.applyCurrentSuggestions`           | `kilo-code.autocomplete.applyCurrentSuggestions`           |
| `kilo-code.ghost.applyAllSuggestions`               | `kilo-code.autocomplete.applyAllSuggestions`               |
| `kilo-code.ghost.goToNextSuggestion`                | `kilo-code.autocomplete.goToNextSuggestion`                |
| `kilo-code.ghost.goToPreviousSuggestion`            | `kilo-code.autocomplete.goToPreviousSuggestion`            |

**Note:** Also update keybinding references in AutocompleteServiceSettings.tsx that use `keybindings["kilo-code.ghost.generateSuggestions"]` and `openGlobalKeybindings("kilo-code.ghost.generateSuggestions")`.

#### 2.4 VS Code context keys

Update in `src/package.json` (keybinding `when` clauses) and source files:

| Old context key                                  | New context key                                         | File(s)                                                                      |
| ------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `kilocode.ghost.hasSuggestions`                  | `kilocode.autocomplete.hasSuggestions`                  | src/package.json (line 444), source files that set it                        |
| `kilocode.ghost.enableSmartInlineTaskKeybinding` | `kilocode.autocomplete.enableSmartInlineTaskKeybinding` | src/package.json (lines 450,456), AutocompleteServiceManager.ts              |
| `kilocode.ghost.inline-completion.accepted`      | `kilocode.autocomplete.inline-completion.accepted`      | AutocompleteInlineCompletionProvider.ts (INLINE_COMPLETION_ACCEPTED_COMMAND) |

#### 2.5 i18n keys — Backend (`src/i18n/locales/`)

In every locale's `kilocode.json` file (22 locales: en, de, es, fr, it, ja, ko, nl, pl, pt-BR, ru, zh-CN, zh-TW, ar, ca, cs, hi, id, th, tr, uk, vi):

- Rename top-level key `"ghost"` → `"autocomplete"`
- All nested keys stay the same (e.g., `statusBar.enabled`, `statusBar.warning`, etc.)
- This changes the i18n namespace from `kilocode:ghost.*` to `kilocode:autocomplete.*`

**All source files using `t("kilocode:ghost.…")` must be updated to `t("kilocode:autocomplete.…")`:**

- AutocompleteStatusBar.ts
- AutocompleteServiceManager.ts
- AutocompleteCodeActionProvider.ts

#### 2.6 i18n keys — Webview (`webview-ui/src/i18n/locales/`)

In every locale's files (same 22 locales):

**`settings.json`:**

- Rename `"sections"."ghost"` → `"sections"."autocomplete"`
- Rename top-level key `"ghost"` → `"autocomplete"` (if present)

**`kilocode.json`:**

- Rename top-level key `"ghost"` → `"autocomplete"`

**All source files using `t("kilocode:ghost.…")` or `t("settings:sections.ghost")` must be updated:**

- AutocompleteServiceSettings.tsx (many refs like `t("kilocode:ghost.title")`, `t("kilocode:ghost.settings.…")`)
- SettingsView.tsx (`t("kilocode:ghost.title")`)
- useKeybindings.ts (`t("kilocode:ghost.settings.keybindingNotFound")`)
- useKeybindings.spec.ts (same)

#### 2.7 package.nls.json / package.nls.\*.json

In `src/package.nls.json` and all 21 locale variants (`src/package.nls.{de,es,fr,it,ja,ko,nl,pl,pt-BR,ru,zh-CN,zh-TW,ar,ca,cs,hi,id,th,tr,uk,vi}.json`):

| Old NLS key                             | New NLS key                                    |
| --------------------------------------- | ---------------------------------------------- |
| `ghost.input.title`                     | `autocomplete.input.title`                     |
| `ghost.input.placeholder`               | `autocomplete.input.placeholder`               |
| `ghost.commands.generateSuggestions`    | `autocomplete.commands.generateSuggestions`    |
| `ghost.commands.displaySuggestions`     | `autocomplete.commands.displaySuggestions`     |
| `ghost.commands.cancelSuggestions`      | `autocomplete.commands.cancelSuggestions`      |
| `ghost.commands.applyCurrentSuggestion` | `autocomplete.commands.applyCurrentSuggestion` |
| `ghost.commands.applyAllSuggestions`    | `autocomplete.commands.applyAllSuggestions`    |
| `ghost.commands.goToNextSuggestion`     | `autocomplete.commands.goToNextSuggestion`     |
| `ghost.commands.goToPreviousSuggestion` | `autocomplete.commands.goToPreviousSuggestion` |

Also update `src/package.json` to reference the new NLS keys (e.g., `%autocomplete.commands.generateSuggestions%` instead of `%ghost.commands.generateSuggestions%`).

#### 2.8 Telemetry

**No changes** — telemetry event names (`GHOST_SERVICE_DISABLED`, `"Ghost Service Disabled"`) should NOT be renamed to preserve analytics continuity.

#### 2.9 Import path updates

Every file that imports from `services/ghost/` needs its import path updated to `services/autocomplete/`. Found references:

| File                                                          | Old import path                                                         | New import path                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/extension.ts`                                            | `"./services/ghost"`                                                    | `"./services/autocomplete"`                                                    |
| `src/core/webview/webviewMessageHandler.ts`                   | `"../../services/ghost/GhostServiceManager"`                            | `"../../services/autocomplete/AutocompleteServiceManager"`                     |
| `src/core/webview/webviewMessageHandler.ts`                   | `"../../services/ghost/chat-autocomplete/handleChatCompletionRequest"`  | `"../../services/autocomplete/chat-autocomplete/handleChatCompletionRequest"`  |
| `src/core/webview/webviewMessageHandler.ts`                   | `"../../services/ghost/chat-autocomplete/handleChatCompletionAccepted"` | `"../../services/autocomplete/chat-autocomplete/handleChatCompletionAccepted"` |
| `src/core/webview/sttHandlers.ts`                             | `"../../services/ghost/context/VisibleCodeTracker"`                     | `"../../services/autocomplete/context/VisibleCodeTracker"`                     |
| `src/test-llm-autocompletion/utils.ts`                        | `"../services/ghost/types.js"`                                          | `"../services/autocomplete/types.js"`                                          |
| `src/test-llm-autocompletion/mock-context-provider.ts`        | Multiple `../services/ghost/…` imports                                  | `../services/autocomplete/…`                                                   |
| `src/test-llm-autocompletion/autocomplete-provider-tester.ts` | Multiple `../services/ghost/…` imports                                  | `../services/autocomplete/…`                                                   |

Also update **intra-module** imports within `src/services/autocomplete/` that reference renamed files:

- `AutocompleteServiceManager.ts` → update `./GhostModel` to `./AutocompleteModel`, `./GhostStatusBar` to `./AutocompleteStatusBar`, etc.
- `index.ts` → update `./GhostServiceManager` to `./AutocompleteServiceManager`, etc.
- All test files' relative imports/mocks

#### 2.10 Webview references

| File                                                                             | Changes needed                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webview-ui/src/context/ExtensionStateContext.tsx`                               | Rename `GhostServiceSettings` type import to `AutocompleteServiceSettings`. Rename `setGhostServiceSettings` to `setAutocompleteServiceSettings`. **Keep `ghostServiceSettings` field name as-is** where it maps to the storage key.                                                                                                                 |
| `webview-ui/src/components/settings/SettingsView.tsx`                            | Update import from `GhostServiceSettings` to `AutocompleteServiceSettings`. Change tab id `"ghost"` to `"autocomplete"`. Update `t("kilocode:ghost.title")` to `t("kilocode:autocomplete.title")`. Update `setGhostServiceSettingsField` to `setAutocompleteServiceSettingsField`. Update `activeTab === "ghost"` to `activeTab === "autocomplete"`. |
| `webview-ui/src/components/settings/DisplaySettings.tsx`                         | Update `"ghostServiceSettings"` string in pick type if it refers to a display key (keep if it maps to the storage key)                                                                                                                                                                                                                               |
| `webview-ui/src/components/chat/ChatTextArea.tsx`                                | Update import from `useChatGhostText` to `useChatAutocompleteText`. Rename all `ghostText`, `handleGhostText*`, `clearGhostText` variables. Update comments from "ghost text" to "autocomplete text".                                                                                                                                                |
| `webview-ui/src/components/chat/__tests__/ChatTextArea.slash-tab-guard.spec.tsx` | Update comment references from "ghost" to "autocomplete"                                                                                                                                                                                                                                                                                             |
| `webview-ui/src/hooks/useKeybindings.ts`                                         | Update `t("kilocode:ghost.settings.keybindingNotFound")` → `t("kilocode:autocomplete.settings.keybindingNotFound")`                                                                                                                                                                                                                                  |
| `webview-ui/src/hooks/useKeybindings.spec.ts`                                    | Update expected string from `"kilocode:ghost.settings.keybindingNotFound"` → `"kilocode:autocomplete.settings.keybindingNotFound"`                                                                                                                                                                                                                   |

**Search settings IDs in AutocompleteServiceSettings.tsx:**

| Old settingId                        | New settingId                                                           |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `ghost-enable-auto-trigger`          | `autocomplete-enable-auto-trigger`                                      |
| `ghost-snooze`                       | `autocomplete-snooze`                                                   |
| `ghost-smart-inline-task-keybinding` | `autocomplete-smart-inline-task-keybinding`                             |
| `ghost-chat-autocomplete`            | `autocomplete-chat-autocomplete`                                        |
| `ghost-autocomplete-model`           | `autocomplete-autocomplete-model` (or simplify to `autocomplete-model`) |

Also update `section="ghost"` props to `section="autocomplete"`.

#### 2.11 JetBrains plugin

| File                                                | Changes                                                                                                                                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jetbrains/.../ContextManager.kt`                   | Update comments/strings: `kilocode.ghost.enableQuickInlineTaskKeybinding` → `kilocode.autocomplete.enableQuickInlineTaskKeybinding`                                                                      |
| `jetbrains/.../InlineCompletionConstants.kt`        | `INLINE_COMPLETION_ACCEPTED_COMMAND = "kilocode.ghost.inline-completion.accepted"` → `"kilocode.autocomplete.inline-completion.accepted"`                                                                |
| `jetbrains/.../InlineCompletionService.kt`          | Update comment "Ghost service" → "Autocomplete service"                                                                                                                                                  |
| `jetbrains/.../KiloCodeInlineCompletionProvider.kt` | Update comments "Ghost service" → "Autocomplete service"                                                                                                                                                 |
| `jetbrains/.../SetContextCommands.kt`               | Update comments: `GhostProvider` → `AutocompleteProvider`, `kilocode.ghost.*` → `kilocode.autocomplete.*`                                                                                                |
| `jetbrains/.../ReflectUtilsStatusBarTest.kt`        | Update test data strings: `"ghost-extension"` → `"autocomplete-extension"`, `"ghost-status"` → `"autocomplete-status"`, `"Ghost Status"` → `"Autocomplete Status"`, `"Ghost (5)"` → `"Autocomplete (5)"` |

#### 2.12 AGENTS.md

Update the line:

```
- `src/services/ghost/` - Ghost service
```

to:

```
- `src/services/autocomplete/` - Autocomplete service
```

#### 2.13 Shared types package (`packages/types/`)

| File                                            | Change                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/types/src/kilocode/kilocode.ts`       | Rename `ghostServiceSettingsSchema` → `autocompleteServiceSettingsSchema`. Rename `GhostServiceSettings` type → `AutocompleteServiceSettings`.                                                                                           |
| `packages/types/src/global-settings.ts`         | Update import to `autocompleteServiceSettingsSchema`. **Keep field name `ghostServiceSettings` in the schema object** (it's the storage key). Update default value comment.                                                              |
| `packages/types/src/__tests__/kilocode.test.ts` | Rename all `ghostServiceSettingsSchema` references to `autocompleteServiceSettingsSchema`. Update describe block name.                                                                                                                   |
| `packages/types/src/telemetry.ts`               | No changes to telemetry (see section 2.8).                                                                                                                                                                                               |
| `packages/types/src/vscode-extension-host.ts`   | The string `"ghostServiceSettings"` appears as a message type in union types. This is the **message type** (not the storage key) — rename to `"autocompleteServiceSettings"` and update both sides (extension handler + webview sender). |

#### 2.14 Message type rename (webview ↔ extension protocol)

The `"ghostServiceSettings"` message type is used in:

- `packages/types/src/vscode-extension-host.ts` (union type definitions, 2 occurrences)
- `src/core/webview/webviewMessageHandler.ts` (case handler)
- `webview-ui/src/components/settings/SettingsView.tsx` (postMessage sender)

Rename all occurrences: `"ghostServiceSettings"` → `"autocompleteServiceSettings"`

**This is separate from the global state storage key `ghostServiceSettings` which must NOT be renamed.**

---

### DO NOT RENAME checklist

These must remain unchanged:

1. ⛔ `ghostServiceSettings` as a **field name** in `globalSettingsSchema` (`packages/types/src/global-settings.ts:230`) — this is the global state storage key
2. ⛔ `ghostServiceSettings` as a **default value key** in `defaultGlobalSettings` (`packages/types/src/global-settings.ts:390`)
3. ⛔ `ghostServiceSettings` in `getGlobalState("ghostServiceSettings")`, `setValues({ ghostServiceSettings: … })`, `updateGlobalState("ghostServiceSettings", …)`, `contextProxy.getValue("ghostServiceSettings")`, `contextProxy.setValue("ghostServiceSettings", …)` — all storage access
4. ⛔ `ghostServiceSettings` field name in `ExtensionStateContext.tsx` state object and `SettingsView.tsx` cached state (maps to storage key)
5. ⛔ `variant: "ghost"` in `webview-ui/src/components/ui/button.tsx` — shadcn/ui button variant, unrelated
6. ⛔ `GHOST_SERVICE_DISABLED` enum member in `TelemetryEventName` (`packages/types/src/telemetry.ts:51`) — preserve analytics continuity
7. ⛔ `"Ghost Service Disabled"` string value in `TelemetryEventName.GHOST_SERVICE_DISABLED` (`packages/types/src/telemetry.ts:51`) — preserve analytics continuity
8. ⛔ Any `ghost` references not related to the autocomplete feature

### Verification steps

After both commits:

1. **Build check**: `pnpm build` — verify no TypeScript errors
2. **Lint check**: `pnpm lint`
3. **Type check**: `pnpm check-types`
4. **Backend tests**: `cd src && pnpm test services/autocomplete` — verify all moved tests pass
5. **Webview tests**: `cd webview-ui && pnpm test src/components/kilocode/settings/AutocompleteServiceSettings` and `cd webview-ui && pnpm test src/components/chat/hooks/useChatAutocompleteText`
6. **Types tests**: `cd packages/types && pnpm test`
7. **Grep verification**: `git grep -i "ghost" -- '*.ts' '*.tsx' '*.kt' '*.json' | grep -v "variant.*ghost" | grep -v "ghostServiceSettings" | grep -v "GHOST_SERVICE_DISABLED" | grep -v "Ghost Service Disabled" | grep -v node_modules` — should return zero results related to the autocomplete feature
8. **Extension smoke test**: Launch extension, open settings → "Autocomplete" tab, verify keybindings work, verify autocomplete suggestions trigger
