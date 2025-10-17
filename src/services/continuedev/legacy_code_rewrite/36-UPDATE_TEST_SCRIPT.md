# Update Test Script for NextEdit

## Current Issue

The `test-autocomplete.sh` script only runs tests matching "autocomplete" in their path:

```bash
npm run vitest -- autocomplete
```

This excludes NextEdit tests located in `core/nextEdit/`, even though NextEdit has 8 test files with good coverage.

## Analysis Summary

See [`TEST_COVERAGE_ANALYSIS.md`](TEST_COVERAGE_ANALYSIS.md:1) for full details on which tests should be included and why.

## Required Change

Update `test-autocomplete.sh` to include NextEdit tests:

```bash
#!/bin/bash
set -e  # Exit on first error

pushd core
echo "🧪 Running Core Vitest tests..."
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

## NextEdit Test Files Found

The following NextEdit test files exist and should now be included (8 files):

1. `core/nextEdit/DocumentHistoryTracker.vitest.ts`
2. `core/nextEdit/utils.vitest.ts`
3. `core/nextEdit/context/diffFormatting.vitest.ts`
4. `core/nextEdit/diff/diff.vitest.ts`
5. `core/nextEdit/templating/instinct.vitest.ts`
6. `core/nextEdit/templating/mercuryCoderNextEdit.vitest.ts`
7. `core/nextEdit/templating/NextEditPromptEngine.vitest.ts`
8. `core/nextEdit/templating/utils.vitest.ts`

## Tests NOT Included

The following test files exist but should NOT be added to the test script:

- ❌ `core/llm/toolSupport.test.ts` - Tests chat tool calling, not autocomplete
- ❌ `core/indexing/chunk/basic.test.ts` - Skipped test for indexing, not autocomplete
- ❌ `core/util/GlobalContext.test.ts` - Infrastructure test, not feature-specific

See [`TEST_COVERAGE_ANALYSIS.md`](TEST_COVERAGE_ANALYSIS.md:1) for detailed reasoning.

## Action Required

**Code mode** should make this change before starting the cleanup plan, as the first step should be to verify all relevant tests pass.
