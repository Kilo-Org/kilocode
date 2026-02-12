# Investigation: VSCode Extension Integration Points for Autocomplete

This document captures every integration point between the autocomplete feature and the
VSCode extension infrastructure. It's intended for use when recreating the extension shell
in a standalone package.

---

## 1. package.json Contributions

### 1.1 Activation Events

```jsonc
// src/package.json lines 51-54
"activationEvents": [
  "onLanguage",       // activates for ANY language
  "onStartupFinished" // activates after startup completes
]
```

There are no autocomplete-specific activation events. Both events are general-purpose.

### 1.2 Commands

Commands declared in `src/package.json` `contributes.commands`:

| Command ID                                       | Title Key                                        | Registered in Code?                        |
| ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------ |
| `kilo-code.autocomplete.generateSuggestions`     | `%autocomplete.commands.generateSuggestions%`    | ✅ `src/services/autocomplete/index.ts:26` |
| `kilo-code.autocomplete.cancelSuggestions`       | `%autocomplete.commands.cancelSuggestions%`      | ❌ Never registered — placeholder          |
| `kilo-code.autocomplete.applyCurrentSuggestions` | `%autocomplete.commands.applyCurrentSuggestion%` | ❌ Never registered — placeholder          |
| `kilo-code.autocomplete.applyAllSuggestions`     | `%autocomplete.commands.applyAllSuggestions%`    | ❌ Never registered — placeholder          |
| `kilo-code.autocomplete.goToNextSuggestion`      | `%autocomplete.commands.goToNextSuggestion%`     | ❌ Never registered — placeholder          |
| `kilo-code.autocomplete.goToPreviousSuggestion`  | `%autocomplete.commands.goToPreviousSuggestion%` | ❌ Never registered — placeholder          |

Additional commands registered **programmatically** but NOT declared in package.json:

| Command ID                                                 | Registered in                                                                                 | Notes                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `kilo-code.autocomplete.reload`                            | `src/services/autocomplete/index.ts:16`                                                       | Reloads settings and model                  |
| `kilo-code.autocomplete.codeActionQuickFix`                | `src/services/autocomplete/index.ts:21`                                                       | No-op stub                                  |
| `kilo-code.autocomplete.showIncompatibilityExtensionPopup` | `src/services/autocomplete/index.ts:31`                                                       | Shows Copilot conflict dialog               |
| `kilo-code.autocomplete.disable`                           | `src/services/autocomplete/index.ts:36`                                                       | Disables autocomplete                       |
| `kilocode.autocomplete.inline-completion.accepted`         | `src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider.ts:313` | Telemetry callback when suggestion accepted |
| `kilo-code.jetbrains.getInlineCompletions`                 | `src/services/autocomplete/AutocompleteJetbrainsBridge.ts:289`                                | JetBrains bridge                            |

### 1.3 Keybindings

From `src/package.json` `contributes.keybindings`:

| Command                                                    | Key      | Mac     | When Clause                                                                                                                                                 |
| ---------------------------------------------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kilo-code.autocomplete.cancelSuggestions`                 | `Escape` | same    | `editorTextFocus && !editorTabMovesFocus && !inSnippetMode && kilocode.autocomplete.hasSuggestions`                                                         |
| `kilo-code.autocomplete.generateSuggestions`               | `Ctrl+L` | `Cmd+L` | `editorTextFocus && !editorTabMovesFocus && !inSnippetMode && kilocode.autocomplete.enableSmartInlineTaskKeybinding && !github.copilot.completions.enabled` |
| `kilo-code.autocomplete.showIncompatibilityExtensionPopup` | `Ctrl+L` | `Cmd+L` | `editorTextFocus && !editorTabMovesFocus && !inSnippetMode && kilocode.autocomplete.enableSmartInlineTaskKeybinding && github.copilot.completions.enabled`  |

**Note**: The `Escape` keybinding references `kilocode.autocomplete.hasSuggestions` which is
**never set** in code via `setContext`. This means the keybinding is currently inert
(would never activate).

### 1.4 Menus

There are **no menu contributions** for autocomplete commands. The autocomplete commands
do not appear in any editor/context, view/title, or other menu.

### 1.5 Configuration Settings

There are **no VSCode `configuration` contributions** for autocomplete in `package.json`.
Autocomplete settings are stored entirely in VSCode global state via `ContextProxy` under
the key `ghostServiceSettings`, not as workspace/user settings.

### 1.6 Code Actions

From `src/package.json`:

```jsonc
"codeActions": [{
  "languages": ["*"],
  "providedCodeActionKinds": ["vscode.CodeActionKind.QuickFix"]
}]
```

This is a general declaration. The autocomplete-specific code action provider is registered
programmatically in `src/services/autocomplete/index.ts:42-46`:

```typescript
vscode.languages.registerCodeActionsProvider("*", autocompleteManager.codeActionProvider, {
	providedCodeActionKinds: Object.values(autocompleteManager.codeActionProvider.providedCodeActionKinds),
})
```

The `AutocompleteCodeActionProvider` (`src/services/autocomplete/AutocompleteCodeActionProvider.ts`)
provides a QuickFix action that triggers `kilo-code.autocomplete.generateSuggestions`.

---

## 2. Extension Activation & Service Initialization

### 2.1 Extension activation flow (`src/extension.ts`)

1. **Import**: `registerAutocompleteProvider` imported from `./services/autocomplete` (line 49)
2. **First-install defaults** (lines 400-414): On first install, autocomplete is enabled:
    ```typescript
    const currentAutocompleteSettings = contextProxy.getValue("ghostServiceSettings")
    await contextProxy.setValue("ghostServiceSettings", {
    	...currentAutocompleteSettings,
    	enableAutoTrigger: !kiloCodeWrapperJetbrains, // disabled for JetBrains
    	enableSmartInlineTaskKeybinding: true,
    })
    ```
3. **Registration** (lines 512-520): Autocomplete is registered unless running as CLI:
    ```typescript
    if (kiloCodeWrapperCode !== "cli") {
    	registerAutocompleteProvider(context, provider)
    }
    ```

### 2.2 `registerAutocompleteProvider` (`src/services/autocomplete/index.ts`)

This function:

1. Creates `AutocompleteServiceManager` singleton
2. Registers JetBrains bridge via `registerAutocompleteJetbrainsBridge`
3. Registers 5 commands (reload, codeActionQuickFix, generateSuggestions, showIncompatibilityExtensionPopup, disable)
4. Registers `CodeActionsProvider` for all languages (`"*"`)

### 2.3 `AutocompleteServiceManager` initialization

On construction (`src/services/autocomplete/AutocompleteServiceManager.ts:37-61`):

1. Creates `AutocompleteModel` for provider/model management
2. Creates `AutocompleteCodeActionProvider` for QuickFix code actions
3. Creates `AutocompleteInlineCompletionProvider` for inline completions
4. Calls `this.load()` to initialize

### 2.4 `load()` method

On load (`src/services/autocomplete/AutocompleteServiceManager.ts:70-99`):

1. Reads `ghostServiceSettings` from `ContextProxy`
2. Sets context key `kilocode.autocomplete.enableSmartInlineTaskKeybinding` via `setContext`
3. Registers/unregisters `InlineCompletionItemProvider` based on `enableAutoTrigger` state
4. Updates status bar
5. Writes enriched settings (with provider/model info) back to `ContextProxy`
6. Posts state to webview

---

## 3. Context Keys (setContext)

| Context Key                                             | Where Set                                                         | Purpose                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `kilocode.autocomplete.enableSmartInlineTaskKeybinding` | `AutocompleteServiceManager.updateGlobalContext()` (line 286-290) | Controls whether `Cmd+L` / `Ctrl+L` keybinding is active |
| `kilocode.autocomplete.hasSuggestions`                  | ❌ Never set                                                      | Would control `Escape` keybinding — currently dead code  |

---

## 4. Webview State Integration

### 4.1 State passing to webview (`src/core/webview/ClineProvider.ts`)

The `ghostServiceSettings` is destructured from global state and included in the
state object sent to the webview at:

- Line 2284: `ghostServiceSettings` extracted from state values
- Line 2480: `ghostServiceSettings: ghostServiceSettings` included in state to webview
- Line 2758: `ghostServiceSettings: stateValues.ghostServiceSettings` included in full state

### 4.2 Webview message handlers (`src/core/webview/webviewMessageHandler.ts`)

Three autocomplete-related message types are handled:

1. **`ghostServiceSettings`** (lines 1972-1982):

    ```typescript
    case "ghostServiceSettings":
      const validatedSettings = autocompleteServiceSettingsSchema.parse(message.values)
      await updateGlobalState("ghostServiceSettings", validatedSettings)
      await provider.postStateToWebview()
      vscode.commands.executeCommand("kilo-code.autocomplete.reload")
    ```

    This is the primary way the webview UI writes autocomplete settings.

2. **`snoozeAutocomplete`** (lines 1983-1989):

    ```typescript
    case "snoozeAutocomplete":
      if (typeof message.value === "number" && message.value > 0) {
        await AutocompleteServiceManager.getInstance()?.snooze(message.value)
      } else {
        await AutocompleteServiceManager.getInstance()?.unsnooze()
      }
    ```

3. **`requestChatCompletion`** (lines 3969-3975): Handles chat textarea FIM autocomplete.
4. **`chatCompletionAccepted`** (lines 3977-3979): Handles chat completion acceptance telemetry.

### 4.3 Autocomplete reload triggered from webview

The `kilo-code.autocomplete.reload` command is also triggered when API profiles change:

- `saveApiConfiguration` (line 2231)
- `upsertApiConfiguration` (lines 2294, 2303)
- `renameApiConfiguration` (line 2330)
- `deleteApiConfiguration` (line 2407)

---

## 5. Global State / ContextProxy

### 5.1 State key

The autocomplete feature uses a single global state key:

```
ghostServiceSettings: AutocompleteServiceSettings
```

Defined in `packages/types/src/global-settings.ts:230`:

```typescript
ghostServiceSettings: autocompleteServiceSettingsSchema
```

### 5.2 Schema (`packages/types/src/kilocode/kilocode.ts:9-19`)

```typescript
export const autocompleteServiceSettingsSchema = z
	.object({
		enableAutoTrigger: z.boolean().optional(),
		enableSmartInlineTaskKeybinding: z.boolean().optional(),
		enableChatAutocomplete: z.boolean().optional(),
		provider: z.string().optional(),
		model: z.string().optional(),
		snoozeUntil: z.number().optional(),
		hasKilocodeProfileWithNoBalance: z.boolean().optional(),
	})
	.optional()
```

### 5.3 Read/write patterns

- **Read**: `ContextProxy.instance.getGlobalState("ghostServiceSettings")`
- **Write**: `ContextProxy.instance.setValues({ ghostServiceSettings: ... })`
- **WebView write**: sends `{ type: "ghostServiceSettings", values: ... }` message

### 5.4 VSCode global state references

The key `ghostServiceSettings` is listed as a valid global state key for webview
communication in `packages/types/src/vscode-extension-host.ts:546` and `795`.

---

## 6. VSCode API Providers Registered

| Provider Type                  | Registration                                                              | Scope                                                |
| ------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `InlineCompletionItemProvider` | `AutocompleteServiceManager.updateInlineCompletionProviderRegistration()` | `{ scheme: "file" }` — only for file-based documents |
| `CodeActionsProvider`          | `src/services/autocomplete/index.ts:42`                                   | `"*"` — all languages                                |

The inline completion provider is conditionally registered/disposed based on
`enableAutoTrigger` and snooze state.

---

## 7. Status Bar

`AutocompleteStatusBar` (`src/services/autocomplete/AutocompleteStatusBar.ts`):

- Alignment: `vscode.StatusBarAlignment.Right`, priority 100
- Shows/hides based on `enableAutoTrigger` setting
- Displays completion count, cost, provider info, and snoozed state
- Uses `$(kilo-logo)` codicon (custom icon font)

---

## 8. i18n / Localization

### 8.1 Package NLS keys (`src/package.nls.json` and locale variants)

Keys used in `package.json` command titles:

| Key                                            | English Value                                  |
| ---------------------------------------------- | ---------------------------------------------- |
| `autocomplete.commands.generateSuggestions`    | Generate Suggested Edits                       |
| `autocomplete.commands.displaySuggestions`     | Display Suggested Edits                        |
| `autocomplete.commands.cancelSuggestions`      | Cancel Suggested Edits                         |
| `autocomplete.commands.applyCurrentSuggestion` | Apply Current Suggested Edit                   |
| `autocomplete.commands.applyAllSuggestions`    | Apply All Suggested Edits                      |
| `autocomplete.commands.goToNextSuggestion`     | Go To Next Suggestion                          |
| `autocomplete.commands.goToPreviousSuggestion` | Go To Previous Suggestion                      |
| `autocomplete.input.title`                     | Press 'Enter' to confirm or 'Escape' to cancel |
| `autocomplete.input.placeholder`               | Describe what you want to do...                |

Translated in 20+ locale files: `src/package.nls.{de,fr,es,it,ja,ko,nl,pl,pt-BR,ru,sk,cs,uk,zh-CN,zh-TW,ar,ca,hi,id,th,tr,vi}.json`.

### 8.2 Runtime i18n keys (src/i18n/locales/en/kilocode.json)

Namespace: `kilocode:autocomplete.*`

```jsonc
{
	"autocomplete": {
		"statusBar": {
			"enabled": "$(kilo-logo) Autocomplete",
			"snoozed": "snoozed",
			"warning": "$(warning) Autocomplete",
			"tooltip": {
				"basic": "Kilo Code Autocomplete",
				"disabled": "Kilo Code Autocomplete (disabled)",
				"noCredits": "...",
				"noUsableProvider": "...",
				"sessionTotal": "Session total cost:",
				"provider": "Provider:",
				"model": "Model:",
				"profile": "Profile: ",
				"defaultProfile": "Default",
				"completionSummary": "Performed {{count}} completions between {{startTime}} and {{endTime}}, for a total cost of {{cost}}.",
				"providerInfo": "Autocompletions provided by {{model}} via {{provider}}.",
			},
			"cost": {
				"zero": "$0.00",
				"lessThanCent": "<$0.01",
			},
		},
		"toggleMessage": "Kilo Code Autocomplete {{status}}",
		"progress": {
			"title": "Kilo Code",
			"analyzing": "Analyzing your code...",
			"generating": "Generating suggested edits...",
			"processing": "Processing suggested edits...",
			"showing": "Displaying suggested edits...",
		},
		"input": {
			"title": "Kilo Code: Quick Task",
			"placeholder": "e.g., 'refactor this function to be more efficient'",
		},
		"commands": {
			"generateSuggestions": "Kilo Code: Generate Suggested Edits",
			"displaySuggestions": "Display Suggested Edits",
			"cancelSuggestions": "Cancel Suggested Edits",
			"applyCurrentSuggestion": "Apply Current Suggested Edit",
			"applyAllSuggestions": "Apply All Suggested Edits",
			"category": "Kilo Code",
		},
		"codeAction": {
			"title": "Kilo Code: Suggested Edits",
		},
		"chatParticipant": {
			"fullName": "Kilo Code Agent",
			"name": "Agent",
			"description": "I can help you with quick tasks and suggested edits.",
		},
		"incompatibilityExtensionPopup": {
			"message": "The Kilo Code Autocomplete is being blocked by a conflict with GitHub Copilot. To fix this, you must disable Copilot's inline suggestions.",
			"disableCopilot": "Disable Copilot",
			"disableInlineAssist": "Disable Autocomplete",
		},
	},
}
```

Translated in all locale files under `src/i18n/locales/{locale}/kilocode.json`.

---

## 9. Telemetry Events

| Event                                        | Where Used                                                           |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `TelemetryEventName.INLINE_ASSIST_AUTO_TASK` | `AutocompleteServiceManager.codeSuggestion()`                        |
| `TelemetryEventName.GHOST_SERVICE_DISABLED`  | `AutocompleteServiceManager.disable()`                               |
| Accept suggestion telemetry                  | `AutocompleteInlineCompletionProvider` via accepted command callback |

---

## 10. Dependencies on Host Extension

The autocomplete service depends on:

1. **`ClineProvider`** — for `providerSettingsManager` (API provider configs), `postStateToWebview()`
2. **`ContextProxy`** — singleton for global state read/write
3. **`vscode.ExtensionContext`** — for `subscriptions` (disposable management), `globalState`
4. **Webview messaging** — bidirectional communication for settings changes
5. **Custom icon font** — `$(kilo-logo)` codicon from `assets/icons/kilo-icon-font.woff2`

---

## 11. Legacy: Ghost Service

The code refers to `ghostServiceSettings` and `GhostServiceManager` in
`src/services/ghost/` — this appears to be the original/predecessor copy.
The current active autocomplete uses `src/services/autocomplete/` which is
a refactored version. The `ghost` name persists in the global state key
`ghostServiceSettings` for backwards compatibility.

---

## 12. Summary: What a New Extension Would Need

To recreate the autocomplete as a standalone extension:

1. **package.json**: 6 declared commands + keybindings + code action declaration
2. **Activation**: `onLanguage` + `onStartupFinished`, register providers on activate
3. **Providers**: `InlineCompletionItemProvider` (file scheme), `CodeActionsProvider` (all langs)
4. **Context keys**: `kilocode.autocomplete.enableSmartInlineTaskKeybinding` (via setContext)
5. **Status bar**: Right-aligned status bar item with custom icon
6. **State**: Single `ghostServiceSettings` object in global state (or a new key)
7. **Webview communication**: Message types `ghostServiceSettings`, `snoozeAutocomplete`, `requestChatCompletion`, `chatCompletionAccepted`
8. **i18n**: ~10 NLS keys in package.nls.json + ~30 runtime keys in kilocode.json
9. **Telemetry**: 2 primary event types
