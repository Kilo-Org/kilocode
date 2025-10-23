# Minimal Autocomplete & NextEdit Extraction Plan

**Goal**: Retain ONLY autocomplete and NextEdit functionality from Continue into a minimal, reusable library with zero dead code.

**Knip-Driven**: Use Knip at each phase to validate no dead code remains

**Test Validation**: IMPORTANT: after EVERY CHANGE run `./test-autocomplete.sh` and make sure all tests pass. (532 tests).

**Ignored files** If you delete a directory, don't forget to also delete the ignored files therein; otherwise we might accidentally commit temporary files.

**Moving files** When moving files or rearranging code, don't forget to update references to those files, including in things like package.json

**Package updates** When updating package.json, call npm install where relevant.

**Commit regularly**: After each step, and after ensuring the tests still pass, make a commit with a GOOD commit message. Check the `git status` before committing to make sure you're committing what you expect.

---

## Phase 1: Archive Legacy Docs & Remove Unrelated Directories

**Objective**: Clean workspace by archiving old plans and removing directories completely unrelated to autocomplete/nextEdit

**Actions**:

### 1A: Archive Legacy Documentation

Create `legacy_code_rewrite/` and move old analysis/plan files:

```bash
mkdir -p legacy_code_rewrite
mv AUTOCOMPLETE_CLEANUP_PLAN.md legacy_code_rewrite/
mv CLEANUP_SUMMARY.md legacy_code_rewrite/
mv DEPENDENCY_ANALYSIS.md legacy_code_rewrite/
mv PHASE8_KNIP_FINAL_REPORT.md legacy_code_rewrite/
mv PHASE8_PACKAGE_MERGE_FINAL_REPORT.md legacy_code_rewrite/
mv PACKAGE_MERGE_PLAN.md legacy_code_rewrite/
mv PACKAGE_MERGE_COMPLETE.md legacy_code_rewrite/
mv KNIP_ANALYSIS.md legacy_code_rewrite/
mv TEST_COVERAGE_ANALYSIS.md legacy_code_rewrite/
mv TREE_SITTER_ANALYSIS.md legacy_code_rewrite/
mv UPDATE_TEST_SCRIPT.md legacy_code_rewrite/
mv knip-report*.txt legacy_code_rewrite/
mv final-dead-code-report.txt legacy_code_rewrite/
mv unused-utils-report.txt legacy_code_rewrite/
mv merge-packages.sh legacy_code_rewrite/
```

### 1B: Remove Completely Unrelated Directories

Delete entire directories not needed for autocomplete/nextEdit:

```bash
# CLI extension - command line agent, not related to autocomplete/nextEdit
git rm -r extensions/cli/

# GUI - web UI for chat interface, not needed
git rm -r gui/

# General documentation - not needed
git rm -r docs/

# Testing sandbox - not needed
git rm -r manual-testing-sandbox/

# Marketing/media assets - not needed
git rm -r media/

# Build/deployment scripts - will create minimal test script later
git rm -r scripts/

# IDE configurations - not needed
rm -rf .idea/ .vscode/ .continue/

# Git hooks - not needed
git rm -r .husky/

# Extensions debug folder
rm -rf extensions/.continue-debug/

# Root-level unnecessary configs and docs
git rm .eslintrc.shared.json .prettierignore .prettierrc
git rm CONTRIBUTING.md CODE_OF_CONDUCT.md CLA.md SECURITY.md
git rm LICENSE README.md

# Empty packages directory (from previous merge)
git rm -r packages/

./test-autocomplete.sh  # Should still pass (no code changes)
git commit -m "Remove directories unrelated to autocomplete/nextEdit"
```

**Test**: All 532 tests still pass, workspace much cleaner

**Keep at Root** (after Phase 1):

- `core/` - main code (will contain vscode-test-harness after Phase 1.5)
- `test-autocomplete.sh` - test runner
- `knip.json` - static analysis config
- `package.json`, `package-lock.json` - root package management
- `tsconfig.json` - TypeScript config
- `.gitignore`, `.node-version`, `.nvmrc` - minimal project config
- `legacy_code_rewrite/` - archived analysis files

---

## Phase 1.5: Analyze VSCode Tests & Merge Extension into Core

**Objective**: Determine which VSCode tests are relevant, then merge the minimal extension into core/ as a test harness

**Current VSCode Tests** (6 test files, 86 tests total):

```
extensions/vscode/src/autocomplete/__tests__/ContinueCompletionProvider.vitest.ts
extensions/vscode/src/autocomplete/GhostTextAcceptanceTracker.vitest.ts
extensions/vscode/src/activation/NextEditWindowManager.vitest.ts
extensions/vscode/src/activation/JumpManager.vitest.ts
extensions/vscode/src/activation/SelectionChangeManager.vitest.ts
extensions/vscode/src/util/util.vitest.ts
```

**Actions**:

### Step 1: Analyze Each Test File

**✅ KEEP: ContinueCompletionProvider.vitest.ts** (488 lines)

- Tests completion provider that integrates autocomplete + NextEdit
- Tests chain management, prefetch queue, jump manager integration
- **Reason**: Core integration test for both features

**✅ KEEP: GhostTextAcceptanceTracker.vitest.ts** (246 lines)

- Tests inline completion acceptance tracking
- Validates cursor position after ghost text acceptance
- **Reason**: Tests autocomplete acceptance mechanism

**✅ KEEP: NextEditWindowManager.vitest.ts** (970 lines)

- Tests NextEdit visual UI and decorations
- Tests key reservation (Tab/Esc), accept/reject flow
- Tests race condition prevention
- **Reason**: Tests NextEdit UI integration with VSCode

**✅ KEEP: JumpManager.vitest.ts** (596 lines)

- Tests jump suggestions between NextEdit regions
- Tests decoration rendering, accept/reject commands
- **Reason**: Tests NextEdit navigation feature

**✅ KEEP: SelectionChangeManager.vitest.ts** (899 lines)

- Tests selection change handling for NextEdit triggering
- Tests prefetch queue integration, debouncing
- **Reason**: Tests NextEdit trigger mechanism

**⚠️ BORDERLINE: util.vitest.ts** (79 lines)

- Tests platform detection, extension version detection
- **Reason**: Not directly related but harmless utility tests
- **Decision**: KEEP (small, no dependencies)

2. **Identify Extension Code Required by Tests**:

    Based on test imports, the extension needs:

    ```typescript
    // Core integration layer
    extensions/vscode/src/autocomplete/completionProvider.ts
    extensions/vscode/src/autocomplete/GhostTextAcceptanceTracker.ts
    extensions/vscode/src/autocomplete/statusBar.ts (mocked in tests)
    extensions/vscode/src/autocomplete/lsp.ts (mocked in tests)
    extensions/vscode/src/autocomplete/recentlyEdited.ts (mocked in tests)
    extensions/vscode/src/autocomplete/RecentlyVisitedRangesService.ts (mocked in tests)

    // NextEdit integration
    extensions/vscode/src/activation/NextEditWindowManager.ts
    extensions/vscode/src/activation/JumpManager.ts
    extensions/vscode/src/activation/SelectionChangeManager.ts

    // Core interfaces
    extensions/vscode/src/VsCodeIde.ts
    extensions/vscode/src/webviewProtocol.ts (minimal stub)

    // Utilities
    extensions/vscode/src/util/util.ts
    extensions/vscode/src/util/getTheme.ts
    extensions/vscode/src/util/errorHandling.ts
    ```

3. **Identify Extension Code to REMOVE**:

    ```
    ❌ extensions/vscode/src/extension.ts (main entry point - not needed)
    ❌ extensions/vscode/src/commands.ts (command registration - not needed)
    ❌ extensions/vscode/src/suggestions.ts (if not used by tests)
    ❌ extensions/vscode/src/activation/activate.ts (activation logic)
    ❌ extensions/vscode/src/activation/api.ts (API exports)
    ❌ extensions/vscode/src/activation/InlineTipManager.ts (if not tested)
    ❌ extensions/vscode/src/activation/languageClient.ts (language server)
    ❌ extensions/vscode/src/activation/proxy.ts (proxy logic)
    ❌ extensions/vscode/src/extension/* (VsCodeExtension, messenger, etc.)
    ❌ extensions/vscode/scripts/* (ALL build scripts)
    ❌ extensions/vscode/e2e/* (e2e tests - separate from unit tests)
    ❌ extensions/vscode/media/* (icons, images)
    ❌ extensions/vscode/models/* (ML models)
    ❌ extensions/vscode/textmate-syntaxes/* (syntax highlighting)
    ```

4. **Create analysis document**:

```markdown
# VSCode Extension Test Analysis

## Summary

All 6 test files (86 tests) are relevant to autocomplete/nextEdit integration testing.

## Keep vs Remove

### KEEP (Test Files)

- ✅ All 6 .vitest.ts files in src/
- ✅ vitest.config.ts

### KEEP (Source Files - Required by Tests)

- ✅ src/autocomplete/completionProvider.ts
- ✅ src/autocomplete/GhostTextAcceptanceTracker.ts
- ✅ src/activation/NextEditWindowManager.ts
- ✅ src/activation/JumpManager.ts
- ✅ src/activation/SelectionChangeManager.ts
- ✅ src/VsCodeIde.ts
- ✅ src/util/util.ts
- ✅ src/util/getTheme.ts
- ✅ Minimal stubs for mocked dependencies

### REMOVE (Not Needed for Tests)

- ❌ src/extension.ts, src/commands.ts
- ❌ src/activation/activate.ts, api.ts, InlineTipManager.ts, languageClient.ts, proxy.ts
- ❌ src/extension/\* (entire directory)
- ❌ scripts/\* (ALL build/package scripts)
- ❌ e2e/\* (e2e tests different from unit tests)
- ❌ media/_, models/_, textmate-syntaxes/\*
- ❌ Build configuration beyond vitest

## Result

Extension becomes a minimal test harness with ~10-15 source files supporting 86 integration tests.
```

**Output**: Document findings in `VSCODE_EXTENSION_TEST_ANALYSIS.md`

---

### Step 2: Merge VSCode Extension into Core

**Objective**: Consolidate the extension test harness into core/ to simplify project structure

**Actions**:

1. **Create test harness directory**:

```bash
mkdir -p core/vscode-test-harness/src
mkdir -p core/vscode-test-harness/test
```

2. **Copy minimal required source files** (identified in Step 1):

```bash
# Core integration layer
cp -r extensions/vscode/src/autocomplete core/vscode-test-harness/src/
cp extensions/vscode/src/VsCodeIde.ts core/vscode-test-harness/src/
cp extensions/vscode/src/webviewProtocol.ts core/vscode-test-harness/src/

# NextEdit integration
mkdir -p core/vscode-test-harness/src/activation
cp extensions/vscode/src/activation/NextEditWindowManager.ts core/vscode-test-harness/src/activation/
cp extensions/vscode/src/activation/JumpManager.ts core/vscode-test-harness/src/activation/
cp extensions/vscode/src/activation/SelectionChangeManager.ts core/vscode-test-harness/src/activation/

# Utilities
mkdir -p core/vscode-test-harness/src/util
cp extensions/vscode/src/util/util.ts core/vscode-test-harness/src/util/
cp extensions/vscode/src/util/getTheme.ts core/vscode-test-harness/src/util/
cp extensions/vscode/src/util/errorHandling.ts core/vscode-test-harness/src/util/

# Test files
cp extensions/vscode/src/autocomplete/__tests__/*.vitest.ts core/vscode-test-harness/test/
cp extensions/vscode/src/autocomplete/*.vitest.ts core/vscode-test-harness/test/
cp extensions/vscode/src/activation/*.vitest.ts core/vscode-test-harness/test/
cp extensions/vscode/src/util/*.vitest.ts core/vscode-test-harness/test/

# Test configuration
cp extensions/vscode/vitest.config.ts core/vscode-test-harness/
```

3. **Create minimal package.json for test harness**:

```bash
cat > core/vscode-test-harness/package.json << 'EOF'
{
  "name": "@continuedev/vscode-test-harness",
  "version": "0.0.1",
  "private": true,
  "description": "Test harness demonstrating VSCode integration for autocomplete and NextEdit",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/vscode": "^1.80.0",
    "vscode": "^1.1.37",
    "vitest": "^1.0.0"
  }
}
EOF
```

4. **Update import paths** in copied files:

```bash
# Update imports from 'core/...' to '../../...' (relative to new location)
# Example: 'core/autocomplete/...' -> '../../../autocomplete/...'
find core/vscode-test-harness -name "*.ts" -type f -exec sed -i '' \
  -e 's|from "core/|from "../../../|g' \
  -e 's|from '\''core/|from '\''../../../|g' {} +
```

5. **Update test-autocomplete.sh** to include new location:

```bash
# Edit test-autocomplete.sh to add:
echo "🧪 Running VSCode Integration tests..."
pushd core/vscode-test-harness
npm test
popd
```

6. **Delete original extensions/vscode/**:

```bash
git rm -r extensions/vscode/
```

7. **Delete empty extensions/ directory**:

```bash
rm -rf extensions/
```

8. **Test the merge**:

```bash
cd core/vscode-test-harness
npm install
npm test  # Should run all 86 tests

cd ../..
./test-autocomplete.sh  # Should now run 446 + 86 = 532 tests
```

**Test**: All 532 tests pass from new location

**Result**:

- extensions/ directory completely removed
- VSCode integration tests now in `core/vscode-test-harness/`
- Project structure simplified: only core/ and minimal root files remain

---

## Phase 2: Initial Knip Analysis with Core-Only Entry Points

**Objective**: Understand current dependencies by analyzing from autocomplete/nextEdit entry points only

**Actions**:

1. Update `knip.json` to treat autocomplete/nextEdit as isolated entry points:

```json
{
	"$schema": "https://unpkg.com/knip@latest/schema.json",
	"entry": [
		"core/autocomplete/CompletionProvider.ts",
		"core/nextEdit/NextEditProvider.ts",
		"core/**/*.test.ts",
		"core/**/*.vitest.ts"
	],
	"project": ["core/**/*.ts"],
	"ignore": ["**/*.d.ts", "**/node_modules/**", "**/dist/**", "extensions/**"],
	"ignoreDependencies": ["@types/*"]
}
```

2. Run comprehensive Knip analysis:

```bash
npx knip --include files,exports,types,dependencies > knip-initial-core-only.txt 2>&1
```

3. Analyze results to categorize:
    - **Critical dependencies**: What autocomplete/nextEdit import from core/
    - **Unused directories**: Entire folders not imported
    - **Unused files**: Individual files not used
    - **Unused exports**: Functions/classes defined but not imported

**Output**: `CORE_DEPENDENCY_ANALYSIS.md` documenting what's actually needed

---

## Phase 3: Map Dependency Graph

**Objective**: Create visual dependency map showing what autocomplete/nextEdit actually use

**Actions**:

1. For each import in CompletionProvider.ts and NextEditProvider.ts, trace dependencies:

    ```
    CompletionProvider
    ├── ConfigHandler (config/)
    ├── IDE, ILLM interfaces (index.ts)
    ├── OpenAI (llm/llms/)
    ├── DEFAULT_AUTOCOMPLETE_OPTS (util/parameters)
    ├── isSecurityConcern (indexing/ignore)
    ├── BracketMatchingService (autocomplete/filtering/)
    ├── CompletionStreamer (autocomplete/generation/)
    └── ... (continue mapping)
    ```

2. Identify core infrastructure needed:

    - **Must Keep**:
        - `core/autocomplete/` (primary feature)
        - `core/nextEdit/` (primary feature)
        - `core/llm/` (LLM communication)
        - `core/diff/` (diff utilities for nextEdit)
        - `core/util/` (shared utilities)
        - `core/indexing/ignore.ts` (security filtering)
    - **Likely Remove**:
        - `core/config/` (replace with hardcoded objects)
        - `core/config-types/` (no config system)
        - `core/config/yaml-package/` (no YAML parsing)
        - `core/control-plane/` (no telemetry/server)
        - `core/data/` (unless needed for logging)
        - `core/codeRenderer/` (not used by autocomplete/nextEdit)
        - `core/file:/` (unclear purpose)
        - `core/utils/` vs `core/util/` (consolidate)

3. Document findings in `DEPENDENCY_GRAPH.md` with Mermaid diagram

**Test**: Understanding complete, no code changes yet

---

## Phase 4: Remove Completely Unused Directories

**Objective**: Remove entire directories that Knip identifies as unused

**Actions** (in order of safety):

### Batch A: Obviously Unused Infrastructure

```bash
git rm -r core/control-plane/      # Telemetry/server communication
git rm -r core/codeRenderer/       # Not used by autocomplete/nextEdit
git rm -r core/file:/              # Unknown purpose
./test-autocomplete.sh
git commit -m "Remove unused infrastructure directories"
```

### Batch B: Config System (requires replacement)

**Before removing**, create minimal config objects:

1. Create `core/autocomplete/MinimalConfig.ts`:

```typescript
// Hardcoded config objects replacing ConfigHandler
export const DEFAULT_AUTOCOMPLETE_CONFIG = {
	disableIndexing: false,
	// ... other required config
}

export class MinimalConfigHandler {
	getConfig() {
		return DEFAULT_AUTOCOMPLETE_CONFIG
	}
	// Minimal interface needed
}
```

2. Update CompletionProvider.ts and NextEditProvider.ts to use MinimalConfigHandler

3. Remove config system:

```bash
git rm -r core/config/
git rm -r core/config-types/
git rm -r core/config/yaml-package/
./test-autocomplete.sh
git commit -m "Replace config system with hardcoded objects"
```

### Batch C: Unused Utility Directories

Based on Knip analysis, remove unused utility code:

```bash
# If core/utils/ is duplicate of core/util/
git rm -r core/utils/
./test-autocomplete.sh
git commit -m "Remove duplicate utils directory"
```

**Test After Each Batch**: `./test-autocomplete.sh` must pass

---

## Phase 5: Analyze and Minimize LLM Infrastructure

**Objective**: Keep only LLM code needed for autocomplete/nextEdit

**Actions**:

1. Identify which LLM providers autocomplete/nextEdit actually use:

    - Check tests: What models are tested?
    - Check defaults: What's in DEFAULT_AUTOCOMPLETE_OPTS?
    - Trace OpenAI usage (explicitly imported in both providers)

2. Keep minimal LLM infrastructure:

    - `core/llm/llms/OpenAI.ts` (explicitly used)
    - `core/llm/llms/base.ts` (likely base class)
    - `core/llm/countTokens.ts` (used in templating)
    - `core/llm/constants.ts` (model definitions)
    - `core/llm/openai-adapters/` (if OpenAI depends on it)

3. Remove unused LLM providers (per Knip):

    - Anthropic, Cohere, Gemini, etc. (if not used in tests)
    - Unless tests explicitly require them

4. Verify with:

```bash
grep -r "import.*llm/llms" core/autocomplete/ core/nextEdit/
./test-autocomplete.sh
```

**Test**: Verify all LLM calls still work

---

## Phase 6: Minimize VSCode Extension

**Objective**: Keep only test infrastructure, remove everything else if possible

**Actions**:

1. Check what VSCode tests actually test:

```bash
cat extensions/vscode/vitest.config.ts
find extensions/vscode -name "*.vitest.ts"
```

2. Analyze test dependencies - what do they import from core/?

3. Three possible outcomes:

    - **Option A**: Tests are unit tests that mock everything → Can delete entire extension except tests
    - **Option B**: Tests need minimal IDE interface → Keep only test harness
    - **Option C**: Tests need extension.ts → Keep minimal extension.ts stub

4. Based on analysis, remove unused extension code:

```bash
# If tests are self-contained:
git rm extensions/vscode/src/extension.ts
git rm extensions/vscode/src/commands.ts
git rm -r extensions/vscode/src/activation/
# Keep only: src/test/ and minimal IDE mock

./test-autocomplete.sh
git commit -m "Minimize VSCode extension to test harness only"
```

**Test**: VSCode tests still pass (86 tests)

---

## Phase 7: Remove Unused Files in Kept Directories

**Objective**: Within directories we're keeping, remove individual unused files

**Actions**:

1. Re-run Knip with updated codebase:

```bash
npx knip --include files > knip-files-only.txt
```

2. Review each "unused file" carefully:

    - Verify with grep it's truly not imported
    - Check if it's test infrastructure (keep those)
    - Check if it's part of public API (even if unused internally)

3. Remove in small batches (10-15 files):

```bash
# Example batch
git rm core/indexing/refreshIndex.ts  # If truly unused
git rm core/util/someUnusedUtil.ts
./test-autocomplete.sh
git commit -m "Remove unused files: batch 1"
```

**Test After Each Batch**: Full test suite

---

## Phase 8: Remove Unused Exports

**Objective**: Clean up exported functions/classes that aren't used

**Actions**:

1. Run Knip for unused exports:

```bash
npx knip --include exports > knip-exports.txt
```

2. For each unused export, verify it's not:

    - Part of public API (CompletionProvider, NextEditProvider main exports)
    - Used in tests
    - Used dynamically (string-based lookups)

3. Remove exports or make them private:

```typescript
// Before
export function unusedHelper() { ... }

// After (if used internally)
function unusedHelper() { ... }

// Or remove entirely if not used
```

4. Batch removals by file:

```bash
# Edit files to remove exports
./test-autocomplete.sh
git commit -m "Remove unused exports from core/util/"
```

**Test**: Verify no external dependencies break

---

## Phase 9: Consolidate and Simplify

**Objective**: Final cleanup and organization

**Actions**:

1. **Consolidate duplicates**:

    - If `core/util/` and `core/utils/` both exist, merge them
    - If multiple "helper" files exist, consolidate

2. **Simplify interfaces**:

    - Create `core/types.ts` with minimal shared types
    - Remove unused type definitions

3. **Update package.json**:

    - Remove unused dependencies per Knip
    - Update entry points to just CompletionProvider and NextEditProvider

4. **Final Knip validation**:

```bash
npx knip --include files,exports,types,dependencies > knip-final.txt
# Should show ZERO unused files
# Should show minimal unused exports (only public API)
```

**Test**: Full suite, verify clean Knip report

---

## Phase 10: Create Minimal API Documentation

**Objective**: Document the extracted library's public API

**Actions**:

1. Create `README.md` for the minimal library:

```markdown
# Autocomplete & NextEdit Library

Extracted from Continue IDE extension.

## API

### Autocomplete

- `CompletionProvider` - Main autocomplete provider
- Configuration: See MinimalConfig.ts

### NextEdit

- `NextEditProvider` - Main next-edit provider

## Usage

[Examples of how to use the library]

## Testing

npm test # Runs 532 tests
```

2. Create `API.md` documenting:

    - Public classes (CompletionProvider, NextEditProvider)
    - Required interfaces (IDE, ILLM)
    - Configuration objects
    - Type definitions

3. Create `ARCHITECTURE.md` explaining:
    - Directory structure
    - How autocomplete works
    - How nextEdit works
    - Extension points

**Output**: Clear documentation for library users

---

## Success Criteria

✅ All 532 tests pass  
✅ Knip reports ZERO unused files  
✅ Knip reports minimal unused exports (only public API)  
✅ No config YAML infrastructure remains  
✅ VSCode extension minimized to test harness only  
✅ Clear documentation of public API  
✅ Code is organized and maintainable

---

## Execution Strategy

### Safety First

- **One batch at a time**: Never remove multiple batches without testing
- **Git commits**: Commit after each successful batch
- **Test validation**: `./test-autocomplete.sh` must pass after every change
- **Knip validation**: Re-run Knip after major removals to find new unused code

### If Tests Fail

1. Revert the last batch: `git checkout -- .`
2. Analyze what broke: Read test errors carefully
3. Identify the missing dependency
4. Either:
    - Keep that dependency (it's needed)
    - Mock it in tests (if it's external)
    - Fix the tests (if they're over-specified)

### Knip False Positives

If Knip flags something as unused but it's needed:

1. Check if it's used dynamically (string lookups, reflection)
2. Check if it's part of public API
3. Check if it's test infrastructure
4. If truly needed, add to Knip ignore or mark as entry point

---

## Estimated Removals

Based on current structure:

**Definitely Remove** (~40-60% of code):

- core/config/ (large YAML system)
- core/config-types/
- core/config/yaml-package/
- core/control-plane/
- core/codeRenderer/
- core/data/ (unless minimal logging needed)
- Most of extensions/vscode/

**Possibly Remove** (depends on dependencies):

- core/llm-info/ (model metadata - might be needed)
- core/fetch/ (HTTP - might be needed for LLM calls)
- Parts of core/llm/ (unused providers)
- Parts of core/indexing/ (heavy features not needed)

**Definitely Keep**:

- core/autocomplete/ (core feature)
- core/nextEdit/ (core feature)
- core/llm/ (minimal LLM infrastructure)
- core/diff/ (used by nextEdit)
- core/util/ (shared utilities)
- Test files

**Final Size**: Estimate ~40-50% of original codebase

---

## Next Steps

Use a subtask to evaluate the outcome, keeping in mind the success criteria. If there is more work to do, write a plan to deal with it.
