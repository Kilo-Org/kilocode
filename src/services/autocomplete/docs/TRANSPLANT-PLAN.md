# Transplant Plan: `src/services/autocomplete/` → standalone VS Code extension

## 1. Executive Summary

The `src/services/autocomplete/` module provides two autocomplete experiences:

1. **Inline code completion (ghost text)** via a VS Code [`vscode.InlineCompletionItemProvider`](src/services/autocomplete/docs/investigation-vscode-integration.md:245).
2. **Chat textarea autocomplete** for a webview chat input (optional), driven by webview messages ([`requestChatCompletion`](src/services/autocomplete/docs/investigation-vscode-integration.md:188)).

To transplant this module into a new VS Code extension, you can copy most of the directory tree as-is, but you must rebuild a small “host shell” around it:

- A VS Code extension activation/registration layer (commands, providers, status bar, context keys).
- A **settings/state store** that persists the autocomplete settings object.
- An **LLM provider abstraction** that supports streaming **FIM** (fill-in-the-middle) and streaming **chat completions**, plus model metadata and usage/cost reporting.
- A **file ignore / access control abstraction** (to replicate `.kilocodeignore` behavior and prevent sensitive files from being used).
- A **telemetry abstraction** for the events the module emits.
- (Optional) A webview messaging bridge if you want a UI for settings or chat textarea autocomplete.

This plan defines those interfaces and the minimum VS Code extension scaffolding required, without coupling the new extension to Kilo Code’s current provider implementations.

---

## 2. Interfaces to Implement

This section defines the abstract interfaces the transplanted module expects.

> Design principle: the autocomplete module should depend on small, stable interfaces and plain types, not the host extension’s internal classes.

### 2.1 `IAutocompleteLLMProvider` (LLM Provider Interface)

**Purpose**: Provide streaming LLM completions for both strategies:

- **FIM** (prefix + suffix → streamed insertion)
- **Chat completion** (system prompt + user prompt → streamed text and/or structured chunks)

The module currently routes these via [`AutocompleteModel.generateFimResponse()`](src/services/autocomplete/AutocompleteModel.ts:109) and [`AutocompleteModel.generateResponse()`](src/services/autocomplete/AutocompleteModel.ts:153).

#### Required API (proposed)

```ts
export interface AutocompleteUsage {
	cost: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
}

export interface AutocompleteModelInfo {
	providerId: string // stable identifier, e.g. openai, anthropic, custom
	providerDisplayName?: string // for status bar/UI
	modelId: string // stable model identifier
	modelDisplayName?: string
	supportsFim: boolean
}

export type ChatStreamChunk = { type: "text"; text: string } | { type: "usage"; usage: AutocompleteUsage }

export interface IAutocompleteLLMProvider {
	/**
	 * Returns the currently selected model/provider metadata.
	 * Used for status bar + telemetry context.
	 */
	getModelInfo(): AutocompleteModelInfo | undefined

	/**
	 * Whether the selected model supports FIM.
	 * Used to pick between FIM vs hole-filler strategy.
	 */
	supportsFim(): boolean

	/**
	 * Stream a FIM completion. The generator yields raw text chunks.
	 * Must be abortable.
	 */
	streamFim(params: {
		prefix: string
		suffix: string
		signal: AbortSignal
		requestId?: string
		onUsage?: (usage: AutocompleteUsage) => void
	}): AsyncGenerator<string>

	/**
	 * Stream a chat completion. The generator yields text chunks and MAY yield usage.
	 * Must be abortable.
	 */
	streamChat(params: {
		systemPrompt: string
		userPrompt: string
		signal: AbortSignal
		requestId?: string
	}): AsyncGenerator<ChatStreamChunk>
}
```

#### Where it is used

- Inline completion pipeline triggers either:
    - FIM flow via [`AutocompleteModel.generateFimResponse()`](src/services/autocomplete/AutocompleteModel.ts:109), or
    - Chat flow via [`AutocompleteModel.generateResponse()`](src/services/autocomplete/AutocompleteModel.ts:153).
- Strategy selection checks [`AutocompleteModel.supportsFim()`](src/services/autocomplete/AutocompleteModel.ts:98).

#### Notes / constraints

- **Streaming is mandatory**: the module assumes tokens/chunks arrive incrementally.
- **Abort is mandatory**: VS Code frequently cancels inline completion requests.
- **Usage/cost reporting** is needed for:
    - status bar display (session cost), and
    - telemetry properties (latency/cost/tokens).

---

### 2.2 `IAutocompleteProfileResolver` (Model selection + credentials)

**Purpose**: Choose which provider/model to use for autocomplete, and validate credentials.

In the current code, [`AutocompleteModel.reload()`](src/services/autocomplete/AutocompleteModel.ts:49) scans “profiles” from a settings manager and picks one (including special handling for the `kilocode` provider).

For a new extension, keep this logic but abstract it.

#### Required API (proposed)

```ts
export interface AutocompleteProfile {
	id: string
	name?: string
	type?: "autocomplete" | "general"
	providerId: string
	modelId: string
	// provider-specific credential payload is opaque to autocomplete
	credentials: unknown
}

export interface IAutocompleteProfileResolver {
	/** Return all configured profiles the host wants autocomplete to consider. */
	listProfiles(): Promise<AutocompleteProfile[]>

	/** Resolve the full profile (including credentials) for a selected profile id. */
	getProfile(id: string): Promise<AutocompleteProfile>

	/**
	 * Create an LLM provider instance for the selected profile.
	 * The autocomplete module treats the provider as opaque beyond the interface.
	 */
	buildLLMProvider(profile: AutocompleteProfile): Promise<IAutocompleteLLMProvider>
}
```

#### Where it is used

- Provider/model selection and (optional) credential checks happen in [`AutocompleteModel.reload()`](src/services/autocomplete/AutocompleteModel.ts:49).

---

### 2.3 `IAutocompleteSettingsStore` (Settings/State Manager)

**Purpose**: Persist and retrieve the autocomplete settings object.

The module currently uses a global state key named `ghostServiceSettings` via `ContextProxy` ([investigation](src/services/autocomplete/docs/investigation-vscode-integration.md:201)).

#### Settings schema (minimum)

From [`autocompleteServiceSettingsSchema`](src/services/autocomplete/docs/investigation-vscode-integration.md:216), the settings object is effectively:

```ts
export interface AutocompleteServiceSettings {
	enableAutoTrigger?: boolean
	enableSmartInlineTaskKeybinding?: boolean
	enableChatAutocomplete?: boolean
	provider?: string
	model?: string
	snoozeUntil?: number
	hasKilocodeProfileWithNoBalance?: boolean
}
```

The host should own validation (zod or equivalent). The autocomplete module assumes the object exists or is `undefined`.

#### Required API (proposed)

```ts
export interface IAutocompleteSettingsStore {
	getSettings(): Promise<AutocompleteServiceSettings | undefined>
	setSettings(settings: AutocompleteServiceSettings | undefined): Promise<void>

	/** Optional: subscribe for settings changes coming from UI/webview. */
	onDidChangeSettings?(listener: (s: AutocompleteServiceSettings | undefined) => void): { dispose(): void }
}
```

#### Where it is used

- Read settings on startup in [`AutocompleteServiceManager.load()`](src/services/autocomplete/docs/investigation-vscode-integration.md:133).
- Write enriched settings back after load (same section).
- Webview can update settings by message type `ghostServiceSettings` ([`webviewMessageHandler`](src/services/autocomplete/docs/investigation-vscode-integration.md:164)).

---

### 2.4 `IFileIgnoreController` (File Ignore Controller)

**Purpose**: Decide whether the module may read/use a file path for context.

In current code this is `RooIgnoreController` (see mock interface in [`RooIgnoreController`](src/core/ignore/__mocks__/RooIgnoreController.ts:3)). It is used for:

- Filtering/snippet inclusion (only-my-code, ignore patterns)
- Visible editor context filtering

#### Required API (proposed)

```ts
export interface IFileIgnoreController {
	initialize(): Promise<void>

	/** True if the file can be read/used as context. */
	validateAccess(filePath: string): boolean

	/** Filter a list of candidate paths to those allowed. */
	filterPaths(paths: string[]): string[]

	/** Optional: returns user-facing instructions explaining why access is restricted. */
	getInstructions(): string | undefined

	dispose(): void
}
```

#### Where it is used

- Inline completion gating checks include ignore validation ([architecture summary](src/services/autocomplete/docs/investigation-internal-architecture.md:161)).
- Visible editor context is filtered in [`VisibleCodeTracker`](src/services/autocomplete/docs/investigation-internal-architecture.md:339).

---

### 2.5 `IDE` / `VsCodeIde` (IDE Abstraction)

**Purpose**: Provide an IDE-agnostic layer used by the embedded Continue.dev fork.

The continuedev core defines an `IDE` interface in [`continuedev/core/index.d.ts`](src/services/autocomplete/continuedev/core/index.d.ts:376) and ships a VS Code implementation [`VsCodeIde`](src/services/autocomplete/continuedev/core/vscode-test-harness/src/VSCodeIde.ts:1).

#### Minimum needed methods

The module’s autocomplete pipeline uses the `IDE` abstraction for:

- Workspace discovery, reading and writing files
- Open/current file content
- LSP calls (definitions, references, symbols)
- Clipboard access
- Editor-change callback

The authoritative method list is the `IDE` interface in [`IDE`](src/services/autocomplete/continuedev/core/index.d.ts:376). For transplantation you have two viable options:

1. **Copy and keep `VsCodeIde`** as-is, and keep the `IDE` interface unchanged.
2. Replace with your own implementation, but it must still satisfy the `IDE` interface contract.

---

### 2.6 `ITelemetryClient` (Telemetry Interface)

**Purpose**: Record the module’s key product events.

Current code uses a singleton `TelemetryService` ([`AutocompleteTelemetry`](src/services/autocomplete/classic-auto-complete/AutocompleteTelemetry.ts:57)). To transplant cleanly, replace it with an injected interface.

#### Events currently captured

From [`AutocompleteTelemetry`](src/services/autocomplete/classic-auto-complete/AutocompleteTelemetry.ts:105):

- `AUTOCOMPLETE_SUGGESTION_REQUESTED`
- `AUTOCOMPLETE_SUGGESTION_FILTERED`
- `AUTOCOMPLETE_SUGGESTION_CACHE_HIT`
- `AUTOCOMPLETE_LLM_SUGGESTION_RETURNED`
- `AUTOCOMPLETE_LLM_REQUEST_COMPLETED`
- `AUTOCOMPLETE_LLM_REQUEST_FAILED`
- `AUTOCOMPLETE_ACCEPT_SUGGESTION`
- `AUTOCOMPLETE_UNIQUE_SUGGESTION_SHOWN`

Additional events mentioned in integration doc:

- `INLINE_ASSIST_AUTO_TASK`
- `GHOST_SERVICE_DISABLED`

See telemetry summary in [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:357).

#### Required API (proposed)

```ts
export type TelemetryEventName = string

export interface ITelemetryClient {
	captureEvent(event: TelemetryEventName, properties?: Record<string, unknown>): void
}
```

#### Where it is used

- Inline completion telemetry: [`AutocompleteTelemetry`](src/services/autocomplete/classic-auto-complete/AutocompleteTelemetry.ts:57)
- Service-level disable / code-suggestion telemetry: referenced in [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:357)

---

### 2.7 `IWebviewBridge` (Optional)

**Purpose**: If your new extension has a settings UI and/or chat panel, you need a bridge for messages.

Current integration uses `ClineProvider` for posting state and receiving messages (see host dependencies list in [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:367)).

Minimum message types used by autocomplete (optional but defined):

- `ghostServiceSettings` (write settings)
- `snoozeAutocomplete`
- `requestChatCompletion`
- `chatCompletionAccepted`

If you are not building a webview, you can skip this and omit `chat-autocomplete/` entirely.

---

## 3. VSCode Extension Shell

This section describes what the new extension must contribute to make the module functional.

### 3.1 `package.json`

#### 3.1.1 Activation events

Current Kilo Code activates broadly:

- `onLanguage`
- `onStartupFinished`

See [`src/package.json` snippet in investigation](src/services/autocomplete/docs/investigation-vscode-integration.md:13).

For a standalone extension you can keep these, or narrow them (e.g. only `onStartupFinished`).

#### 3.1.2 Commands

Commands declared in Kilo Code’s `package.json` (some are placeholders):

- `kilo-code.autocomplete.generateSuggestions` (registered)
- `kilo-code.autocomplete.cancelSuggestions` (declared, not registered)
- `kilo-code.autocomplete.applyCurrentSuggestions` (declared, not registered)
- `kilo-code.autocomplete.applyAllSuggestions` (declared, not registered)
- `kilo-code.autocomplete.goToNextSuggestion` (declared, not registered)
- `kilo-code.autocomplete.goToPreviousSuggestion` (declared, not registered)

See command table in [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:23).

Commands registered programmatically (must be declared if you want them visible/consistent):

- `kilo-code.autocomplete.reload` ([`index.ts`](src/services/autocomplete/docs/investigation-vscode-integration.md:117))
- `kilo-code.autocomplete.codeActionQuickFix` (stub)
- `kilo-code.autocomplete.showIncompatibilityExtensionPopup`
- `kilo-code.autocomplete.disable`
- `kilocode.autocomplete.inline-completion.accepted` (acceptance callback)
- `kilo-code.jetbrains.getInlineCompletions` (JetBrains bridge)

Recommendation for the new extension:

- Keep only the commands you truly support.
- If you do not implement “suggested edits” UX, you can drop `apply*` and `goTo*` placeholders.

#### 3.1.3 Keybindings

Kilo Code binds:

- `Escape` → cancel suggestions (but depends on a context key that is never set)
- `Ctrl+L` / `Cmd+L` → generate suggestions (with Copilot conflict split)

See keybindings in [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:47).

Recommendation:

- Only contribute keybindings once you implement the associated command end-to-end.
- Ensure any context keys referenced in `when` clauses are actually set.

#### 3.1.4 Code actions

If you want the Quick Fix entry point (“Suggested edits”), keep:

- `contributes.codeActions` declaration
- Register a `CodeActionsProvider` programmatically (as Kilo Code does)

See code action registration in [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:72).

#### 3.1.5 Configuration contributions

Kilo Code does **not** contribute `configuration` settings; it stores everything in global state.

For a new extension you can choose either:

1. **Global state only** (closest transplant), or
2. **Real VS Code settings** (`contributes.configuration`) and have your settings store bridge to `workspace.getConfiguration`.

### 3.2 `extension.ts` (activation)

Minimum activation responsibilities:

1. Construct/inject dependencies:
    - `IAutocompleteSettingsStore`
    - `IAutocompleteProfileResolver` / `IAutocompleteLLMProvider`
    - `IFileIgnoreController` factory
    - `ITelemetryClient`
    - (optional) `IWebviewBridge`
2. Initialize ignore controller and settings defaults.
3. Create the autocomplete manager and register VS Code providers.

The current integration is via `registerAutocompleteProvider(context, provider)` (see activation notes in [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:98)).

Recommendation for transplant structure:

- Keep `src/services/autocomplete/index.ts` but change it to accept a dependency container instead of a `ClineProvider`.

---

## 4. External Dependencies (npm packages)

This list is derived from the external import investigation.

### 4.1 Direct dependencies (autocomplete module)

- `zod` (JetBrains bridge + continuedev adapters) ([imports list](src/services/autocomplete/docs/investigation-external-imports.md:240))
- `web-tree-sitter` (continuedev tree-sitter integration) ([imports list](src/services/autocomplete/docs/investigation-external-imports.md:252))
- `diff` (continuedev diff utilities) ([imports list](src/services/autocomplete/docs/investigation-external-imports.md:266))
- `fastest-levenshtein` (text similarity) ([imports list](src/services/autocomplete/docs/investigation-external-imports.md:273))
- `lru-cache` and `quick-lru` (caching) ([imports list](src/services/autocomplete/docs/investigation-external-imports.md:286))
- `ignore` (gitignore-like matching in continuedev) ([imports list](src/services/autocomplete/docs/investigation-external-imports.md:300))
- `js-tiktoken` (token counting) ([imports list](src/services/autocomplete/docs/investigation-external-imports.md:280))
- `uri-js` (URI parsing in `VSCodeIde`) ([imports list](src/services/autocomplete/docs/investigation-external-imports.md:313))

### 4.2 LLM SDKs (only if you keep continuedev’s provider adapters)

The continuedev fork includes many LLM adapters and imports these SDKs:

- `openai`
- `@anthropic-ai/sdk`
- `@aws-sdk/client-bedrock-runtime`
- `@aws-sdk/credential-providers`
- `google-auth-library`
- `dotenv`

See list in [`investigation-external-imports.md`](src/services/autocomplete/docs/investigation-external-imports.md:169).

If the new extension has its own LLM system, consider:

- either stripping unused continuedev adapters to reduce dependency footprint, or
- leaving them but ensuring they do not bloat the extension bundle (tree-shaking).

### 4.3 Tree-sitter WASM assets

You must ship tree-sitter WASM and query assets required by continuedev:

- `web-tree-sitter` expects parser initialization with a `.wasm` file.
- Language grammars are needed to parse various file types.
- Query files live under [`continuedev/tree-sitter/`](src/services/autocomplete/docs/investigation-internal-architecture.md:143) and should be copied.

Plan for the new extension:

- Bundle the wasm assets in your extension `dist` or `media` folder.
- Ensure runtime code can resolve them (using `ExtensionContext.extensionUri`).

---

## 5. Files to Copy As-Is

The following parts are designed to be largely self-contained (per architecture investigation):

### 5.1 Continue.dev fork (library)

Copy the entire directory:

- [`src/services/autocomplete/continuedev/`](src/services/autocomplete/continuedev/core/index.d.ts:1)

This includes context gathering, templating, postprocessing, tree-sitter queries, and utility helpers.

### 5.2 Inline completion implementation

Copy:

- `src/services/autocomplete/classic-auto-complete/` (all files)
- `src/services/autocomplete/context/` (visible code tracker)
- `src/services/autocomplete/types.ts`

### 5.3 VS Code UX helpers

Copy:

- `src/services/autocomplete/AutocompleteStatusBar.ts`
- `src/services/autocomplete/AutocompleteCodeActionProvider.ts`

### 5.4 Optional chat textarea autocomplete

Copy if you have a webview chat UI:

- `src/services/autocomplete/chat-autocomplete/`

---

## 6. Files Requiring Modification

Most modifications are to replace Kilo Code specific imports with the new interfaces.

### 6.1 `AutocompleteModel.ts`

File: [`AutocompleteModel`](src/services/autocomplete/AutocompleteModel.ts:26)

Why:

- Currently depends on `src/api` handlers and `ProviderSettingsManager`.
- Also depends on webview UI constant `PROVIDERS`.

Change plan:

- Replace `ProviderSettingsManager` usage with `IAutocompleteProfileResolver`.
- Replace `buildApiHandler` / `ApiHandler` / `FimHandler` with `IAutocompleteLLMProvider`.
- Replace `PROVIDERS` mapping with `providerDisplayName` from `AutocompleteModelInfo`.
- Keep the public surface area stable where possible:
    - `supportsFim()`
    - `generateFimResponse()`
    - `generateResponse()`
    - `getModelName()` / `getProviderDisplayName()`

### 6.2 `AutocompleteServiceManager.ts` and `index.ts`

Why:

- Current glue code expects `ContextProxy`, `ClineProvider`, and `TelemetryService`.

Change plan:

- Inject `IAutocompleteSettingsStore`, `ITelemetryClient`, ignore-controller factory.
- Replace any webview posting with an optional `IWebviewBridge`.
- Ensure `setContext` keys are correctly set (notably `kilocode.autocomplete.enableSmartInlineTaskKeybinding`, see [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:145)).

### 6.3 `types.ts`

Why:

- Imports `RooIgnoreController` directly.
- Exposes `AutocompleteContextProvider` referencing `VsCodeIde` and `AutocompleteModel`.

Change plan:

- Replace `RooIgnoreController` type with `IFileIgnoreController`.
- Keep `VsCodeIde` dependency if you keep continuedev’s VS Code harness; otherwise replace with your own `IDE` implementation.

### 6.4 `VisibleCodeTracker.ts`

Why:

- Depends on `RooIgnoreController` and path utils.

Change plan:

- Replace ignore controller import with `IFileIgnoreController`.
- Replace `toRelativePath` with an equivalent helper in the new extension.

### 6.5 JetBrains bridge

File: `src/services/autocomplete/AutocompleteJetbrainsBridge.ts`.

Why:

- Uses internal Kilo Code wrapper and webview provider.

Change plan:

- If the new extension does not support JetBrains, omit it.
- If you do, implement a dedicated transport layer; keep the bridge logic but replace:
    - `ClineProvider`
    - `getKiloCodeWrapperProperties`
    - any Kilo Code-specific types

---

## 7. i18n Setup

There are two separate i18n mechanisms involved.

### 7.1 `package.nls.json` (command titles)

Kilo Code’s `package.json` command titles reference NLS keys like:

- `autocomplete.commands.generateSuggestions`
- `autocomplete.commands.cancelSuggestions`
- …

See full list in [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:269).

Transplant options:

1. Reuse the same keys and provide at least `package.nls.json` (and optionally localized variants).
2. Rename keys and update command declarations accordingly.

### 7.2 Runtime `t()` keys (status bar/tooltips/progress)

Runtime strings are accessed via `t()` from `src/i18n` (Kilo Code).

Keys used live under namespace `kilocode:autocomplete.*` (see JSON excerpt in [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:287)).

Transplant plan:

- If the new extension already has i18n, add equivalent keys to its runtime translation system.
- Otherwise, simplest is:
    - implement a tiny `t(key, vars?)` function that maps to a JSON bundle.

Minimum runtime keys needed for feature completeness:

- status bar labels + tooltips (enabled/disabled/snoozed + provider/model + cost)
- progress titles (analyzing/generating/processing/showing)
- incompatibility popup text (if you keep Copilot conflict logic)

---

## 8. Webview Integration (Optional)

If you want a settings UI or chat panel, you need:

### 8.1 State shape

Expose `ghostServiceSettings` (or renamed equivalent) to the webview state.

See state passing described in [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:154).

### 8.2 Message types

Support these messages:

- `ghostServiceSettings` → validate + persist → trigger reload
- `snoozeAutocomplete` → snooze/unsnooze
- `requestChatCompletion` → call chat textarea autocomplete pipeline → respond `chatCompletionResult`
- `chatCompletionAccepted` → fire telemetry

The message handling mapping is documented in [`investigation-vscode-integration.md`](src/services/autocomplete/docs/investigation-vscode-integration.md:164).

---

## 9. MockTextDocument

The JetBrains bridge depends on `MockTextDocument` which is outside the autocomplete directory.

Copy:

- [`src/services/mocking/MockTextDocument.ts`](src/services/mocking/MockTextDocument.ts:1)

If you don’t transplant JetBrains support, you can skip this file.

---

## 10. Migration Checklist

Use this as the practical step-by-step transplant procedure.

### 10.1 Prepare new extension

1. Create a new VS Code extension repo (TypeScript).
2. Ensure build pipeline can bundle wasm assets.
3. Add required dependencies (Section 4).

### 10.2 Copy files

1. Copy `src/services/autocomplete/` directory into the new extension.
2. If supporting JetBrains bridge, also copy [`MockTextDocument`](src/services/mocking/MockTextDocument.ts:1).
3. Copy tree-sitter query assets under `continuedev/tree-sitter/`.

### 10.3 Implement host interfaces

1. Implement [`IAutocompleteSettingsStore`](src/services/autocomplete/docs/TRANSPLANT-PLAN.md:1) (this document) using either:
    - `ExtensionContext.globalState`, or
    - `workspace.getConfiguration`.
2. Implement [`IFileIgnoreController`](src/services/autocomplete/docs/TRANSPLANT-PLAN.md:1) (this document).
3. Implement [`ITelemetryClient`](src/services/autocomplete/docs/TRANSPLANT-PLAN.md:1) (this document).
4. Implement [`IAutocompleteProfileResolver`](src/services/autocomplete/docs/TRANSPLANT-PLAN.md:1) (this document).
5. Implement [`IAutocompleteLLMProvider`](src/services/autocomplete/docs/TRANSPLANT-PLAN.md:1) (this document) backed by the new extension’s LLM system.

### 10.4 Refactor autocomplete glue

1. Refactor [`AutocompleteModel`](src/services/autocomplete/AutocompleteModel.ts:26) to use the new LLM/provider resolver interfaces.
2. Refactor service initialization ([`AutocompleteServiceManager`](src/services/autocomplete/docs/investigation-vscode-integration.md:125)) to use the new settings/telemetry/ignore interfaces.
3. Refactor `index.ts` entry point to accept dependency injection rather than Kilo Code’s provider.

### 10.5 Wire VS Code extension shell

1. Implement activation in `extension.ts`:
    - instantiate dependencies
    - call `registerAutocompleteProvider(...)`
2. Add `package.json` contributions:
    - activation events
    - commands
    - keybindings (optional)
    - codeActions contribution (optional)
3. Ensure context keys used in `when` clauses are set via `vscode.commands.executeCommand("setContext", ...)`.

### 10.6 Validate runtime behavior

1. Inline completion:
    - confirm cancellation works
    - confirm debounce behavior
    - confirm suggestions appear only for allowed files
2. Status bar:
    - confirm provider/model shown
    - confirm cost increments
3. (Optional) Webview:
    - confirm settings update triggers reload
    - confirm chat textarea completion roundtrip works
