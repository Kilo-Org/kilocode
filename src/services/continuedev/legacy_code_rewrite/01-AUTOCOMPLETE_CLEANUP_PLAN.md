# Autocomplete+nextEdit-Only Repository Cleanup Plan

This plan outlines the incremental removal of non-autocomplete code from the Continue repository, keeping only tab autocomplete and NextEdit functionality covered by tests.

## 🎯 Goal

Transform this repo into an autocomplete+nextEdit-only codebase that:

- Retains all tab autocomplete functionality tested by `test-autocomplete.sh`
- Retains NextEdit feature (has test coverage)
- Keeps necessary dependencies (LLM, config, utilities)
- Removes features without test coverage
- Works with VSCode extension only

## 📋 Procedure

IMPORTANT(1): After each step, verify with:

```bash
./test-autocomplete.sh
```

IMPORTANT(2): After each step in which tests pass, perform a git commit with a clear message.

Use many small steps; where it's reasonable, use multiple steps (i.e. subtasks) per phase. If something goes wrong, it's much easier to recover a small failing step than understand what's problematic in a larger failing step.

### 📝 Orchestrator Execution Guidance

For steps requiring analysis or decision-making:

1. **"Review" steps**: Use `search_files` or `grep` commands to analyze dependencies and imports before making decisions
2. **Manual edits**: Break into smaller substeps when possible, testing after each change
3. **Uncertain removals**: When unsure if code is needed, search for imports/references before deletion, or try deleting it and running the tests to check whether it's needed. When an experiment fails, don't forget to revert uncommitted changes and deleted untracked files so the next attempt truly starts from a blank slate.
4. **Decision criteria**: Each ambiguous step now includes specific commands and decision trees
5. **Ask for guidance**: If analysis reveals unexpected complexity, try to make an educated choice keeping in mind the goal of retaining only autocomplete+nextedit and all their dependencies. Only create a subtask for human review if you are truly unsure how to proceed.

---

## Phase 1: Remove Top-Level Non-Autocomplete Directories

**Goal**: Remove entire directories that have no relation to autocomplete

### Step 1.1: Remove GUI and Other Extensions

```bash
git rm -rf gui/
git rm -rf extensions/intellij/
git rm -rf binary/
```

**Commit**: "Remove GUI, IntelliJ extension, and binary packaging"

### Step 1.2: Remove Development/Testing Helpers

```bash
git rm -rf manual-testing-sandbox/
git rm -rf eval/
git rm -rf actions/
```

**Commit**: "Remove manual testing sandbox, eval scripts, and GitHub actions"

### Step 1.3: Remove Sync and Documentation

```bash
git rm -rf sync/
git rm -rf docs/
```

**Keep**: README.md (will update later)
**Commit**: "Remove sync functionality and documentation"

### Step 1.4: Remove Media (Keep Only Essentials)

```bash
# Keep only essential icons for VSCode extension
mkdir -p media_backup
cp media/icon.png media_backup/ 2>/dev/null || true
git rm -rf media/
mkdir -p media
mv media_backup/icon.png media/ 2>/dev/null || true
rm -rf media_backup
```

**Commit**: "Remove non-essential media files"

**Verification**: Run `./test-autocomplete.sh` after each commit

---

## Phase 2: Clean Up Core Directory

**Goal**: Remove non-autocomplete features from core/ while keeping dependencies

**Known Dependencies**: Autocomplete and NextEdit import from:

- `core/config/` - ConfigHandler (KEEP)
- `core/llm/` - LLM interfaces and implementations (KEEP)
- `core/indexing/` - ignore patterns, security (KEEP)
- `core/util/` - utilities (KEEP)
- `core/utils/` - markdown utilities (KEEP)
- `core/diff/` - diff utilities (KEEP)
- `core/data/` - logging (KEEP)
- `core/test/` - test fixtures (KEEP)
- `core/nextEdit/` - NextEdit feature (KEEP - has test coverage)

### Step 2.1: Remove Core Feature Directories

```bash
git rm -rf core/commands/
git rm -rf core/context/
git rm -rf core/edit/
git rm -rf core/codeRenderer/
git rm -rf core/continueServer/
git rm -rf core/control-plane/
git rm -rf core/deploy/
git rm -rf core/promptFiles/
git rm -rf core/tools/
```

**Commit**: "Remove non-autocomplete core features (keeping NextEdit)"

### Step 2.2: Analyze and Clean Up Core Protocol

**Action**: Search for protocol imports in autocomplete code:

```bash
grep -r "from.*protocol" core/autocomplete/ core/nextEdit/ extensions/vscode/src/autocomplete/
```

**Decision**:

- If NO imports found → Remove directory: `git rm -rf core/protocol/`
- If imports found → Document what's needed, then either:
    - Keep only required files, or
    - Extract types to `core/autocomplete/types.ts` and remove directory

**Commit**: "Remove or consolidate protocol definitions"

### Step 2.3: Remove Core Root Orchestrator

Remove `core/core.ts` - this is the main orchestrator that autocomplete doesn't need directly.
Autocomplete uses `CompletionProvider` directly.

```bash
git rm core/core.ts
```

**Commit**: "Remove core orchestrator (not needed for autocomplete)"

### Step 2.4: Clean Up core/package.json Dependencies

**Action**: Review and remove unused dependencies in substeps:

#### 2.4a: Remove MCP-related packages

Search for MCP usage:

```bash
grep -r "@modelcontextprotocol" core/autocomplete/ core/nextEdit/
```

If not found, remove from `core/package.json`: `@modelcontextprotocol/*` packages

#### 2.4b: Remove browser/GUI packages

Remove if present: `puppeteer`, `jsdom`, `playwright`, `electron-*`

#### 2.4c: Remove Sentry and analytics

Search for usage:

```bash
grep -r "@sentry" core/autocomplete/ core/nextEdit/
```

If not found, remove: `@sentry/*` packages

#### 2.4d: Keep essential packages

- LLM providers (openai, anthropic, etc.)
- tree-sitter packages
- Core utilities (handlebars, zod, etc.)

**Commit**: "Clean up core dependencies for autocomplete+nextEdit-only"

**Verification**: Run `./test-autocomplete.sh` after each commit

---

## Phase 3: Clean Up VSCode Extension

**Goal**: Keep only autocomplete features in the VSCode extension

**Known Dependencies**: VSCode autocomplete needs:

- `extensions/vscode/src/autocomplete/` - autocomplete implementation (KEEP)
- `extensions/vscode/src/extension.ts` - entry point (MODIFY)
- `extensions/vscode/src/VsCodeIde.ts` - IDE interface (KEEP parts)
- Some utilities in `extensions/vscode/src/util/` (REVIEW later)

### Step 3.1: Remove Non-Autocomplete Extension Features

```bash
git rm -rf extensions/vscode/src/apply/
git rm -rf extensions/vscode/src/debug/
git rm -rf extensions/vscode/src/diff/
git rm -rf extensions/vscode/src/quickEdit/
git rm -rf extensions/vscode/src/terminal/
git rm -rf extensions/vscode/src/stubs/
git rm -rf extensions/vscode/src/lang-server/
git rm -rf extensions/vscode/src/otherExtensions/
git rm extensions/vscode/src/ContinueGUIWebviewViewProvider.ts
git rm extensions/vscode/src/ContinueConsoleWebviewViewProvider.ts
```

**Commit**: "Remove non-autocomplete VSCode extension features"

### Step 3.2: Update extension.ts Entry Point

**Action**: Edit `extensions/vscode/src/extension.ts` in substeps:

#### 3.2a: Remove GUI webview initialization

Search for and remove: `ContinueGUIWebviewViewProvider` initialization

#### 3.2b: Remove non-autocomplete command registrations

Keep only: autocomplete/NextEdit commands
Remove: GUI, chat, and other command registrations

#### 3.2c: Remove console webview

Search for and remove: `ContinueConsoleWebviewViewProvider` initialization

**Commit**: "Update extension.ts for autocomplete+nextEdit-only"

### Step 3.3: Update package.json Commands

**Action**: Edit `extensions/vscode/package.json` in substeps:

#### 3.3a: Remove non-autocomplete commands

Keep ONLY these commands:

- `continue.toggleTabAutocompleteEnabled`
- `continue.forceAutocomplete`
- `continue.toggleNextEditEnabled`
- `continue.forceNextEdit`
- `continue.nextEditWindow.*` commands

Remove all other `continue.*` commands

#### 3.3b: Remove GUI views

Remove `contributes.views` and `contributes.viewsContainers` sections

#### 3.3c: Remove non-autocomplete keybindings

Keep only keybindings for commands listed in 3.3a

#### 3.3d: Clean up activation events

Keep only: `onLanguage:*` and autocomplete-related events

**Commit**: "Update VSCode package.json for autocomplete+nextEdit-only"

### Step 3.4: Check and Update VsCodeExtension.ts (if exists)

**Action**: Check if file exists:

```bash
ls -la extensions/vscode/src/VsCodeExtension.ts
```

If exists: Review and remove non-autocomplete feature orchestration
If not exists: Skip this step

**Commit** (if modified): "Update VsCodeExtension for autocomplete+nextEdit-only"

### Step 3.5: Review Extension Scripts

**Action**: List and analyze scripts:

```bash
ls -la extensions/vscode/scripts/
```

**Decision**:

- Keep: Build scripts (`esbuild.js`, `prepackage.js`, `package.js`)
- Review: Test scripts - remove if they test non-autocomplete features
- Check each file's imports and purpose before removal

**Commit** (if changes made): "Clean up extension scripts"

**Verification**: Run `./test-autocomplete.sh`

---

## Phase 4: Clean Up Packages Directory

**Goal**: Keep only packages needed by autocomplete

**Package Analysis**:

- `packages/llm-info/` - LIKELY KEEP (LLM information)
- `packages/config-yaml/` - LIKELY KEEP (config parsing)
- `packages/fetch/` - LIKELY KEEP (HTTP utilities)
- `packages/openai-adapters/` - LIKELY KEEP (OpenAI adapters)
- `packages/terminal-security/` - REMOVE (terminal only)
- `packages/continue-sdk/` - REVIEW (SDK)
- `packages/hub/` - REMOVE (hub integration)

### Step 4.1: Analyze Package Dependencies

**Action**: For each REVIEW package, search for imports:

```bash
# Check terminal-security usage
grep -r "terminal-security" core/autocomplete/ core/nextEdit/ extensions/vscode/src/autocomplete/

# Check continue-sdk usage
grep -r "continue-sdk" core/autocomplete/ core/nextEdit/ extensions/vscode/src/autocomplete/

# Check hub usage
grep -r "@continuedev/hub" core/autocomplete/ core/nextEdit/ extensions/vscode/src/autocomplete/
```

**Decision**: Document which packages are actually imported

### Step 4.2: Remove Confirmed Unnecessary Packages

Based on Step 4.1 analysis, remove packages with no autocomplete/NextEdit imports:

```bash
# Confirmed removals:
git rm -rf packages/terminal-security/
git rm -rf packages/hub/

# Add others based on grep results:
# git rm -rf packages/continue-sdk/  # if no imports found
```

**Commit**: "Remove non-autocomplete packages"

### Step 4.3: Update Package References

**Action**: Remove deleted package references from `core/package.json` and root `package.json`:

- Remove from `dependencies` or `devDependencies`
- Remove from workspace references if using npm workspaces

**Commit**: "Update package references after removal"

**Verification**: Run `./test-autocomplete.sh`

---

## Phase 5: Update Build Configuration

**Goal**: Clean up build scripts and configs for autocomplete+nextEdit-only repo

### Step 5.1: Update Root package.json

Edit `package.json`:

- Remove GUI scripts (`tsc:watch:gui`)
- Remove binary scripts (`tsc:watch:binary`)
- Keep core and vscode scripts
- Update repository description

**Action**: Manual edit
**Commit**: "Update root package.json for autocomplete+nextEdit-only"

### Step 5.2: Update VSCode Build Scripts

**Action**: Search for GUI references in build scripts:

```bash
grep -i "gui" extensions/vscode/scripts/esbuild.js
grep -i "webview" extensions/vscode/scripts/esbuild.js
```

**Decision**:

- If GUI references found → Remove those build steps
- If no references → Skip this step

**Commit** (if modified): "Update VSCode build scripts"

### Step 5.3: Review Git Hooks

**Action**: List and check hooks:

```bash
ls -la .husky/
cat .husky/pre-commit
```

**Decision**:

- If hooks reference removed directories (gui/, docs/) → Update paths
- If hooks run linting/tests on all packages → Verify still works
- Test hook by running: `.husky/pre-commit`

**Commit** (if modified): "Update git hooks for reduced codebase"

**Verification**: Run `./test-autocomplete.sh`

---

## Phase 6: Final Cleanup and Verification

**Goal**: Remove remaining cruft and verify everything works

### Step 6.1: Analyze and Remove Unused Utilities

**Action**: Search for utility file imports:

```bash
# List all utility files
find core/util/ core/utils/ -type f -name "*.ts" -o -name "*.js"

# For each file, check if it's imported by autocomplete/NextEdit
# Example for a specific file:
grep -r "from.*util/filename" core/autocomplete/ core/nextEdit/ extensions/vscode/src/autocomplete/
```

**Decision**:

- Use `ts-prune` for automated analysis: `cd core && npx ts-prune | grep util`
- Remove files with no imports from autocomplete/NextEdit
- Keep commonly-used utilities (treeSitter, etc.)

**Commit**: "Remove unused utility files"

### Step 6.2: Analyze and Clean Up Indexing Code

**Action**: Search for indexing imports:

```bash
grep -r "from.*indexing" core/autocomplete/ core/nextEdit/ extensions/vscode/src/autocomplete/
```

**Known needed**:

- `ignore.js` (isSecurityConcern)
- Files imported by grep results

**Decision**:

- Keep files found in grep
- Remove other indexing files not used

**Commit**: "Clean up indexing code"

### Step 6.3: Analyze and Clean Up LLM Directory

**Action**: This directory is critical - be conservative:

```bash
# List all LLM files
find core/llm/ -type f -name "*.ts"

# Search for test mocks
find core/llm/ -name "*mock*" -o -name "*test*"
```

**Decision**:

- Keep ALL provider implementations
- Keep ALL interfaces and base classes
- Remove ONLY test mocks not used by `./test-autocomplete.sh`
- When in doubt, KEEP the file

**Commit**: "Remove unused LLM test mocks"

### Step 6.4: Update .gitignore and .continueignore

Update ignore files to reflect new structure.

**Action**: Manual edit
**Commit**: "Update ignore files"

### Step 6.5: Final Test Run

```bash
./test-autocomplete.sh
```

If passing, proceed. If failing, debug and fix.

### Step 6.6: Automated Dead Code Detection

**Action**: Run ts-prune to find unused exports:

```bash
cd core && npx ts-prune > ../dead-code-report.txt
cat ../dead-code-report.txt
```

**Decision**:

- Review report for obvious unused exports
- Focus on files in directories already cleaned
- Be conservative - don't remove if unsure
- Skip files in: `autocomplete/`, `nextEdit/`, `llm/`, `config/`

**Commit** (if removals made): "Remove detected dead code"

**Verification**: Run `./test-autocomplete.sh` one final time

---

## Phase 7: Documentation

**Goal**: Document the new autocomplete+nextEdit-only repository

### Step 7.1: Create New README.md

Replace README.md with autocomplete-focused documentation:

- What this repo does (tab autocomplete for VSCode)
- How to build and test
- Architecture overview
- Contributing guidelines

**Action**: Write new README
**Commit**: "Add autocomplete+nextEdit-only README"

### Step 7.2: Add Architecture Documentation

Create `ARCHITECTURE.md` explaining:

- Autocomplete flow
- Key components (CompletionProvider, ContextRetrieval, etc.)
- How tests work
- Extension points

**Action**: Write architecture doc
**Commit**: "Add architecture documentation"

### Step 7.3: Update CONTRIBUTING.md

Update contribution guidelines for autocomplete+nextEdit-only focus.

**Action**: Update or create new file
**Commit**: "Update contributing guidelines"

---

## 🎯 Success Criteria

After all phases, the repository should:

1. ✅ Pass all tests in `test-autocomplete.sh`
2. ✅ Build successfully: `cd core && npm run build`
3. ✅ VSCode extension packages: `cd extensions/vscode && npm run package`
4. ✅ No broken imports or missing dependencies
5. ✅ Clear documentation of what remains
6. ✅ Significantly smaller repository size
7. ✅ Only autocomplete-related code and its dependencies

---

## 📊 Estimated Impact

**Directories to Remove**: ~15-20 top-level directories
**Core Features to Remove**: ~10 feature directories (excluding NextEdit)
**Expected Size Reduction**: 60-80% of codebase
**Test Coverage**: Autocomplete + NextEdit tests (both with coverage)

---

## ⚠️ Important Notes

1. **Never remove** `core/autocomplete/`, `core/nextEdit/`, or `extensions/vscode/src/autocomplete/`
2. **Always run tests** after each commit to catch breakage early
3. **Git commits** are your safety net - commit frequently
4. **Review imports** before deleting shared utilities (both autocomplete and NextEdit depend on them)

After each step, verify and commit. If tests fail, investigate before proceeding.
