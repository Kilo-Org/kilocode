# Test Files Deletion Plan

## Files Exercised by test-autocomplete.sh (KEEP - 29 files)

The script runs tests matching these patterns:

- `autocomplete`
- `nextEdit`
- `vscode-test-harness`
- `diff`
- `llm/autodetect`
- `indexing/ignore`
- `util/LruCache`

### Autocomplete Tests (14 files) ✅

- core/autocomplete/context/root-path-context/RootPathContextService.vitest.ts
- core/autocomplete/filtering/streamTransforms/charStream.vitest.ts
- core/autocomplete/filtering/streamTransforms/filterCodeBlock.vitest.ts
- core/autocomplete/filtering/streamTransforms/lineStream.vitest.ts
- core/autocomplete/filtering/test/filter.vitest.ts
- core/autocomplete/generation/GeneratorReuseManager.vitest.ts
- core/autocomplete/generation/ListenableGenerator.vitest.ts
- core/autocomplete/generation/utils.vitest.ts
- core/autocomplete/postprocessing/index.vitest.ts
- core/autocomplete/snippets/gitDiffCache.vitest.ts
- core/autocomplete/templating/**tests**/formatOpenedFilesContext.vitest.ts
- core/autocomplete/templating/**tests**/renderPrompt.vitest.ts
- core/autocomplete/util/completionTestUtils.vitest.ts
- core/autocomplete/util/processSingleLineCompletion.vitest.ts

### NextEdit Tests (13 files) ✅

- core/nextEdit/context/aggregateEdits.vitest.ts
- core/nextEdit/context/autocompleteContextFetching.vitest.ts
- core/nextEdit/context/diffFormatting.vitest.ts
- core/nextEdit/context/prevEditLruCache.vitest.ts
- core/nextEdit/context/processNextEditData.vitest.ts
- core/nextEdit/context/processSmallEdit.vitest.ts
- core/nextEdit/diff/diff.vitest.ts
- core/nextEdit/DocumentHistoryTracker.vitest.ts
- core/nextEdit/templating/instinct.vitest.ts
- core/nextEdit/templating/mercuryCoderNextEdit.vitest.ts
- core/nextEdit/templating/NextEditPromptEngine.vitest.ts
- core/nextEdit/templating/utils.vitest.ts
- core/nextEdit/utils.vitest.ts

### VSCode Test Harness (6 files) ✅

- core/vscode-test-harness/test/ContinueCompletionProvider.vitest.ts
- core/vscode-test-harness/test/GhostTextAcceptanceTracker.vitest.ts
- core/vscode-test-harness/test/JumpManager.vitest.ts
- core/vscode-test-harness/test/NextEditWindowManager.vitest.ts
- core/vscode-test-harness/test/SelectionChangeManager.vitest.ts
- core/vscode-test-harness/test/util.vitest.ts

### Diff Tests (3 files) ✅

- core/diff/myers.vitest.ts
- core/diff/streamDiff.vitest.ts
- core/diff/util.vitest.ts

### LLM Autodetect (1 file) ✅

- core/llm/autodetect.vitest.ts

### Indexing/Ignore (1 file) ✅

- core/indexing/ignore.vitest.ts

### Util LruCache (1 file) ✅

- core/util/LruCache.vitest.ts

---

## Files to DELETE (93 files) ❌

### Fetch Tests (7 files)

- core/fetch/certs.vitest.ts
- core/fetch/fetch.e2e.vitest.ts
- core/fetch/getAgentOptions.vitest.ts
- core/fetch/node-fetch-patch.test.js
- core/fetch/ssl-certificate.vitest.ts
- core/fetch/stream.vitest.ts
- core/fetch/util.vitest.ts

### LLM Tests (excluding autodetect) (12 files)

- core/llm/llm-pre-fetch.vitest.ts
- core/llm/llm.vitest.ts
- core/llm/llms/OpenAI.vitest.ts
- core/llm/llms/stubs/ContinueProxy.vitest.ts
- core/llm/openai-adapters/test/anthropic-adapter.vitest.ts
- core/llm/openai-adapters/test/openai-adapter.vitest.ts
- core/llm/rules/alwaysApply.vitest.ts
- core/llm/rules/alwaysApplyRules.vitest.ts
- core/llm/rules/fileProtocolMatching.vitest.ts
- core/llm/rules/getSystemMessageWithRules.vitest.ts
- core/llm/rules/implicitGlobalRules.vitest.ts
- core/llm/rules/nestedDirectoryRules.vitest.ts
- core/llm/rules/ruleColocation.vitest.ts

### Util Tests (excluding LruCache) (10 files)

- core/util/extractMinimalStackTraceInfo.vitest.ts
- core/util/grepSearch.vitest.ts
- core/util/index.vitest.ts
- core/util/log.vitest.ts
- core/util/markdownUtils.vitest.ts
- core/util/messageContent.vitest.ts
- core/util/processTerminalStates.vitest.ts
- core/util/ranges.vitest.ts
- core/util/regexValidator.vitest.ts
- core/util/streamMarkdownUtils.vitest.ts
- core/util/text.vitest.ts

### Dist Tests (all build artifacts) (64 files)

- core/dist/config/yaml-package/**tests**/index.test.js
- core/dist/config/yaml-package/interfaces/SecretResult.test.js
- core/dist/config/yaml-package/interfaces/slugs.test.js
- core/dist/config/yaml-package/load/merge.test.js
- core/dist/config/yaml-package/load/unroll.test.js
- core/dist/config/yaml-package/markdown/createMarkdownPrompt.test.js
- core/dist/config/yaml-package/markdown/createMarkdownRule.test.js
- core/dist/config/yaml-package/markdown/getRuleType.test.js
- core/dist/config/yaml-package/markdown/markdownToRule.test.js
- core/dist/config/yaml-package/markdown/workflowFiles.test.js
- core/dist/config/yaml-package/modelName.test.js
- core/dist/config/yaml-package/registryClient.test.js
- core/dist/config/yaml-package/schemas/mcp/convertJson.test.js
- core/dist/fetch/certs.test.js
- core/dist/fetch/fetch.e2e.test.js
- core/dist/fetch/getAgentOptions.test.js
- core/dist/fetch/node-fetch-patch.test.js
- core/dist/fetch/ssl-certificate.test.js
- core/dist/fetch/stream.test.js
- core/dist/fetch/util.test.js
- core/dist/llm/asyncEncoder.test.js
- core/dist/llm/countTokens.test.js
- core/dist/llm/index.test.js
- core/dist/llm/llm.test.js
- core/dist/llm/llms/Bedrock.test.js
- core/dist/llm/llms/OpenAI.test.js
- core/dist/llm/logFormatter.test.js
- core/dist/llm/openai-adapters/apis/AnthropicCachingStrategies.test.js
- core/dist/llm/openai-adapters/apis/OpenRouter.test.js
- core/dist/llm/openai-adapters/test/main.test.js
- core/dist/llm/templates/chat.test.js
- core/dist/llm/toolSupport.test.js
- core/dist/llm/utils/extractContentFromCodeBlocks.test.js
- core/dist/llm/utils/extractPathsFromCodeBlocks.test.js
- core/dist/llm/utils/getSecureID.test.js
- core/dist/llm/utils/retry.test.js
- core/dist/util/chatDescriber.test.js
- core/dist/util/extractMinimalStackTraceInfo.test.js
- core/dist/util/fetchFavicon.test.js
- core/dist/util/generateRepoMap.test.js
- core/dist/util/GlobalContext.test.js
- core/dist/util/history.test.js
- core/dist/util/incrementalParseJson.test.js
- core/dist/util/index.test.js
- core/dist/util/lcs.test.js
- core/dist/util/LruCache.test.js
- core/dist/util/merge.test.js
- core/dist/util/messageContent.test.js
- core/dist/util/processTerminalStates.test.js
- core/dist/util/ranges.test.js
- core/dist/util/sentry/anonymization.test.js
- core/dist/util/sentry/SentryLogger.test.js
- core/dist/util/uri.test.js
- core/dist/util/withExponentialBackoff.test.js
- And all corresponding .d.ts and .d.ts.map files in core/dist/

---

## Summary

**Total test files found:** 122
**Files to keep:** 29 (exercised by test-autocomplete.sh)
**Files to delete:** 93 (not exercised by test-autocomplete.sh)

## Execution Plan

1. Delete all test files in `core/fetch/` (7 files)
2. Delete most LLM test files except `autodetect.vitest.ts` (12 files)
3. Delete most util test files except `LruCache.vitest.ts` (10 files)
4. Delete entire `core/dist/` directory as it contains build artifacts (64 files)

This ensures only tests actually run by `./test-autocomplete.sh` remain in the codebase.
