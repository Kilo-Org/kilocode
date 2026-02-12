# External Imports Investigation — `src/services/autocomplete/`

> Generated: 2026-02-12
>
> This document catalogs **every import** in the autocomplete module that references code
> **outside** of `src/services/autocomplete/`. Test files (`*.test.ts`, `*.spec.ts`, `__tests__/`)
> are excluded.

---

## Table of Contents

1. [Summary](#summary)
2. [VSCode API](#1-vscode-api)
3. [Internal Project Imports (non-continuedev)](#2-internal-project-imports-non-continuedev-files)
4. [Internal Project Imports (continuedev → outside autocomplete)](#3-internal-project-imports-continuedev-files-reaching-outside-autocomplete)
5. [Webview UI Imports](#4-webview-ui-imports)
6. [Monorepo Packages (`@roo-code/*`)](#5-monorepo-packages-roo-code)
7. [Third-Party npm Packages](#6-third-party-npm-packages)
8. [Node.js Built-in Modules](#7-nodejs-built-in-modules)

---

## Summary

| Category                                 | Unique Modules                               | Total Import Sites |
| ---------------------------------------- | -------------------------------------------- | ------------------ |
| VSCode API                               | 1 (`vscode`)                                 | 14                 |
| Internal project (non-continuedev)       | 12 distinct targets                          | 27                 |
| Internal project (continuedev → outside) | 3 distinct targets                           | 3                  |
| Webview UI                               | 1 (`PROVIDERS`)                              | 2                  |
| Monorepo packages                        | 2 (`@roo-code/types`, `@roo-code/telemetry`) | 9                  |
| Third-party npm                          | 16 distinct packages                         | 60+                |
| Node.js built-ins                        | 8 modules                                    | 20+                |

---

## 1. VSCode API

All files import `* as vscode from "vscode"`.

| Source File                                                                             | Symbols       |
| --------------------------------------------------------------------------------------- | ------------- |
| `AutocompleteCodeActionProvider.ts`                                                     | `* as vscode` |
| `AutocompleteJetbrainsBridge.ts`                                                        | `* as vscode` |
| `AutocompleteServiceManager.ts`                                                         | `* as vscode` |
| `AutocompleteStatusBar.ts`                                                              | `* as vscode` |
| `index.ts`                                                                              | `* as vscode` |
| `types.ts`                                                                              | `* as vscode` |
| `chat-autocomplete/ChatTextAreaAutocomplete.ts`                                         | `* as vscode` |
| `classic-auto-complete/AutocompleteInlineCompletionProvider.ts`                         | `* as vscode` |
| `classic-auto-complete/getProcessedSnippets.ts`                                         | `* as vscode` |
| `context/VisibleCodeTracker.ts`                                                         | `* as vscode` |
| `continuedev/core/vscode-test-harness/src/VSCodeIde.ts`                                 | `* as vscode` |
| `continuedev/core/vscode-test-harness/src/autocomplete/lsp.ts`                          | `* as vscode` |
| `continuedev/core/vscode-test-harness/src/autocomplete/recentlyEdited.ts`               | `* as vscode` |
| `continuedev/core/vscode-test-harness/src/autocomplete/RecentlyVisitedRangesService.ts` | `* as vscode` |

---

## 2. Internal Project Imports (non-continuedev files)

These are imports from files **outside** the `src/services/autocomplete/` directory tree,
originating from the "Kilo Code" layer (not the continuedev fork).

### `src/core/` imports

| Source File                                                     | Module Path                                    | Symbols                            |
| --------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| `AutocompleteJetbrainsBridge.ts`                                | `../../core/webview/ClineProvider`             | `{ ClineProvider }`                |
| `AutocompleteJetbrainsBridge.ts`                                | `../../core/kilocode/wrapper`                  | `{ getKiloCodeWrapperProperties }` |
| `AutocompleteModel.ts`                                          | `../../core/config/ProviderSettingsManager`    | `{ ProviderSettingsManager }`      |
| `AutocompleteServiceManager.ts`                                 | `../../core/config/ContextProxy`               | `{ ContextProxy }`                 |
| `AutocompleteServiceManager.ts`                                 | `../../core/webview/ClineProvider`             | `{ ClineProvider }`                |
| `index.ts`                                                      | `../../core/webview/ClineProvider`             | `{ ClineProvider }`                |
| `types.ts`                                                      | `../../core/ignore/RooIgnoreController`        | `{ RooIgnoreController }`          |
| `chat-autocomplete/ChatTextAreaAutocomplete.ts`                 | `../../../core/config/ProviderSettingsManager` | `{ ProviderSettingsManager }`      |
| `chat-autocomplete/handleChatCompletionRequest.ts`              | `../../../core/webview/ClineProvider`          | `{ ClineProvider }`                |
| `classic-auto-complete/AutocompleteInlineCompletionProvider.ts` | `../../../core/ignore/RooIgnoreController`     | `{ RooIgnoreController }`          |
| `classic-auto-complete/AutocompleteInlineCompletionProvider.ts` | `../../../core/webview/ClineProvider`          | `{ ClineProvider }`                |
| `classic-auto-complete/getProcessedSnippets.ts`                 | `../../../core/ignore/RooIgnoreController`     | `{ RooIgnoreController }`          |
| `context/VisibleCodeTracker.ts`                                 | `../../../core/ignore/RooIgnoreController`     | `type { RooIgnoreController }`     |

### `src/api/` imports

| Source File                           | Module Path                               | Symbols                                       |
| ------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| `AutocompleteModel.ts`                | `../../api`                               | `{ ApiHandler, buildApiHandler, FimHandler }` |
| `AutocompleteModel.ts`                | `../../api/providers`                     | `{ OpenRouterHandler }`                       |
| `AutocompleteModel.ts`                | `../../api/providers/openrouter`          | `{ CompletionUsage }`                         |
| `AutocompleteModel.ts`                | `../../api/transform/stream`              | `{ ApiStreamChunk }`                          |
| `AutocompleteModel.ts`                | `../../api/providers/kilocode-openrouter` | `{ KilocodeOpenrouterHandler }`               |
| `classic-auto-complete/HoleFiller.ts` | `../../../api/transform/stream`           | `{ ApiStreamChunk }`                          |

### `src/i18n` imports

| Source File                         | Module Path  | Symbols |
| ----------------------------------- | ------------ | ------- |
| `AutocompleteCodeActionProvider.ts` | `../../i18n` | `{ t }` |
| `AutocompleteServiceManager.ts`     | `../../i18n` | `{ t }` |
| `AutocompleteStatusBar.ts`          | `../../i18n` | `{ t }` |

### `src/shared/` imports

| Source File                                         | Module Path                      | Symbols              |
| --------------------------------------------------- | -------------------------------- | -------------------- |
| `chat-autocomplete/handleChatCompletionAccepted.ts` | `../../../shared/WebviewMessage` | `{ WebviewMessage }` |
| `chat-autocomplete/handleChatCompletionRequest.ts`  | `../../../shared/WebviewMessage` | `{ WebviewMessage }` |

### `src/utils/` imports

| Source File                     | Module Path           | Symbols              |
| ------------------------------- | --------------------- | -------------------- |
| `context/VisibleCodeTracker.ts` | `../../../utils/path` | `{ toRelativePath }` |

### `src/services/mocking/` imports

| Source File                      | Module Path                   | Symbols                |
| -------------------------------- | ----------------------------- | ---------------------- |
| `AutocompleteJetbrainsBridge.ts` | `../mocking/MockTextDocument` | `{ MockTextDocument }` |

---

## 3. Internal Project Imports (continuedev files reaching outside autocomplete)

These imports originate from `continuedev/` files but reach out of the autocomplete
directory tree entirely (via deeply nested `../../../../../../` paths).

| Source File                             | Module Path                                             | Symbols                  |
| --------------------------------------- | ------------------------------------------------------- | ------------------------ |
| `continuedev/core/llm/llms/KiloCode.ts` | `../../../../../../shared/kilocode/headers`             | `{ X_KILOCODE_VERSION }` |
| `continuedev/core/llm/llms/KiloCode.ts` | `../../../../../../shared/package`                      | `{ Package }`            |
| `continuedev/core/llm/llms/KiloCode.ts` | `../../../../../../api/providers/kilocode/IFimProvider` | `{ IFimProvider }`       |

---

## 4. Webview UI Imports

| Source File                | Module Path                                             | Symbols         |
| -------------------------- | ------------------------------------------------------- | --------------- |
| `AutocompleteModel.ts`     | `../../../webview-ui/src/components/settings/constants` | `{ PROVIDERS }` |
| `AutocompleteStatusBar.ts` | `../../../webview-ui/src/components/settings/constants` | `{ PROVIDERS }` |

---

## 5. Monorepo Packages (`@roo-code/*`)

### `@roo-code/types`

| Source File                                                     | Symbols                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `AutocompleteModel.ts`                                          | `{ modelIdKeysByProvider, ProviderName }`                                            |
| `AutocompleteServiceManager.ts`                                 | `{ AutocompleteServiceSettings, TelemetryEventName }`                                |
| `AutocompleteStatusBar.ts`                                      | `{ AUTOCOMPLETE_PROVIDER_MODELS, ProviderName }`                                     |
| `classic-auto-complete/AutocompleteInlineCompletionProvider.ts` | `type { AutocompleteServiceSettings }`                                               |
| `classic-auto-complete/AutocompleteTelemetry.ts`                | `{ TelemetryEventName }`                                                             |
| `utils/kilocode-utils.ts`                                       | `{ getKiloBaseUriFromToken, AUTOCOMPLETE_PROVIDER_MODELS, AutocompleteProviderKey }` |
| `continuedev/core/llm/llms/KiloCode.ts`                         | `{ getKiloUrlFromToken }`                                                            |

### `@roo-code/telemetry`

| Source File                                      | Symbols                |
| ------------------------------------------------ | ---------------------- |
| `AutocompleteServiceManager.ts`                  | `{ TelemetryService }` |
| `classic-auto-complete/AutocompleteTelemetry.ts` | `{ TelemetryService }` |

---

## 6. Third-Party npm Packages

### `openai` / `openai/*` (OpenAI SDK)

Used extensively in `continuedev/core/llm/` for LLM API adapters.

| Source File                                                        | Module Path                        | Symbols                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `continuedev/core/llm/index.ts`                                    | `openai/resources/index`           | `{ ChatCompletionCreateParams }`                                                                                          |
| `continuedev/core/llm/llms/OpenAI.ts`                              | `openai/resources/index`           | `{ ChatCompletionCreateParams, ChatCompletionMessageParam }`                                                              |
| `continuedev/core/llm/llms/OpenRouter.ts`                          | `openai/resources/index`           | `{ ChatCompletionCreateParams }`                                                                                          |
| `continuedev/core/llm/openaiTypeConverters.ts`                     | `openai/resources/index`           | `{ ChatCompletion, ChatCompletionChunk, ChatCompletionCreateParams, ChatCompletionMessageParam, CompletionCreateParams }` |
| `continuedev/core/llm/openai-adapters/apis/Anthropic.ts`           | `openai/index`                     | `{ OpenAI }`                                                                                                              |
| `continuedev/core/llm/openai-adapters/apis/Anthropic.ts`           | `openai/resources/index`           | `{ ChatCompletionChunk, ChatCompletionCreateParams, ... }`                                                                |
| `continuedev/core/llm/openai-adapters/apis/Anthropic.ts`           | `openai/resources/index.js`        | `{ ChatCompletionCreateParams }`                                                                                          |
| `continuedev/core/llm/openai-adapters/apis/AnthropicUtils.ts`      | `openai/resources`                 | `{ ChatCompletionTool, ChatCompletionToolChoiceOption }`                                                                  |
| `continuedev/core/llm/openai-adapters/apis/Azure.ts`               | `openai/index`                     | `{ OpenAI }`                                                                                                              |
| `continuedev/core/llm/openai-adapters/apis/Azure.ts`               | `openai/resources/index`           | `{ ChatCompletionChunk, ... }`                                                                                            |
| `continuedev/core/llm/openai-adapters/apis/base.ts`                | `openai/resources/index`           | `{ ChatCompletion, ChatCompletionChunk, ChatCompletionCreateParams, ... }`                                                |
| `continuedev/core/llm/openai-adapters/apis/Bedrock.ts`             | `openai/index`                     | `{ OpenAI }`                                                                                                              |
| `continuedev/core/llm/openai-adapters/apis/Bedrock.ts`             | `openai/resources/index`           | `{ ChatCompletionChunk, ... }`                                                                                            |
| `continuedev/core/llm/openai-adapters/apis/Cohere.ts`              | `openai/index`                     | `{ OpenAI }`                                                                                                              |
| `continuedev/core/llm/openai-adapters/apis/Cohere.ts`              | `openai/resources/index`           | `{ ChatCompletion, ChatCompletionChunk, ... }`                                                                            |
| `continuedev/core/llm/openai-adapters/apis/CometAPI.ts`            | `openai/resources/index`           | `{ ChatCompletion, ChatCompletionChunk, ... }`                                                                            |
| `continuedev/core/llm/openai-adapters/apis/ContinueProxy.ts`       | `openai/resources/index`           | `{ ChatCompletion, ChatCompletionChunk, ... }`                                                                            |
| `continuedev/core/llm/openai-adapters/apis/DeepSeek.ts`            | `openai/resources/index`           | `{ ChatCompletionChunk, Model }`                                                                                          |
| `continuedev/core/llm/openai-adapters/apis/Gemini.ts`              | `openai/index`                     | `{ OpenAI }`                                                                                                              |
| `continuedev/core/llm/openai-adapters/apis/Gemini.ts`              | `openai/resources/index`           | `{ ChatCompletionChunk, ... }`                                                                                            |
| `continuedev/core/llm/openai-adapters/apis/Inception.ts`           | `openai/resources/index`           | `{ ChatCompletionChunk, ... }`                                                                                            |
| `continuedev/core/llm/openai-adapters/apis/Jina.ts`                | `openai/resources/index`           | `{ ChatCompletionChunk, ... }`                                                                                            |
| `continuedev/core/llm/openai-adapters/apis/LlamaStack.ts`          | `openai/resources/index`           | `{ ChatCompletionChunk }`                                                                                                 |
| `continuedev/core/llm/openai-adapters/apis/Mock.ts`                | `openai/resources/index`           | `{ ChatCompletionChunk, ... }`                                                                                            |
| `continuedev/core/llm/openai-adapters/apis/Moonshot.ts`            | `openai/resources/index`           | `{ ChatCompletionChunk, Model }`                                                                                          |
| `continuedev/core/llm/openai-adapters/apis/OpenAI.ts`              | `openai/index`                     | `{ OpenAI }`                                                                                                              |
| `continuedev/core/llm/openai-adapters/apis/OpenAI.ts`              | `openai/resources/index`           | `{ ChatCompletion, ChatCompletionChunk, ... }`                                                                            |
| `continuedev/core/llm/openai-adapters/apis/OpenRouter.ts`          | `openai/resources/index`           | `{ ChatCompletionCreateParams }`                                                                                          |
| `continuedev/core/llm/openai-adapters/apis/OpenRouterCaching.ts`   | `openai/resources/index`           | `{ ChatCompletionCreateParams, ChatCompletionMessageParam }`                                                              |
| `continuedev/core/llm/openai-adapters/apis/Relace.ts`              | `openai/resources/completions.mjs` | `{ Completion, CompletionUsage }`                                                                                         |
| `continuedev/core/llm/openai-adapters/apis/Relace.ts`              | `openai/resources/index.mjs`       | `{ ChatCompletion, ChatCompletionChunk, ... }`                                                                            |
| `continuedev/core/llm/openai-adapters/apis/Relace.ts`              | `openai/resources/models.mjs`      | `{ Model }`                                                                                                               |
| `continuedev/core/llm/openai-adapters/apis/VertexAI.ts`            | `openai/resources/index`           | `{ ChatCompletionChunk, ... }`                                                                                            |
| `continuedev/core/llm/openai-adapters/apis/WatsonX.ts`             | `openai/index`                     | `{ OpenAI }`                                                                                                              |
| `continuedev/core/llm/openai-adapters/apis/WatsonX.ts`             | `openai/resources/index`           | `{ ChatCompletionChunk, ... }`                                                                                            |
| `continuedev/core/llm/openai-adapters/apis/WatsonX.ts`             | `openai/resources/index.js`        | `{ ChatCompletionCreateParams }`                                                                                          |
| `continuedev/core/llm/openai-adapters/util.ts`                     | `openai/resources/index`           | `{ ChatCompletionChunk, CompletionUsage }`                                                                                |
| `continuedev/core/llm/openai-adapters/util.ts`                     | `openai/resources/index.js`        | `{ ChatCompletion }`                                                                                                      |
| `continuedev/core/llm/openai-adapters/util/emptyChatCompletion.ts` | `openai/resources/index`           | `{ ChatCompletion }`                                                                                                      |
| `continuedev/core/llm/openai-adapters/util/gemini-types.ts`        | `openai/resources/index.mjs`       | `{ ChatCompletionTool }`                                                                                                  |

### `@anthropic-ai/sdk`

| Source File                                                               | Module Path                   | Symbols                                                                                                                 |
| ------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `continuedev/core/llm/openai-adapters/apis/Anthropic.ts`                  | `@anthropic-ai/sdk/resources` | `{ ContentBlock, ContentBlockDelta, MessageDelta, MessageStartEvent, RawContentBlockStartEvent, RawMessageDeltaEvent }` |
| `continuedev/core/llm/openai-adapters/apis/AnthropicCachingStrategies.ts` | `@anthropic-ai/sdk/resources` | `{ MessageCreateParams }`                                                                                               |
| `continuedev/core/llm/openai-adapters/apis/AnthropicUtils.ts`             | `@anthropic-ai/sdk/resources` | `{ Base64ImageSource, MessageParam, Tool, ToolChoice }`                                                                 |
| `continuedev/core/llm/openai-adapters/apis/OpenRouterCaching.ts`          | `@anthropic-ai/sdk/resources` | `{ ContentBlockParam, MessageCreateParams, MessageParam }`                                                              |

### `@aws-sdk/*`

| Source File                                            | Module Path                       | Symbols                                                                                      |
| ------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------- |
| `continuedev/core/llm/openai-adapters/apis/Bedrock.ts` | `@aws-sdk/client-bedrock-runtime` | `{ BedrockRuntimeClient, ConverseStreamCommand, InvokeModelWithResponseStreamCommand, ... }` |
| `continuedev/core/llm/openai-adapters/apis/Bedrock.ts` | `@aws-sdk/credential-providers`   | `{ fromNodeProviderChain }`                                                                  |

### `google-auth-library`

| Source File                                             | Module Path           | Symbols                                 |
| ------------------------------------------------------- | --------------------- | --------------------------------------- |
| `continuedev/core/llm/openai-adapters/apis/VertexAI.ts` | `google-auth-library` | `{ AuthClient, GoogleAuth, JWT, auth }` |

### `zod`

| Source File                                                  | Module Path | Symbols  |
| ------------------------------------------------------------ | ----------- | -------- |
| `AutocompleteJetbrainsBridge.ts`                             | `zod`       | `{ z }`  |
| `continuedev/core/llm/openai-adapters/apis/Azure.ts`         | `zod`       | `{ z }`  |
| `continuedev/core/llm/openai-adapters/apis/ContinueProxy.ts` | `zod`       | `{ z }`  |
| `continuedev/core/llm/openai-adapters/apis/OpenAI.ts`        | `zod`       | `{ z }`  |
| `continuedev/core/llm/openai-adapters/apis/Relace.ts`        | `zod`       | `{ z }`  |
| `continuedev/core/llm/openai-adapters/index.ts`              | `zod`       | `{ z }`  |
| `continuedev/core/llm/openai-adapters/types.ts`              | `zod`       | `* as z` |

### `web-tree-sitter`

| Source File                                                                         | Module Path       | Symbols                                              |
| ----------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------- |
| `continuedev/core/index.d.ts`                                                       | `web-tree-sitter` | `Parser` (default)                                   |
| `continuedev/core/autocomplete/util/ast.ts`                                         | `web-tree-sitter` | `{ Node as SyntaxNode, Tree }`                       |
| `continuedev/core/autocomplete/context/root-path-context/RootPathContextService.ts` | `web-tree-sitter` | `{ Node as SyntaxNode, Query, Point }`               |
| `continuedev/core/autocomplete/context/root-path-context/testUtils.ts`              | `web-tree-sitter` | `Parser` (default)                                   |
| `continuedev/core/autocomplete/context/static-context/StaticContextService.ts`      | `web-tree-sitter` | `{ Node as SyntaxNode }`                             |
| `continuedev/core/autocomplete/context/static-context/tree-sitter-utils.ts`         | `web-tree-sitter` | `{ Node as SyntaxNode, QueryMatch, Tree }`           |
| `continuedev/core/autocomplete/context/static-context/types.ts`                     | `web-tree-sitter` | `{ Tree }`                                           |
| `continuedev/core/util/treeSitter.ts`                                               | `web-tree-sitter` | `type { Language, Node as SyntaxNode, Query, Tree }` |
| `continuedev/core/vscode-test-harness/src/autocomplete/lsp.ts`                      | `web-tree-sitter` | `type { Node as SyntaxNode }`                        |

### `diff`

| Source File                                                         | Module Path | Symbols                                 |
| ------------------------------------------------------------------- | ----------- | --------------------------------------- |
| `continuedev/core/autocomplete/util/processSingleLineCompletion.ts` | `diff`      | `* as Diff`                             |
| `continuedev/core/diff/myers.ts`                                    | `diff`      | `{ diffChars, diffLines, type Change }` |

### `fastest-levenshtein`

| Source File                                            | Module Path           | Symbols        |
| ------------------------------------------------------ | --------------------- | -------------- |
| `continuedev/core/autocomplete/util/textSimilarity.ts` | `fastest-levenshtein` | `{ distance }` |
| `continuedev/core/diff/util.ts`                        | `fastest-levenshtein` | `{ distance }` |

### `js-tiktoken`

| Source File                           | Module Path   | Symbols                                               |
| ------------------------------------- | ------------- | ----------------------------------------------------- |
| `continuedev/core/llm/countTokens.ts` | `js-tiktoken` | `{ Tiktoken, encodingForModel as _encodingForModel }` |

### `lru-cache`

| Source File                                                                             | Module Path | Symbols        |
| --------------------------------------------------------------------------------------- | ----------- | -------------- |
| `continuedev/core/autocomplete/util/AutocompleteLruCacheInMem.ts`                       | `lru-cache` | `{ LRUCache }` |
| `continuedev/core/autocomplete/context/root-path-context/RootPathContextService.ts`     | `lru-cache` | `{ LRUCache }` |
| `continuedev/core/vscode-test-harness/src/autocomplete/RecentlyVisitedRangesService.ts` | `lru-cache` | `{ LRUCache }` |

### `quick-lru`

| Source File                                                 | Module Path | Symbols              |
| ----------------------------------------------------------- | ----------- | -------------------- |
| `continuedev/core/autocomplete/util/openedFilesLruCache.ts` | `quick-lru` | `QuickLRU` (default) |

### `ignore`

| Source File                                           | Module Path | Symbols            |
| ----------------------------------------------------- | ----------- | ------------------ |
| `continuedev/core/autocomplete/prefiltering/index.ts` | `ignore`    | `ignore` (default) |
| `continuedev/core/indexing/ignore.ts`                 | `ignore`    | `ignore` (default) |

### `dotenv`

| Source File                                     | Module Path | Symbols            |
| ----------------------------------------------- | ----------- | ------------------ |
| `continuedev/core/llm/openai-adapters/index.ts` | `dotenv`    | `dotenv` (default) |

### `uri-js`

| Source File                                             | Module Path | Symbols    |
| ------------------------------------------------------- | ----------- | ---------- |
| `continuedev/core/vscode-test-harness/src/VSCodeIde.ts` | `uri-js`    | `* as URI` |

### `vitest`

| Source File                                                            | Module Path | Symbols          |
| ---------------------------------------------------------------------- | ----------- | ---------------- |
| `continuedev/core/autocomplete/context/root-path-context/testUtils.ts` | `vitest`    | `{ expect, vi }` |
| `continuedev/core/autocomplete/filtering/test/util.ts`                 | `vitest`    | `{ expect }`     |
| `continuedev/core/test/vitest.setup.ts`                                | `vitest`    | `{ beforeAll }`  |

---

## 7. Node.js Built-in Modules

| Source File                                                                         | Module        | Symbols                            |
| ----------------------------------------------------------------------------------- | ------------- | ---------------------------------- |
| `AutocompleteServiceManager.ts`                                                     | `crypto`      | `crypto` (default)                 |
| `continuedev/core/autocomplete/util/AutocompleteDebouncer.ts`                       | `node:crypto` | `{ randomUUID }`                   |
| `continuedev/core/llm/openai-adapters/apis/Bedrock.ts`                              | `node:crypto` | `{ randomUUID }`                   |
| `continuedev/core/autocomplete/context/root-path-context/RootPathContextService.ts` | `crypto`      | `{ createHash }`                   |
| `continuedev/core/autocomplete/context/root-path-context/testUtils.ts`              | `fs`          | `fs` (default)                     |
| `continuedev/core/autocomplete/context/root-path-context/testUtils.ts`              | `path`        | `path` (default)                   |
| `continuedev/core/autocomplete/context/root-path-context/testUtils.ts`              | `node:url`    | `{ fileURLToPath }`                |
| `continuedev/core/autocomplete/context/static-context/StaticContextService.ts`      | `fs/promises` | `* as fs`                          |
| `continuedev/core/autocomplete/context/static-context/StaticContextService.ts`      | `path`        | `path` (default)                   |
| `continuedev/core/autocomplete/context/static-context/StaticContextService.ts`      | `url`         | `{ pathToFileURL }`                |
| `continuedev/core/autocomplete/context/static-context/tree-sitter-utils.ts`         | `fs/promises` | `* as fs`                          |
| `continuedev/core/indexing/ignore.ts`                                               | `path`        | `path` (default)                   |
| `continuedev/core/indexing/ignore.ts`                                               | `url`         | `{ fileURLToPath }`                |
| `continuedev/core/test/testDir.ts`                                                  | `fs`          | `fs` (default)                     |
| `continuedev/core/test/testDir.ts`                                                  | `os`          | `os` (default)                     |
| `continuedev/core/test/testDir.ts`                                                  | `path`        | `path` (default)                   |
| `continuedev/core/test/vitest.global-setup.ts`                                      | `fs`          | `fs` (default)                     |
| `continuedev/core/test/vitest.global-setup.ts`                                      | `path`        | `path` (default)                   |
| `continuedev/core/test/vitest.setup.ts`                                             | `util`        | `{ TextDecoder, TextEncoder }`     |
| `continuedev/core/util/filesystem.ts`                                               | `node:fs`     | `* as fs`                          |
| `continuedev/core/util/filesystem.ts`                                               | `node:url`    | `{ fileURLToPath }`                |
| `continuedev/core/util/paths.ts`                                                    | `fs`          | `* as fs`                          |
| `continuedev/core/util/paths.ts`                                                    | `os`          | `* as os`                          |
| `continuedev/core/util/paths.ts`                                                    | `path`        | `* as path`                        |
| `continuedev/core/util/pathToUri.ts`                                                | `url`         | `{ fileURLToPath, pathToFileURL }` |
| `continuedev/core/util/treeSitter.ts`                                               | `node:fs`     | `fs` (default)                     |
| `continuedev/core/util/treeSitter.ts`                                               | `path`        | `path` (default)                   |

---

## Appendix: Unique External Dependency List

### npm packages (non-Node.js built-in)

```
@anthropic-ai/sdk
@aws-sdk/client-bedrock-runtime
@aws-sdk/credential-providers
@roo-code/telemetry
@roo-code/types
diff
dotenv
fastest-levenshtein
google-auth-library
ignore
js-tiktoken
lru-cache
openai
quick-lru
uri-js
vitest
web-tree-sitter
zod
```

### Internal project modules imported (outside autocomplete)

```
src/api                                    (../../api)
src/api/providers                          (../../api/providers)
src/api/providers/kilocode-openrouter      (../../api/providers/kilocode-openrouter)
src/api/providers/kilocode/IFimProvider    (via continuedev KiloCode.ts)
src/api/providers/openrouter               (../../api/providers/openrouter)
src/api/transform/stream                   (../../api/transform/stream)
src/core/config/ContextProxy               (../../core/config/ContextProxy)
src/core/config/ProviderSettingsManager    (../../core/config/ProviderSettingsManager)
src/core/ignore/RooIgnoreController        (../../core/ignore/RooIgnoreController)
src/core/kilocode/wrapper                  (../../core/kilocode/wrapper)
src/core/webview/ClineProvider             (../../core/webview/ClineProvider)
src/i18n                                   (../../i18n)
src/services/mocking/MockTextDocument      (../mocking/MockTextDocument)
src/shared/WebviewMessage                  (../../shared/WebviewMessage)
src/shared/kilocode/headers                (via continuedev KiloCode.ts)
src/shared/package                         (via continuedev KiloCode.ts)
src/utils/path                             (../../utils/path)
webview-ui/src/components/settings/constants
```
