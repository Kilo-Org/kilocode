# Test Coverage Analysis for Autocomplete Repository

## Summary

After thorough analysis, the recommended test suite for the autocomplete-only repository should include:

✅ **Autocomplete tests** (already in script)
✅ **NextEdit tests** (needs to be added)
❌ **Other core tests** (not autocomplete-specific)

---

## Test Files Found

### 1. Autocomplete Tests ✅ INCLUDE

**Location**: `core/autocomplete/**/*.vitest.ts`

Already covered by current test script: `npm run vitest -- autocomplete`

**Files**:

- `autocomplete/postprocessing/index.vitest.ts`
- `autocomplete/filtering/test/filter.vitest.ts`
- `autocomplete/filtering/streamTransforms/charStream.vitest.ts`
- `autocomplete/filtering/streamTransforms/filterCodeBlock.vitest.ts`
- `autocomplete/filtering/streamTransforms/lineStream.vitest.ts`
- `autocomplete/generation/GeneratorReuseManager.vitest.ts`
- `autocomplete/generation/ListenableGenerator.vitest.ts`
- `autocomplete/generation/utils.vitest.ts`
- `autocomplete/snippets/gitDiffCache.vitest.ts`
- `autocomplete/templating/__tests__/formatOpenedFilesContext.vitest.ts`
- `autocomplete/templating/__tests__/renderPrompt.vitest.ts`
- `autocomplete/util/completionTestUtils.vitest.ts`
- `autocomplete/util/processSingleLineCompletion.vitest.ts`
- `autocomplete/context/root-path-context/test/RootPathContextService.vitest.ts`

**Recommendation**: ✅ **Keep in test script** (already included)

---

### 2. NextEdit Tests ✅ INCLUDE

**Location**: `core/nextEdit/**/*.vitest.ts`

NOT covered by current test script - needs to be added!

**Files** (8 total):

1. `nextEdit/DocumentHistoryTracker.vitest.ts`
2. `nextEdit/utils.vitest.ts`
3. `nextEdit/context/diffFormatting.vitest.ts`
4. `nextEdit/diff/diff.vitest.ts`
5. `nextEdit/templating/instinct.vitest.ts`
6. `nextEdit/templating/mercuryCoderNextEdit.vitest.ts`
7. `nextEdit/templating/NextEditPromptEngine.vitest.ts`
8. `nextEdit/templating/utils.vitest.ts`

**Recommendation**: ✅ **Add to test script**: `npm run vitest -- nextEdit`

---

### 3. LLM Tests ❌ DO NOT INCLUDE

**Location**: `core/llm/toolSupport.test.ts`

**Purpose**: Tests tool/function calling support for chat features (determining which LLM providers support function calling)

**Why exclude**:

- Not used by autocomplete or NextEdit
- Tool calling is for chat features (slash commands, context providers)
- Autocomplete uses LLMs for text generation only, not tool calling
- 352 lines testing various LLM provider capabilities for tools

**Recommendation**: ❌ **Exclude** - not autocomplete-related

---

### 4. Indexing Tests ❌ DO NOT INCLUDE

**Location**: `core/indexing/chunk/basic.test.ts`

**Purpose**: Tests code chunking for indexing/RAG features

**Why exclude**:

- Marked as `describe.skip` (not even running)
- Tests chunking logic for codebase indexing
- Autocomplete only uses `indexing/ignore.js` for security checks, not chunking
- Would need to keep entire indexing infrastructure just for these tests

**Recommendation**: ❌ **Exclude** - not running, not autocomplete-related

---

### 5. Utility Tests ❌ DO NOT INCLUDE

**Location**: `core/util/GlobalContext.test.ts`

**Purpose**: Tests global context storage (user preferences, telemetry settings, etc.)

**Why exclude**:

- Infrastructure/configuration management test
- Not autocomplete-specific functionality
- 327 lines testing file I/O and JSON parsing for settings
- If GlobalContext breaks, autocomplete tests would fail anyway

**Recommendation**: ❌ **Exclude** - infrastructure test, not feature-specific

---

## Recommended Test Scripts

### Option 1: Minimal Test Suite (Recommended)

**Focus**: Direct feature tests only

```bash
#!/bin/bash
set -e  # Exit on first error

pushd core
echo "🧪 Running Autocomplete Vitest tests..."
npm run vitest -- autocomplete

echo "🧪 Running NextEdit Vitest tests..."
npm run vitest -- nextEdit
popd

echo "🧪 Running VSCode unit tests..."
pushd extensions/vscode
npm test
popd

echo "✅ All autocomplete and NextEdit tests passed!"
```

**Coverage**: ~24 test files (14 autocomplete + 8 NextEdit + 2 VSCode)

### Option 2: Extended Test Suite (Maximum Safety)

**Focus**: Feature tests + infrastructure tests

```bash
#!/bin/bash
set -e  # Exit on first error

pushd core
echo "🧪 Running Autocomplete Vitest tests..."
npm run vitest -- autocomplete

echo "🧪 Running NextEdit Vitest tests..."
npm run vitest -- nextEdit

echo "🧪 Running Infrastructure tests..."
npm run vitest -- core/util/GlobalContext
popd

echo "🧪 Running VSCode unit tests..."
pushd extensions/vscode
npm test
popd

echo "✅ All tests passed!"
```

**Coverage**: ~25 test files (14 autocomplete + 8 NextEdit + 1 infrastructure + 2 VSCode)

**Recommendation**: Use **Option 1** unless you're particularly concerned about configuration storage.

See [`DEPENDENCY_ANALYSIS.md`](DEPENDENCY_ANALYSIS.md:1) for detailed reasoning on why Option 1 is sufficient.

---

## Test Coverage Strategy

### Philosophy

**Keep tests that directly verify autocomplete/NextEdit functionality.**

If a dependency breaks in a way that affects autocomplete:

1. The autocomplete tests will catch it ✅
2. If they don't catch it, we need better autocomplete tests
3. We don't need to test every dependency in isolation

### Benefits of Focused Testing

1. **Faster tests** - Only run what matters for autocomplete
2. **Clear scope** - Easy to understand what's being tested
3. **Easier maintenance** - Fewer tests to update
4. **Better signal** - Test failures directly indicate autocomplete issues

### What Gets Tested

- ✅ Autocomplete completion generation
- ✅ Autocomplete filtering and postprocessing
- ✅ Autocomplete context retrieval
- ✅ Autocomplete templating
- ✅ NextEdit prediction logic
- ✅ NextEdit formatting and diffing
- ✅ VSCode extension integration

### What's Implicitly Tested (via autocomplete tests)

- LLM token counting (used by autocomplete)
- Tree-sitter parsing (used for context)
- Diff utilities (used by filtering)
- Markdown utilities (used by filtering)
- Config handling (used by CompletionProvider)
- Security checks (used by autocomplete)

---

## VSCode Extension Tests

The current script also runs: `cd extensions/vscode && npm test`

These test the VSCode-specific autocomplete integration:

- `extensions/vscode/src/autocomplete/__tests__/ContinueCompletionProvider.vitest.ts`
- `extensions/vscode/src/autocomplete/GhostTextAcceptanceTracker.vitest.ts`

**Recommendation**: ✅ **Keep** - tests the VSCode integration layer

---

## Final Test Count

**Total tests to run**:

- ~14 autocomplete test files
- ~8 NextEdit test files
- ~2 VSCode extension test files
- **~24 test files total**

**Tests excluded**:

- 1 LLM tool support test (not autocomplete)
- 1 Indexing chunking test (skipped, not used)
- 1 Utility infrastructure test (not feature-specific)
- **3 test files excluded**

---

## Action Items

1. ✅ Update `test-autocomplete.sh` to include NextEdit tests
2. ✅ Verify all tests pass with updated script
3. ✅ Use this test script throughout the cleanup process
4. ✅ After cleanup, ensure test count hasn't accidentally decreased

---

## Dependency Test Analysis

See [`DEPENDENCY_ANALYSIS.md`](DEPENDENCY_ANALYSIS.md:1) for comprehensive analysis of:

- Which dependencies have tests
- Whether those tests are autocomplete-relevant
- Risk assessment for untested dependencies
- Detailed recommendations with pros/cons

**Key Finding**: Most dependencies either have no tests OR have tests that aren't autocomplete-relevant (tool calling, RAG chunking). The one exception is `GlobalContext.test.ts` which tests configuration storage.

## Future Considerations

If after cleanup you discover autocomplete features breaking that weren't caught by tests:

1. Add tests to autocomplete or NextEdit test suites
2. Don't add dependency tests - improve feature tests instead
3. This keeps test scope focused and maintainable

**Exception**: If you find GlobalContext storage issues affecting autocomplete, consider adding its test (see Option 2 above).
