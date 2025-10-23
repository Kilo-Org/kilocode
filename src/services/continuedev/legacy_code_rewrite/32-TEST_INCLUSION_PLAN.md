# Test Inclusion Plan: Adding Critical Dependencies to test-autocomplete.sh

## Analysis Summary

After inspecting all critical and high-priority test files identified in the skipped tests analysis, here are my findings:

---

## Test Files to Include

### 1. **Diff Tests** (3 files) - KEEP ALL TESTS ✅

#### `core/diff/myers.vitest.ts`

**Relevance**: DIRECT - Myers diff algorithm is fundamental to change tracking
**Tests**: All 11 test cases
**Reason**: NextEdit uses diff functionality extensively for tracking code changes and displaying modifications. The Myers algorithm is the core diff implementation.
**Action**: Include entire file - all tests are relevant

#### `core/diff/streamDiff.vitest.ts`

**Relevance**: DIRECT - Streaming diff used in real-time change tracking
**Tests**: All 16 test cases
**Reason**: Tests streaming diff functionality which is critical for NextEdit's real-time change detection and display. Includes edge cases like indentation handling and whitespace differences.
**Action**: Include entire file - all tests are relevant

#### `core/diff/util.vitest.ts`

**Relevance**: DIRECT - Diff utilities used by NextEdit
**Tests**: All test cases (matchLine, streamLines, generateLines)
**Note**: Has 1 skipped test suite (`describe.skip`) which is already disabled
**Reason**: Utility functions used in diff processing, line matching, and streaming operations.
**Action**: Include entire file - all tests are relevant

---

### 2. **LLM Autodetection Tests** (1 file) - KEEP ALL TESTS ✅

#### `core/llm/autodetect.vitest.ts`

**Relevance**: MIXED but ALL RELEVANT
**Tests**:

- Lines 1-204: `autodetectTemplateType` tests (template detection for various models)
- Lines 205-339: `modelSupportsNextEdit` tests (NextEdit model support)

**Analysis**:

- `autodetectTemplateType`: Determines chat template for models, affecting prompt formatting for both autocomplete and NextEdit
- `modelSupportsNextEdit`: Directly imported by NextEditProvider - CRITICAL for NextEdit

**Decision**: KEEP ALL - Both test suites are relevant:

1. Model support detection is directly used by NextEdit
2. Template detection affects how LLM prompts are formatted, impacting both features
3. No benefit to removing tests; adds unnecessary complexity

**Action**: Include entire file - all tests are relevant

---

### 3. **Security Tests** (1 file) - KEEP ALL TESTS ✅

#### `core/indexing/ignore.vitest.ts`

**Relevance**: DIRECT - Security function used by both features
**Tests**: All 80+ test cases across 8 describe blocks
**Reason**:

- Both `CompletionProvider` and `NextEditProvider` import `isSecurityConcern()`
- Critical for preventing code completion/editing in sensitive files (.env, credentials, keys, etc.)
- Security is non-negotiable - all tests should run

**Action**: Include entire file - all tests are relevant

---

### 4. **Caching Tests** (1 file) - KEEP ALL TESTS ✅

#### `core/util/LruCache.vitest.ts`

**Relevance**: DIRECT - Cache implementation used by both features
**Tests**: All 6 test cases
**Reason**:

- Both features use `AutocompleteLruCache.get()` which uses `PrecalculatedLruCache`
- Tests LRU eviction, cache hits/misses, error handling
- Caching directly impacts performance of both features

**Action**: Include entire file - all tests are relevant

---

## Recommendation: No Test Removal Needed

**Finding**: ALL tests in the inspected files are relevant to autocomplete and/or NextEdit functionality.

**Rationale**:

1. **Diff tests**: Core dependency for NextEdit's change tracking
2. **Autodetect tests**: Both template detection and model support are used by LLMs that power both features
3. **Security tests**: Direct import and usage in both CompletionProvider and NextEditProvider
4. **Cache tests**: Direct usage through AutocompleteLruCache in both features

**Removing any of these tests would reduce coverage of critical dependencies.**

---

## Updated test-autocomplete.sh

### Current Script:

```bash
#!/bin/bash

pushd core
npm test -- autocomplete nextEdit vscode-test-harness
popd
```

### Proposed Updated Script:

```bash
#!/bin/bash

pushd core
npm test -- autocomplete nextEdit vscode-test-harness diff llm/autodetect indexing/ignore util/LruCache
popd
```

### What This Includes:

- `autocomplete` - 5 autocomplete test files (original)
- `nextEdit` - 13 NextEdit test files (original)
- `vscode-test-harness` - 6 VSCode integration test files (original)
- `diff` - 3 diff algorithm test files (NEW)
- `llm/autodetect` - 1 LLM model detection test file (NEW)
- `indexing/ignore` - 1 security filtering test file (NEW)
- `util/LruCache` - 1 caching test file (NEW)

**Total**: 29 test files (was 24, added 5 critical dependency test files)

---

## Alternative: More Comprehensive Coverage

If you want even more coverage, consider including:

```bash
#!/bin/bash

pushd core
npm test -- "autocomplete|nextEdit|vscode-test-harness|diff|llm/autodetect|indexing/ignore|util/LruCache"
popd
```

Or for maximum safety, just run all tests:

```bash
#!/bin/bash

pushd core
npm test
popd
```

---

## Verification

After updating the script, verify the included tests:

```bash
# Dry run to see which tests would be executed
cd core
npm test -- --reporter=verbose autocomplete nextEdit vscode-test-harness diff llm/autodetect indexing/ignore util/LruCache
```

---

## Conclusion

**No test removal is necessary.** All identified critical and high-priority test files contain only relevant tests for autocomplete and NextEdit functionality.

The updated script adds 5 test files (6 if we count all util tests) that test direct dependencies used by both features, significantly improving test coverage without including irrelevant tests.
