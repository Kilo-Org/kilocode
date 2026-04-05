# Internal Architecture of the Autocomplete Module

> Investigation date: 2026-02-12  
> Scope: `src/services/autocomplete/` — all subdirectories and root-level files

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host                                             │
│                                                                      │
│  index.ts ─► registerAutocompleteProvider()                          │
│                  │                                                    │
│                  ▼                                                    │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  AutocompleteServiceManager  (singleton orchestrator)         │    │
│  │  • settings, status bar, cost tracking, snooze, commands      │    │
│  │  • owns AutocompleteModel + two completion strategies         │    │
│  └────┬─────────────────────┬──────────────────────┬────────────┘    │
│       │                     │                      │                 │
│       ▼                     ▼                      ▼                 │
│  ┌──────────┐   ┌─────────────────┐   ┌──────────────────────┐      │
│  │ Autocomplete│  │ Classic Auto-   │   │ Chat Text Area      │      │
│  │ Model       │  │ Complete        │   │ Autocomplete        │      │
│  │ (LLM layer) │  │ (inline ghosts) │   │ (webview chat)      │      │
│  └──────┬───┘   └──────┬──────────┘   └───────┬──────────────┘      │
│         │              │                       │                     │
│         │              ▼                       ▼                     │
│         │   ┌──────────────────────┐  ┌────────────────────┐        │
│         │   │ continuedev/ library │  │ context/           │        │
│         │   │ (forked Continue.dev)│  │ VisibleCodeTracker │        │
│         │   │                      │  └────────────────────┘        │
│         │   │ • context retrieval  │                                 │
│         │   │ • snippet gathering  │  ┌────────────────────┐        │
│         │   │ • prompt templating  │  │ utils/             │        │
│         │   │ • postprocessing     │  │ kilocode-utils.ts  │        │
│         │   │ • tree-sitter queries│  └────────────────────┘        │
│         │   │ • LLM providers      │                                 │
│         │   └──────────────────────┘                                 │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────────────┐               │
│  │  External: src/api/ (ApiHandler, FimHandler,      │               │
│  │  buildApiHandler, OpenRouterHandler, etc.)         │               │
│  └──────────────────────────────────────────────────┘               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 1. Root-Level Files

### [`index.ts`](../index.ts)

Entry point. Registers the `AutocompleteServiceManager`, JetBrains bridge, and all VS Code commands (`reload`, `generateSuggestions`, `disable`, `showIncompatibilityExtensionPopup`, code actions).

### [`AutocompleteServiceManager.ts`](../AutocompleteServiceManager.ts)

**Singleton orchestrator** for the entire module.

- Owns an [`AutocompleteModel`](../AutocompleteModel.ts) (LLM abstraction) and an [`AutocompleteInlineCompletionProvider`](../classic-auto-complete/AutocompleteInlineCompletionProvider.ts).
- Manages lifecycle: loads settings from `ContextProxy`, registers/unregisters the VS Code inline completion provider, handles snooze timers.
- Delegates manual "code suggestion" to the inline completion provider.
- Tracks session cost and completion count; forwards them to the status bar.

**External dependencies:**

- `vscode` API
- `@roo-code/types` (`AutocompleteServiceSettings`, `TelemetryEventName`)
- `@roo-code/telemetry` (`TelemetryService`)
- `../../core/config/ContextProxy`
- `../../core/webview/ClineProvider`
- `../../i18n` (`t()`)

### [`AutocompleteModel.ts`](../AutocompleteModel.ts)

**LLM abstraction layer** — bridges autocomplete requests to the Kilo Code API system.

- `reload(providerSettingsManager)`: Scans configured profiles to find a usable autocomplete provider. Supports dedicated `"autocomplete"` profiles and fallback to general profiles matching `AUTOCOMPLETE_PROVIDER_MODELS`.
- `supportsFim()`: Checks if the current API handler has a FIM endpoint.
- `generateFimResponse(prefix, suffix, onChunk)`: Streams a Fill-In-the-Middle completion via `FimHandler.streamFim()`.
- `generateResponse(system, user, onChunk)`: Streams a chat completion via `ApiHandler.createMessage()`.
- `hasValidCredentials()`, `getModelName()`, `getProviderDisplayName()`.

**External dependencies:**

- `../../api` (`ApiHandler`, `buildApiHandler`, `FimHandler`)
- `../../api/providers` (`OpenRouterHandler`, `KilocodeOpenrouterHandler`)
- `../../api/transform/stream` (`ApiStreamChunk`)
- `../../core/config/ProviderSettingsManager`
- `@roo-code/types` (`modelIdKeysByProvider`, `ProviderName`)
- `webview-ui/.../constants` (`PROVIDERS`)

### [`AutocompleteStatusBar.ts`](../AutocompleteStatusBar.ts)

VS Code status bar item showing autocomplete status (enabled/snoozed/disabled, model, cost).

### [`AutocompleteCodeActionProvider.ts`](../AutocompleteCodeActionProvider.ts)

VS Code code action provider (quick fix integration point).

### [`AutocompleteJetbrainsBridge.ts`](../AutocompleteJetbrainsBridge.ts)

Bridge for JetBrains IDE integration — proxies autocomplete requests from JetBrains to the classic auto-complete provider.

### [`types.ts`](../types.ts)

Central type definitions shared across subdirectories:

- `AutocompleteInput`, `AutocompleteOutcome`, `AutocompletePrompt` (discriminated union: `FimAutocompletePrompt | HoleFillerAutocompletePrompt`)
- `FillInAtCursorSuggestion`, `ResponseMetaData`, `CostTrackingCallback`
- `VisibleCodeContext`, `VisibleEditorInfo`, `VisibleRange`, `DiffInfo`
- `ChatCompletionRequest`, `ChatTextCompletionResult`
- Utility functions: `extractPrefixSuffix()`, `contextToAutocompleteInput()`

---

## 2. `continuedev/` — Forked Continue.dev Library

### Purpose

A **streamlined extraction** from the [Continue.dev](https://github.com/continuedev/continue) project, containing only autocomplete and NextEdit functionality. All GUI, chat, agents, and other features have been removed. It serves as a **TypeScript service library** providing:

1. **Autocomplete pipeline** — `CompletionProvider` orchestrates: prefiltering → context gathering → snippet retrieval → prompt templating → LLM streaming → stream filtering → postprocessing → caching.
2. **Context retrieval** — `ContextRetrievalService`, `ImportDefinitionsService`, `RootPathContextService`.
3. **Snippet gathering** — `getAllSnippets()` collects recently edited files, recently visited ranges, LSP definitions, clipboard, diffs.
4. **Prompt templating** — Model-specific FIM templates (`codestral`, `starcoder`, `deepseek`, etc.), prefix/suffix construction, token-limited rendering.
5. **Stream filtering** — `BracketMatchingService`, `charStream`/`lineStream` transforms, `StreamTransformPipeline`.
6. **Postprocessing** — bracket cleanup, `removePrefixOverlap`, completion formatting.
7. **Tree-sitter integration** — `.scm` query files for 15+ languages covering: code snippets, imports, root-path context, static context (hole/header/type queries), and tag queries.
8. **LLM providers** — `ILLM` interface with implementations for OpenAI, Mistral, OpenRouter, KiloCode, Mock.
9. **Diff engine** — Myers diff algorithm, streaming diff.
10. **Utility layer** — Token counting (llama tokenizer), LRU caching, logging service, debouncing, helper variables.

### Key Files

| File                                                                                                                                                                    | Role                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`core/index.d.ts`](../continuedev/core/index.d.ts)                                                                                                                     | Core type definitions: `IDE`, `ILLM`, `TabAutocompleteOptions`, `Position`, `Range`, etc. |
| [`core/autocomplete/CompletionProvider.ts`](../continuedev/core/autocomplete/CompletionProvider.ts)                                                                     | Main orchestrator (not used directly by classic-auto-complete; serves as reference)       |
| [`core/autocomplete/context/ContextRetrievalService.ts`](../continuedev/core/autocomplete/context/)                                                                     | Context gathering service                                                                 |
| [`core/autocomplete/snippets/getAllSnippets.ts`](../continuedev/core/autocomplete/snippets/getAllSnippets.ts)                                                           | Collects all context snippets                                                             |
| [`core/autocomplete/templating/`](../continuedev/core/autocomplete/templating/)                                                                                         | Prompt construction, formatting, model-specific templates                                 |
| [`core/autocomplete/postprocessing/`](../continuedev/core/autocomplete/postprocessing/)                                                                                 | Post-processing pipeline                                                                  |
| [`core/autocomplete/util/HelperVars.ts`](../continuedev/core/autocomplete/util/HelperVars.ts)                                                                           | Cursor context, pruned prefix/suffix computation                                          |
| [`core/vscode-test-harness/src/VSCodeIde.ts`](../continuedev/core/vscode-test-harness/src/VSCodeIde.ts)                                                                 | VS Code `IDE` interface implementation                                                    |
| [`core/vscode-test-harness/src/autocomplete/lsp.ts`](../continuedev/core/vscode-test-harness/src/autocomplete/lsp.ts)                                                   | LSP definition retrieval                                                                  |
| [`core/vscode-test-harness/src/autocomplete/RecentlyVisitedRangesService.ts`](../continuedev/core/vscode-test-harness/src/autocomplete/RecentlyVisitedRangesService.ts) | Tracks recently visited code ranges                                                       |
| [`core/vscode-test-harness/src/autocomplete/recentlyEdited.ts`](../continuedev/core/vscode-test-harness/src/autocomplete/recentlyEdited.ts)                             | Tracks recently edited code ranges                                                        |
| [`core/llm/`](../continuedev/core/llm/)                                                                                                                                 | LLM implementations (OpenAI, Mistral, etc.)                                               |
| [`core/util/parameters.ts`](../continuedev/core/util/parameters.ts)                                                                                                     | `DEFAULT_AUTOCOMPLETE_OPTS`                                                               |
| [`tree-sitter/`](../continuedev/tree-sitter/)                                                                                                                           | `.scm` query files for all supported languages                                            |

### Self-containedness

The continuedev library is **largely self-contained** with its own:

- `IDE` interface (abstraction over VS Code/JetBrains)
- `ILLM` interface (abstraction over LLM providers)
- Tree-sitter integration
- Utility layer

It imports `web-tree-sitter` as an external npm dependency. The `VsCodeIde.ts` implementation within it imports `vscode` API directly.

---

## 3. `classic-auto-complete/` — Inline Code Completion Pipeline

### Purpose

The **primary code editor autocomplete** feature. Implements `vscode.InlineCompletionItemProvider` to show ghost text completions as the user types.

### Completion Pipeline Flow

```
VS Code triggers provideInlineCompletionItems()
    │
    ▼
┌──────────────────────────────────────────┐
│ 1. Gate checks                           │
│    • Is auto-trigger enabled?            │
│    • Has valid model/credentials?        │
│    • Is file accessible (RooIgnore)?     │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ 2. Cache lookup (suggestions history)     │
│    findMatchingSuggestion():             │
│    • exact match                         │
│    • partial_typing (user typed ahead)   │
│    • backward_deletion (user backspaced) │
│    → If cache hit, return immediately    │
└──────────┬───────────────────────────────┘
           │ (cache miss)
           ▼
┌──────────────────────────────────────────┐
│ 3. Contextual skip                       │
│    shouldSkipAutocomplete():             │
│    • mid-word typing (len > 2)           │
│    • at end of statement (;, }, ))       │
│    → If skip, return empty               │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ 4. Prompt building                       │
│    Strategy chosen by model.supportsFim()│
│                                          │
│    FIM path (FimPromptBuilder):          │
│    • getProcessedSnippets() → HelperVars │
│    • getAllSnippetsWithoutRace() →        │
│      context, snippets, LSP defs         │
│    • getTemplateForModel() → FIM format  │
│    • compilePrefixSuffix() → formatted   │
│                                          │
│    Chat path (HoleFiller):               │
│    • Same context gathering              │
│    • formatSnippets() → comment context  │
│    • System prompt (hole-filler pattern) │
│    • {{FILL_HERE}} template              │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ 5. Debounced LLM request                 │
│    • Leading edge on first call          │
│    • Adaptive delay (avg of recent       │
│      latencies, 150ms–1000ms range)      │
│    • Reuses covering pending requests    │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ 6. LLM call (via AutocompleteModel)      │
│    FIM: model.generateFimResponse()      │
│         → FimHandler.streamFim()         │
│    Chat: model.generateResponse()        │
│         → ApiHandler.createMessage()     │
│    → Collects streaming chunks           │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ 7. Post-processing                       │
│    processSuggestion() →                 │
│    postprocessAutocompleteSuggestion():   │
│    a. continuedev postprocessCompletion() │
│       (prefix overlap removal, etc.)     │
│    b. applyLanguageFilter() (markdown)   │
│    c. suggestionConsideredDuplication()   │
│       • prefix/suffix duplication        │
│       • edge-line duplication            │
│       • repetitive phrase detection      │
│       • normalized complete-line check   │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ 8. Display logic                         │
│    • applyFirstLineOnly() — truncate     │
│      multi-line if cursor is mid-line    │
│    • stringToInlineCompletions() →       │
│      vscode.InlineCompletionItem         │
│    • Track in suggestionsHistory         │
│    • Cost tracking callback              │
│    • Telemetry (requested, returned,     │
│      filtered, cache hit, accepted,      │
│      unique shown, visibility tracking)  │
└──────────────────────────────────────────┘
```

### Key Files

| File                                                                                                          | Role                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`AutocompleteInlineCompletionProvider.ts`](../classic-auto-complete/AutocompleteInlineCompletionProvider.ts) | Main provider: debouncing, cache, pipeline orchestration                                       |
| [`FillInTheMiddle.ts`](../classic-auto-complete/FillInTheMiddle.ts)                                           | `FimPromptBuilder` — builds FIM prompts using continuedev's templating                         |
| [`HoleFiller.ts`](../classic-auto-complete/HoleFiller.ts)                                                     | Chat-based completion with `{{FILL_HERE}}` / `<COMPLETION>` XML tag protocol                   |
| [`getProcessedSnippets.ts`](../classic-auto-complete/getProcessedSnippets.ts)                                 | Orchestrates context gathering: `HelperVars`, `getAllSnippetsWithoutRace`, access filtering    |
| [`contextualSkip.ts`](../classic-auto-complete/contextualSkip.ts)                                             | Determines when to skip autocomplete (mid-word, end-of-statement)                              |
| [`uselessSuggestionFilter.ts`](../classic-auto-complete/uselessSuggestionFilter.ts)                           | Duplication detection, postprocessing pipeline integration                                     |
| [`AutocompleteTelemetry.ts`](../classic-auto-complete/AutocompleteTelemetry.ts)                               | Telemetry events: requested, filtered, cache hit, LLM completed/failed, accepted, unique shown |
| [`language-filters/index.ts`](../classic-auto-complete/language-filters/index.ts)                             | Language-specific post-filters (currently: markdown)                                           |

### External Dependencies (outside autocomplete module)

- `vscode` API (`InlineCompletionItemProvider`, `TextDocument`, `Position`, etc.)
- `../../api/transform/stream` (`ApiStreamChunk`)
- `../../core/ignore/RooIgnoreController` (file access filtering)
- `../../core/webview/ClineProvider`
- `@roo-code/types`, `@roo-code/telemetry`

---

## 4. `chat-autocomplete/` — Chat Text Area Autocomplete

### Purpose

Provides **autocomplete for the chat input text area** in the Kilo Code webview. When the user is typing a message in the chat panel, this module suggests completions for natural language text.

### Architecture

```
Webview sends "requestChatCompletion" message
    │
    ▼
handleChatCompletionRequest()
    │
    ├── Creates VisibleCodeTracker → captureVisibleCode()
    ├── Creates ChatTextAreaAutocomplete
    │       │
    │       ├── Initializes AutocompleteModel (same LLM layer)
    │       ├── buildPrefix() — includes visible code context
    │       │
    │       ├── FIM path: model.generateFimResponse()
    │       └── Chat path: model.generateResponse() with chat-specific prompts
    │
    │       cleanSuggestion():
    │       ├── removePrefixOverlap()
    │       ├── postprocessAutocompleteSuggestion()
    │       ├── Filter code-looking suggestions (//, /*, #)
    │       └── Truncate at first newline
    │
    └── Sends "chatCompletionResult" back to webview
```

### Communication

- **Request**: Webview → Extension: `{ type: "requestChatCompletion", text, requestId }`
- **Response**: Extension → Webview: `{ type: "chatCompletionResult", text, requestId }`
- **Acceptance**: Webview → Extension: `{ type: "chatCompletionAccepted", suggestionLength }`

### Key Files

| File                                                                                      | Role                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`ChatTextAreaAutocomplete.ts`](../chat-autocomplete/ChatTextAreaAutocomplete.ts)         | Core logic: prompt building with visible code context, LLM call, cleaning |
| [`handleChatCompletionRequest.ts`](../chat-autocomplete/handleChatCompletionRequest.ts)   | Message handler: creates tracker + autocomplete, sends result to webview  |
| [`handleChatCompletionAccepted.ts`](../chat-autocomplete/handleChatCompletionAccepted.ts) | Telemetry handler for accepted suggestions                                |

### External Dependencies

- `../../core/webview/ClineProvider` (webview messaging)
- `../../core/config/ProviderSettingsManager`
- Reuses `AutocompleteTelemetry` and `postprocessAutocompleteSuggestion` from classic-auto-complete

---

## 5. `context/` — Visible Code Context

### Purpose

Captures what code is **actually visible** in the user's VS Code editor viewports (not just which files are open).

### [`VisibleCodeTracker.ts`](../context/VisibleCodeTracker.ts)

- Iterates `vscode.window.visibleTextEditors`
- For each editor: captures file path, language ID, visible line ranges, cursor position, selections
- Extracts diff information from git-scheme URIs
- Filters out files matching security patterns (`isSecurityConcern`) and `.kilocodeignore` rules

### External Dependencies

- `vscode` API (`window.visibleTextEditors`, `TextEditor`)
- `../../../utils/path` (`toRelativePath`)
- `../continuedev/core/indexing/ignore` (`isSecurityConcern`)
- `../../../core/ignore/RooIgnoreController`

---

## 6. `utils/` — Utility Functions

### [`kilocode-utils.ts`](../utils/kilocode-utils.ts)

- `checkKilocodeBalance(token, orgId)`: HTTP call to `/api/profile/balance` to verify positive balance.
- Re-exports `AUTOCOMPLETE_PROVIDER_MODELS` and `AutocompleteProviderKey` from `@roo-code/types`.

### External Dependencies

- `@roo-code/types` (`getKiloBaseUriFromToken`, `AUTOCOMPLETE_PROVIDER_MODELS`, `AutocompleteProviderKey`)
- Node.js `fetch`

---

## Key Interfaces and Abstractions

### Within the Module

| Interface                     | Defined In | Purpose                                                                                       |
| ----------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| `AutocompleteInput`           | `types.ts` | Input for both FIM and hole-filler strategies                                                 |
| `AutocompletePrompt`          | `types.ts` | Discriminated union: `FimAutocompletePrompt \| HoleFillerAutocompletePrompt`                  |
| `FillInAtCursorSuggestion`    | `types.ts` | Result: `{ text, prefix, suffix }`                                                            |
| `ResponseMetaData`            | `types.ts` | Cost/token tracking                                                                           |
| `AutocompleteContextProvider` | `types.ts` | Bundles `ContextRetrievalService` + `VsCodeIde` + `AutocompleteModel` + `RooIgnoreController` |
| `CostTrackingCallback`        | `types.ts` | `(cost, inputTokens, outputTokens) => void`                                                   |
| `VisibleCodeContext`          | `types.ts` | Captured visible editor state                                                                 |

### From continuedev

| Interface                | Defined In                               | Purpose                                                        |
| ------------------------ | ---------------------------------------- | -------------------------------------------------------------- |
| `IDE`                    | `continuedev/core/index.d.ts`            | IDE abstraction (file I/O, LSP, editor state)                  |
| `ILLM`                   | `continuedev/core/index.d.ts`            | LLM abstraction (streamComplete, streamFim, chat, countTokens) |
| `TabAutocompleteOptions` | `continuedev/core/index.d.ts`            | Autocomplete configuration options                             |
| `AutocompleteSnippet`    | `continuedev/core/autocomplete/types.ts` | Context snippet with type discrimination                       |

### From External Code

| Interface/Class           | From                  | Used For                           |
| ------------------------- | --------------------- | ---------------------------------- |
| `ApiHandler`              | `src/api/`            | Chat-based LLM streaming           |
| `FimHandler`              | `src/api/`            | FIM completion streaming           |
| `ProviderSettingsManager` | `src/core/config/`    | Profile and provider configuration |
| `ContextProxy`            | `src/core/config/`    | Global state persistence           |
| `ClineProvider`           | `src/core/webview/`   | Webview messaging, task access     |
| `RooIgnoreController`     | `src/core/ignore/`    | File access filtering              |
| `TelemetryService`        | `@roo-code/telemetry` | Event tracking                     |

---

## Self-Contained vs. External Dependencies Summary

### Self-Contained (within `src/services/autocomplete/`)

- ✅ Completion pipeline logic (classic + chat)
- ✅ Contextual skip heuristics
- ✅ Suggestion history/cache management
- ✅ Duplication and uselessness filtering
- ✅ Language-specific filters
- ✅ Adaptive debouncing
- ✅ Visible code context capture
- ✅ Chat text area completion logic
- ✅ Telemetry event definitions
- ✅ continuedev library (context retrieval, snippet gathering, prompt templating, tree-sitter queries, postprocessing, LLM abstractions)

### Requires External Reconstruction

| Dependency                  | Source               | What It Provides                                                                  |
| --------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `ApiHandler` / `FimHandler` | `src/api/`           | Actual LLM API calls (streaming FIM + chat)                                       |
| `buildApiHandler()`         | `src/api/`           | Factory to create API handlers from profiles                                      |
| `ProviderSettingsManager`   | `src/core/config/`   | Profile management, provider config                                               |
| `ContextProxy`              | `src/core/config/`   | Persistent global state                                                           |
| `ClineProvider`             | `src/core/webview/`  | Webview messaging + task state                                                    |
| `RooIgnoreController`       | `src/core/ignore/`   | `.kilocodeignore` pattern matching                                                |
| `vscode` API                | VS Code              | All editor integration (inline completions, status bar, commands, text documents) |
| `@roo-code/types`           | `packages/types`     | Shared type definitions, provider constants                                       |
| `@roo-code/telemetry`       | `packages/telemetry` | Telemetry event capture                                                           |
| `../../i18n`                | `src/i18n/`          | Localization                                                                      |
| `../../utils/path`          | `src/utils/`         | Path utilities (`toRelativePath`)                                                 |
| `web-tree-sitter`           | npm                  | Tree-sitter WASM parser (used by continuedev)                                     |
| `PROVIDERS` constant        | `webview-ui/`        | Provider display name mapping                                                     |
