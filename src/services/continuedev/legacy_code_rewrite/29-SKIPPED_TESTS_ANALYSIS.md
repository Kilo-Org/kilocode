# Analysis: Tests Skipped by `npm test -- autocomplete nextEdit vscode-test-harness`

## Executive Summary

The command `npm test -- autocomplete nextEdit vscode-test-harness` runs vitest with pattern matching, which means it will **ONLY** run tests whose file paths contain these strings. All other tests will be skipped.

**Critical Finding**: Several skipped tests are **highly relevant** to NextEdit and autocomplete functionality due to shared dependencies.

---

## Test Execution Breakdown

### Tests That WILL RUN (18 files)

#### Autocomplete Tests (5 files)

- `core/autocomplete/generation/GeneratorReuseManager.vitest.ts`
- `core/autocomplete/generation/ListenableGenerator.vitest.ts`
- `core/autocomplete/generation/utils.vitest.ts`
- `core/autocomplete/context/root-path-context/RootPathContextService.vitest.ts`
- `core/autocomplete/postprocessing/index.vitest.ts`

#### NextEdit Tests (13 files)

- `core/nextEdit/DocumentHistoryTracker.vitest.ts`
- `core/nextEdit/utils.vitest.ts`
- `core/nextEdit/context/aggregateEdits.vitest.ts`
- `core/nextEdit/context/autocompleteContextFetching.vitest.ts`
- `core/nextEdit/context/diffFormatting.vitest.ts`
- `core/nextEdit/context/prevEditLruCache.vitest.ts`
- `core/nextEdit/context/processNextEditData.vitest.ts`
- `core/nextEdit/context/processSmallEdit.vitest.ts`
- `core/nextEdit/diff/diff.vitest.ts`
- `core/nextEdit/templating/instinct.vitest.ts`
- `core/nextEdit/templating/mercuryCoderNextEdit.vitest.ts`
- `core/nextEdit/templating/NextEditPromptEngine.vitest.ts`
- `core/nextEdit/templating/utils.vitest.ts`

#### VSCode Test Harness Tests (6 files)

- `core/vscode-test-harness/test/ContinueCompletionProvider.vitest.ts`
- `core/vscode-test-harness/test/GhostTextAcceptanceTracker.vitest.ts`
- `core/vscode-test-harness/test/JumpManager.vitest.ts`
- `core/vscode-test-harness/test/NextEditWindowManager.vitest.ts`
- `core/vscode-test-harness/test/SelectionChangeManager.vitest.ts`
- `core/vscode-test-harness/test/util.vitest.ts`

---

## Tests That WILL BE SKIPPED (28+ files)

### HIGH RELEVANCE - Direct Dependencies ⚠️

These tests cover functionality directly used by NextEdit and/or autocomplete:

#### 1. **Diff Functionality** (3 files) - 🔴 CRITICAL

- `core/diff/myers.vitest.ts`
- `core/diff/streamDiff.vitest.ts`
- `core/diff/util.vitest.ts`

**Why Relevant**:

- NextEdit uses `createDiff` from `./context/diffFormatting.ts`
- CompletionProvider may use diff functionality for change detection
- NextEdit has its own diff implementation in `core/nextEdit/diff/` but also uses core diff utilities
- The Myers diff algorithm is fundamental to change tracking

**Impact**: Without these tests, diff-related bugs could go undetected, affecting NextEdit's ability to accurately track and display changes.

#### 2. **LLM Functionality** (8 files) - 🔴 CRITICAL

- `core/llm/autodetect.vitest.ts`
- `core/llm/llm-pre-fetch.vitest.ts`
- `core/llm/llm.vitest.ts`
- `core/llm/llms/OpenAI.vitest.ts`
- `core/llm/llms/stubs/ContinueProxy.vitest.ts`
- `core/llm/rules/getSystemMessageWithRules.vitest.ts`
- `core/llm/rules/alwaysApply.vitest.ts`
- `core/llm/rules/alwaysApplyRules.vitest.ts`

**Why Relevant**:

- NextEditProvider imports `modelSupportsNextEdit` from `../llm/autodetect.js`
- Both NextEdit and autocomplete rely on OpenAI LLM class
- CompletionProvider sets `useLegacyCompletionsEndpoint = true` for OpenAI instances
- Rules affect system messages that control LLM behavior
- Pre-fetching and caching impact performance

**Impact**: LLM-related bugs could cause model selection issues, incorrect prompts, or performance problems for both features.

#### 3. **Security/Indexing** (1 file) - 🟡 MEDIUM

- `core/indexing/ignore.vitest.ts`

**Why Relevant**:

- Both CompletionProvider and NextEditProvider import `isSecurityConcern` from `../indexing/ignore.js`
- Security checks prevent completion/edit suggestions in sensitive contexts

**Impact**: Security vulnerabilities could allow suggestions in contexts where they should be blocked.

---

### MEDIUM RELEVANCE - Indirect Dependencies 🟡

#### 4. **Utility Functions** (9 files)

- `core/util/extractMinimalStackTraceInfo.vitest.ts`
- `core/util/index.vitest.ts`
- `core/util/log.vitest.ts`
- `core/util/LruCache.vitest.ts`
- `core/util/markdownUtils.vitest.ts`
- `core/util/messageContent.vitest.ts`
- `core/util/processTerminalStates.vitest.ts`
- `core/util/regexValidator.vitest.ts`
- `core/util/text.vitest.ts`

**Why Relevant**:

- LruCache: Both features use `AutocompleteLruCache.get()` for caching
- Logging: Errors and debugging depend on logging infrastructure
- Text utilities: String manipulation for code analysis
- Message content: Chat message formatting affects prompts

**Impact**: Utility bugs could cause subtle issues in caching, logging, or text processing.

#### 5. **Fetch/Network** (6 files)

- `core/fetch/certs.vitest.ts`
- `core/fetch/fetch.e2e.vitest.ts`
- `core/fetch/getAgentOptions.vitest.ts`
- `core/fetch/ssl-certificate.vitest.ts`
- `core/fetch/stream.vitest.ts`
- `core/fetch/util.vitest.ts`

**Why Relevant**:

- LLM calls require HTTP/HTTPS communication
- SSL/certificate handling affects API connectivity
- Streaming is used for completion generation

**Impact**: Network issues could prevent LLM communication, breaking both features.

---

### LOW RELEVANCE - Configuration/Rules 🟢

#### 6. **LLM Rules** (5 files)

- `core/llm/rules/fileProtocolMatching.vitest.ts`
- `core/llm/rules/implicitGlobalRules.vitest.ts`
- `core/llm/rules/nestedDirectoryRules.vitest.ts`
- `core/llm/rules/ruleColocation.vitest.ts`

**Why Relevant**:

- Rules affect LLM behavior indirectly through system messages
- File protocol matching could affect context gathering

**Impact**: Rules bugs might cause incorrect LLM behavior, but are less directly connected to core functionality.

---

## Recommendations

### Priority 1: CRITICAL - Add to Test Suite Immediately

1. **All diff tests** (`core/diff/*.vitest.ts`)
    - Rationale: NextEdit fundamentally depends on diff functionality
2. **Core LLM tests**:
    - `core/llm/autodetect.vitest.ts` (model detection)
    - `core/llm/llm.vitest.ts` (base LLM functionality)
    - `core/llm/llms/OpenAI.vitest.ts` (OpenAI-specific behavior)

### Priority 2: HIGH - Strongly Recommend Including

3. **Security test**: `core/indexing/ignore.vitest.ts`
    - Rationale: Prevents security issues
4. **Caching test**: `core/util/LruCache.vitest.ts`

    - Rationale: Both features use AutocompleteLruCache

5. **Pre-fetch test**: `core/llm/llm-pre-fetch.vitest.ts`
    - Rationale: Performance optimization test

### Priority 3: MEDIUM - Consider Including for Comprehensive Coverage

6. **Fetch/streaming tests** (especially `core/fetch/stream.vitest.ts`)
7. **Logging tests** (`core/util/log.vitest.ts`)
8. **Rules tests** (especially `getSystemMessageWithRules.vitest.ts`)

---

## Proposed Test Command

To include critical dependencies, consider:

```bash
npm test -- autocomplete nextEdit vscode-test-harness diff llm/autodetect llm/llm.vitest llm/llms/OpenAI indexing/ignore util/LruCache
```

Or run all tests:

```bash
npm test
```

---

## Dependency Graph Insights

### NextEdit Dependencies

```
NextEditProvider
├── autocomplete/context/ContextRetrievalService (TESTED)
├── autocomplete/generation/CompletionStreamer (TESTED)
├── autocomplete/postprocessing (TESTED)
├── autocomplete/prefiltering (TESTED)
├── llm/autodetect (NOT TESTED) ⚠️
├── diff functionality (NOT TESTED) ⚠️
├── indexing/ignore (NOT TESTED) ⚠️
└── util/LruCache (NOT TESTED) ⚠️
```

### Autocomplete Dependencies

```
CompletionProvider
├── autocomplete/context/ContextRetrievalService (TESTED)
├── autocomplete/generation/* (TESTED)
├── autocomplete/postprocessing (TESTED)
├── autocomplete/prefiltering (TESTED)
├── llm/llms/OpenAI (NOT TESTED) ⚠️
├── diff functionality (NOT TESTED) ⚠️
├── indexing/ignore (NOT TESTED) ⚠️
└── util/LruCache (NOT TESTED) ⚠️
```

---

## Conclusion

While the filtered test command provides focused testing for autocomplete and NextEdit modules, **it skips 11+ tests that are highly relevant** to the correct functioning of these features. The most critical gaps are:

1. **Diff functionality** - Essential for NextEdit change tracking
2. **LLM autodetection** - Critical for model selection
3. **Core LLM behavior** - Foundation for both features
4. **Security checks** - Prevents dangerous completions
5. **Caching mechanisms** - Affects performance

**Recommendation**: Either include the critical skipped tests in the test command, or run the full test suite to ensure comprehensive coverage of dependencies.
