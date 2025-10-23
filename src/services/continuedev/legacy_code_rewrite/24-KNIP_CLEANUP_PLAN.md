# Knip-Based Cleanup Plan

## Analysis Summary

Based on knip-phase7-analysis.txt and repository inspection, the codebase has:

- **32 unused files** identified by knip
- **180 unused exports** (mostly language info and internal utilities)
- **Dual test infrastructure**: Both Jest (.test.ts) and Vitest (.vitest.ts)
- **Current test script**: Only runs Vitest tests (446 core + 86 vscode-test-harness)

## Current Test Infrastructure

### Jest Tests (.test.ts files - NOT run by test-autocomplete.sh)

- `core/fetch/*.test.ts` - 9 test files testing fetch infrastructure
- `core/util/*.test.ts` - 15+ test files testing utilities
- `core/llm/*.test.ts` - 4 test files testing LLM functionality
- `core/test/testEnv.test.ts` - 1 environment test

**Total**: ~30 .test.ts files with extensive test coverage

### Vitest Tests (.vitest.ts files - RUN by test-autocomplete.sh)

- `core/autocomplete/**/*.vitest.ts` - Autocomplete tests (primary feature)
- `core/nextEdit/**/*.vitest.ts` - NextEdit tests (primary feature)
- `core/diff/*.vitest.ts` - Diff utilities tests
- `core/vscode-test-harness/test/*.vitest.ts` - VSCode integration tests

**Total**: 532 tests (446 core + 86 vscode)

## Strategy: Migrate Important Tests, Remove Jest

Since autocomplete and nextEdit depend on core utilities (fetch, util, etc.), we should:

1. Keep tests for critical dependencies
2. Migrate important .test.ts to .vitest.ts format
3. Remove Jest infrastructure entirely
4. Remove unused files identified by knip

---

## General rules:

IMPORTANT: Test frequently:

- after making any change, run ./test-autocomplete.sh to make sure nothing broke
- in the core directory, run "npm run typecheck" to ensure typesafety
- Make a git commit with a clear message, so that if we change our minds later, it's easy to know where to look.
- Where possible, prefer NOT to make multiple mostly unrelated changes at a time; prefer small steps and commits over large bundles of changes in a commit

## Phase 1: Immediate Cleanup (Safe Removals)

### 1.1: Remove Unused Mock Files

```bash
git rm core/__mocks__/@continuedev/fetch/index.ts
```

**Verification**: No imports of `@continuedev/fetch` mock found

### 1.2: Remove Unused LLM Files

```bash
# Core unused LLM files
git rm core/llm/llms/index.ts
git rm core/llm/llms/llm.ts
git rm core/llm/llms/llmTestHarness.ts
git rm core/llm/streamChat.ts
git rm core/llm/defaultSystemMessages.ts

# Unused LLM utilities
git rm core/llm/utils/calculateRequestCost.ts
git rm core/llm/utils/parseArgs.ts

# Unused templates
git rm -r core/llm/templates/edit/

# Unused rules utilities
git rm core/llm/rules/constants.ts
git rm core/llm/rules/rules-utils.ts
```

### 1.3: Remove Unused Utility Files

```bash
# Handlebars utilities (unused)
git rm -r core/util/handlebars/

# Individual unused utilities
git rm core/util/ideUtils.ts
git rm core/util/shellPath.ts
git rm core/util/tts.ts
git rm core/util/url.ts
git rm core/util/sentry/constants.ts
```

### 1.4: Remove Unused Test Setup Files

```bash
# Vitest configs that knip flagged (check if actually unused)
# These are referenced by core/vitest.config.ts, so keep for now
# git rm core/test/vitest.global-setup.ts
# git rm core/test/vitest.setup.ts
```

### 1.5: Remove Unused llm-info File

```bash
git rm core/llm-info/util.ts
```

### 1.6: Remove Empty control-plane Directory

```bash
# Already empty, just verify
ls -la core/control-plane/ || echo "Already removed"
```

**After Phase 1:**

- Run `./test-autocomplete.sh` to ensure tests still pass
- Commit: "Remove unused files identified by knip (Phase 1)"

---

## Phase 2: Test Migration Strategy

### 2.1: Critical Tests to Migrate (Keep Functionality)

#### High Priority - Direct Dependencies of Autocomplete/NextEdit

**fetch/ tests** (Direct dependency):

- ✅ `fetch.e2e.test.ts` → `fetch.e2e.vitest.ts` - End-to-end fetch tests
- ✅ `certs.test.ts` → `certs.vitest.ts` - Certificate handling
- ✅ `getAgentOptions.test.ts` → `getAgentOptions.vitest.ts` - Agent options
- ✅ `ssl-certificate.test.ts` → `ssl-certificate.vitest.ts` - SSL handling
- ✅ `stream.test.ts` → `stream.vitest.ts` - Streaming utilities
- ✅ `util.test.ts` → `util.vitest.ts` - Proxy and fetch utilities

**util/ tests** (Utility functions used by autocomplete/nextEdit):

- ✅ `ranges.test.ts` → `ranges.vitest.ts` - Range calculations (used by nextEdit)
- ✅ `extractMinimalStackTraceInfo.test.ts` → Keep (error handling)
- ✅ `incrementalParseJson.test.ts` → Keep (JSON parsing)
- ✅ `messageContent.test.ts` → Keep (message handling)
- ✅ `index.test.ts` → `index.vitest.ts` - Core utilities (deduplicateArray, dedent, etc.)

#### Medium Priority - Infrastructure Tests

**llm/ tests** (LLM infrastructure):

- ✅ `llm.test.ts` → Keep or simplify - Tests multiple LLM providers
- ✅ `OpenAI.test.ts` → `llm/llms/OpenAI.vitest.ts` - OpenAI specific tests
- ⚠️ `toolSupport.test.ts` → Review if tool support is needed

**util/ tests** (Less critical but useful):

- ⚠️ `LruCache.test.ts` → `LruCache.vitest.ts` - Used by autocomplete context
- ⚠️ `GlobalContext.test.ts` → Consider if GlobalContext is used
- ⚠️ `processTerminalStates.test.ts` → Review if terminal state tracking is needed

#### Low Priority - Can Remove

**util/ tests** (Not directly needed):

- ❌ `history.test.ts` - Session history not needed for autocomplete
- ❌ `chatDescriber.test.ts` - Chat descriptions not needed
- ❌ `fetchFavicon.test.ts` - Favicon fetching not needed
- ❌ `withExponentialBackoff.test.ts` - Retry logic not critical
- ❌ `merge.test.ts` - JSON merging utility, check if used
- ❌ `uri.test.ts` - URI utilities, check if used
- ❌ `generateRepoMap.test.ts` - Repo map generation not needed
- ❌ `sentry/*.test.ts` - Sentry/error tracking can be simplified

### 2.2: Migration Process for Each File

For each test file to migrate:

1. **Copy and rename**:

    ```bash
    cp core/util/ranges.test.ts core/util/ranges.vitest.ts
    ```

2. **Update imports** (if needed):

    ```typescript
    // Change from:
    import { test, expect, describe } from "@jest/globals"

    // To:
    import { test, expect, describe, it, beforeEach, afterEach } from "vitest"
    ```

3. **Update mocking syntax** (if any):

    ```typescript
    // Change from:
    jest.fn()
    jest.mock()

    // To:
    import { vi } from "vitest"
    vi.fn()
    vi.mock()
    ```

4. **Verify test runs**:

    ```bash
    cd core
    npm run vitest -- util/ranges.vitest.ts
    ```

5. **Remove original .test.ts**:
    ```bash
    git rm core/util/ranges.test.ts
    ```

---

## Phase 3: Remove Jest Infrastructure

After migrating critical tests:

### 3.1: Remove Jest Configuration

```bash
git rm core/jest.config.js
git rm core/test/jest.global-setup.ts
git rm core/test/jest.setup-after-env.js
```

### 3.2: Update package.json

Remove Jest-related scripts and dependencies:

```json
// Remove from scripts:
"test": "cross-env NODE_OPTIONS=--experimental-vm-modules jest",
"test:coverage": "cross-env NODE_OPTIONS=--experimental-vm-modules jest --coverage",

// Remove from devDependencies:
"@types/jest": "^29.5.12",
"jest": "^29.7.0",
"jest-environment-jsdom": "^29.7.0",
```

Add Vitest scripts:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

### 3.3: Update test-autocomplete.sh

```bash
#!/bin/bash
set -e

pushd core
echo "🧪 Running all Core tests..."
npm test  # Now runs vitest instead of jest
popd

echo "🧪 Running VSCode Integration tests..."
pushd core/vscode-test-harness
npm test
popd

echo "✅ All tests passed!"
```

### 3.4: Remove Remaining .test.ts Files

```bash
# Find all remaining .test.ts files
find core -name "*.test.ts" -not -path "*/node_modules/*"

# Remove them
git rm core/util/history.test.ts
git rm core/util/chatDescriber.test.ts
# ... etc for all unmigrated test files
```

---

## Phase 4: Update Knip Configuration

### 4.1: Update knip.json Entry Points

```json
{
	"$schema": "https://unpkg.com/knip@latest/schema.json",
	"entry": ["core/autocomplete/CompletionProvider.ts", "core/nextEdit/NextEditProvider.ts", "core/**/*.vitest.ts"],
	"project": ["core/**/*.ts"],
	"ignore": ["**/*.d.ts", "**/node_modules/**", "**/dist/**"],
	"ignoreDependencies": ["@types/*"]
}
```

Remove .test.ts from entry points since we're removing Jest.

---

## Phase 5: Final Verification

### 5.1: Run Knip Again

```bash
npx knip --include files,exports,types,dependencies > knip-post-cleanup.txt 2>&1
```

Expected improvements:

- Unused files: 32 → ~5 (only truly unavoidable unused items)
- Unused exports: 180 → ~50 (internal utilities, language info constants)

### 5.2: Run All Tests

```bash
./test-autocomplete.sh
```

Expected: All 532+ tests pass (may be more after migrations)

### 5.3: Verify No Regressions

- Check that autocomplete still works
- Check that nextEdit still works
- No broken imports or missing dependencies

---

## Execution Order Summary

1. **Phase 1** (Safe cleanup): Remove obviously unused files
    - Commit after each sub-phase
    - Run tests after each commit
2. **Phase 2** (Test migration): Migrate critical .test.ts → .vitest.ts
    - Migrate high-priority tests first
    - Test each migration individually
    - Can be done over multiple sessions
3. **Phase 3** (Remove Jest): Clean up Jest infrastructure
    - Only after Phase 2 migrations are complete
    - Update package.json and scripts
    - Remove all remaining .test.ts files
4. **Phase 4** (Update knip): Adjust knip configuration
    - Remove .test.ts entry points
    - Re-run knip analysis
5. **Phase 5** (Final verification): Comprehensive testing
    - Run all tests
    - Verify knip results
    - Document final state

---

## Risk Assessment

### Low Risk

- Phase 1 removals (unused files with no imports)
- Removing handlebars, tts, url utilities (clearly unused)

### Medium Risk

- Test migrations (syntax differences between Jest and Vitest)
- Removing LLM files (verify no hidden dependencies)

### High Risk

- Removing fetch tests without migration (fetch is critical)
- Removing util tests without migration (utilities are widely used)

**Mitigation**: Migrate critical tests before removing anything test-related.

---

## Expected Outcome

### Before Cleanup

- 32 unused files flagged by knip
- 180 unused exports
- Dual test infrastructure (Jest + Vitest)
- ~30 .test.ts files not run by test-autocomplete.sh

### After Cleanup

- <10 truly unused files (unavoidable language constants, etc.)
- ~50 unused exports (internal constants)
- Single test infrastructure (Vitest only)
- All tests migrated and passing
- Simpler, more maintainable codebase

---

## Next Steps

Since you chose Option C (migration approach), I recommend starting with:

1. **Immediate**: Execute Phase 1 (safe removals) today
2. **Next session**: Begin Phase 2 test migrations (high priority first)
3. **After migrations**: Execute Phase 3 (remove Jest)
4. **Final**: Run Phase 4 and 5 for verification

Would you like me to proceed with Phase 1 now?
