# VSCode Extension Test Analysis - Phase 1.5 Step 1

**Date:** 2025-10-10  
**Objective:** Analyze 6 VSCode test files (86 tests) to determine relevance for autocomplete/nextEdit and identify Keep vs Remove decisions

---

## Executive Summary

All 6 test files analyzed are **RELEVANT** to autocomplete/nextEdit functionality. They provide comprehensive integration testing for:

- **Autocomplete:** Ghost text acceptance tracking, completion provider logic
- **NextEdit:** Window management, jump suggestions, selection handling, prefetch queuing

Total test coverage: **86 tests** across **~3,200 lines** of test code.

**Key Finding:** These tests require only **~15 source files** to run, making the extension a minimal test harness possible.

---

## Test File Analysis

### 1. ✅ KEEP - [`ContinueCompletionProvider.vitest.ts`](extensions/vscode/src/autocomplete/__tests__/ContinueCompletionProvider.vitest.ts)

**Lines:** 488 | **Tests:** ~20+ tests  
**Primary Focus:** Integration between autocomplete and nextEdit completion providers

**What It Tests:**

- NextEdit triggering logic (when to start new chains vs use existing)
- Chain existence and deletion management
- Prefetch queue integration (processed vs unprocessed items)
- Jump manager integration for multi-location edits
- Full file diff mode handling
- Completion item generation from nextEdit outcomes

**Key Imports:**

- [`completionProvider.ts`](extensions/vscode/src/autocomplete/completionProvider.ts:5) - Main class under test
- `core/nextEdit/NextEditProvider` - Core nextEdit provider
- `core/nextEdit/NextEditPrefetchQueue` - Prefetch queue management
- `core/nextEdit/NextEditLoggingService` - Logging service
- [`JumpManager.ts`](extensions/vscode/src/activation/JumpManager.ts:10) - Jump suggestions

**Rationale for KEEP:** Critical integration tests for autocomplete/nextEdit handoff logic. Tests complex state management and queue coordination.

---

### 2. ✅ KEEP - [`GhostTextAcceptanceTracker.vitest.ts`](extensions/vscode/src/autocomplete/GhostTextAcceptanceTracker.vitest.ts)

**Lines:** 246 | **Tests:** 15 tests  
**Primary Focus:** Ghost text acceptance detection for autocomplete

**What It Tests:**

- Singleton pattern implementation
- Tracking expected ghost text acceptance (single-line and multi-line)
- Differentiating ghost text acceptance from cursor movement
- Document version tracking
- Range validation and text content matching
- Edge cases (empty text, multi-line text, errors)

**Key Imports:**

- [`GhostTextAcceptanceTracker.ts`](extensions/vscode/src/autocomplete/GhostTextAcceptanceTracker.vitest.ts:3) - Main class under test

**Rationale for KEEP:** Essential for autocomplete functionality. Prevents false rejection of completions when cursor moves due to acceptance rather than user navigation.

---

### 3. ✅ KEEP - [`NextEditWindowManager.vitest.ts`](extensions/vscode/src/activation/NextEditWindowManager.vitest.ts)

**Lines:** 970 | **Tests:** 40+ tests  
**Primary Focus:** NextEdit window/decoration management and user interaction

**What It Tests:**

- Singleton pattern
- Key reservation state management (Tab/Esc keys)
- Race condition prevention for concurrent operations
- Sequential vs concurrent reserve/free operations
- Error recovery from failed operations
- Window display/hide logic
- Accept/reject flow for nextEdit suggestions
- Configuration changes (theme, font size)
- Decoration creation and disposal

**Key Imports:**

- [`NextEditWindowManager.ts`](extensions/vscode/src/activation/NextEditWindowManager.vitest.ts:129) - Main class under test
- `core/nextEdit/NextEditProvider` - Provider integration
- `core/nextEdit/NextEditLoggingService` - Logging integration
- `core/codeRenderer/CodeRenderer` - Code rendering for decorations

**Rationale for KEEP:** Core nextEdit UI functionality. Tests complex async state management and user interaction patterns critical for nextEdit UX.

---

### 4. ✅ KEEP - [`JumpManager.vitest.ts`](extensions/vscode/src/activation/JumpManager.vitest.ts)

**Lines:** 596 | **Tests:** 15+ tests  
**Primary Focus:** Jump suggestions between nextEdit editable regions

**What It Tests:**

- Singleton pattern
- Jump suggestion logic (visible vs outside visible range)
- Jump decoration rendering (above, below, within viewport)
- Accept jump flow (cursor movement, reveal range)
- Reject jump flow (chain deletion)
- Selection change listener for automatic rejection
- Completion data storage for post-jump completion
- Jump state tracking (isJumpInProgress, wasJumpJustAccepted)

**Key Imports:**

- [`JumpManager.ts`](extensions/vscode/src/activation/JumpManager.vitest.ts:5) - Main class under test
- `core/nextEdit/NextEditProvider` - Chain management
- `core/nextEdit/types` - NextEditOutcome type

**Rationale for KEEP:** Critical for nextEdit multi-location workflow. Tests complex coordination between jumps and completion prefetching.

---

### 5. ✅ KEEP - [`SelectionChangeManager.vitest.ts`](extensions/vscode/src/activation/SelectionChangeManager.vitest.ts)

**Lines:** 899 | **Tests:** 20+ tests  
**Primary Focus:** Selection change event handling and nextEdit trigger logic

**What It Tests:**

- Singleton pattern
- Handler registration with priority levels (CRITICAL, HIGH, NORMAL, LOW, FALLBACK)
- Debouncing for rapid selection changes
- Event queuing during processing
- Timeout handling for slow handlers
- Error handling in handlers
- State capture (document changes, jump state, window acceptance)
- Default fallback handler (chain deletion, prefetch queueing)
- Handler execution order (priority-based, early exit on handled)

**Key Imports:**

- [`SelectionChangeManager.ts`](extensions/vscode/src/activation/SelectionChangeManager.vitest.ts:16) - Main class under test
- `core/nextEdit/NextEditEditableRegionCalculator` - Region calculation
- `core/nextEdit/NextEditPrefetchQueue` - Prefetch management
- `core/nextEdit/NextEditProvider` - Provider integration
- [`VsCodeIde.ts`](extensions/vscode/src/activation/SelectionChangeManager.vitest.ts:9) - IDE interface
- [`JumpManager.ts`](extensions/vscode/src/activation/SelectionChangeManager.vitest.ts:11) - Jump state
- [`NextEditWindowManager.ts`](extensions/vscode/src/activation/SelectionChangeManager.vitest.ts:12) - Window state

**Rationale for KEEP:** Central coordination point for nextEdit. Tests complex event handling, debouncing, and integration with multiple subsystems.

---

### 6. ✅ KEEP - [`util.vitest.ts`](extensions/vscode/src/util/util.vitest.ts)

**Lines:** 79 | **Tests:** 3 tests  
**Primary Focus:** Platform and extension version utilities

**What It Tests:**

- `isUnsupportedPlatform()` - Detects unsupported Windows ARM64
- `isExtensionPrerelease()` - Detects prerelease versions by odd minor version

**Key Imports:**

- [`util.ts`](extensions/vscode/src/util/util.vitest.ts:28) - Utility functions under test

**Rationale for KEEP:** Small utility file, but provides platform detection that may be referenced by autocomplete/nextEdit. Low cost to keep.

---

## Source File Decisions

### ✅ KEEP - Required Source Files (15 files)

#### Directly Tested Files (6 files)

1. [`src/autocomplete/completionProvider.ts`](extensions/vscode/src/autocomplete/completionProvider.ts:40) - Main completion provider
2. [`src/autocomplete/GhostTextAcceptanceTracker.ts`](extensions/vscode/src/autocomplete/GhostTextAcceptanceTracker.ts:26) - Ghost text tracking
3. [`src/activation/NextEditWindowManager.ts`](extensions/vscode/src/activation/NextEditWindowManager.ts) - Window management
4. [`src/activation/JumpManager.ts`](extensions/vscode/src/activation/JumpManager.ts) - Jump management
5. [`src/activation/SelectionChangeManager.ts`](extensions/vscode/src/activation/SelectionChangeManager.ts) - Selection handling
6. [`src/util/util.ts`](extensions/vscode/src/util/util.ts) - Platform utilities

#### Required Dependencies (9 files)

7. [`src/VsCodeIde.ts`](extensions/vscode/src/VsCodeIde.ts) - IDE abstraction (imported by SelectionChangeManager)
8. [`src/webviewProtocol.ts`](extensions/vscode/src/webviewProtocol.ts) - Protocol definitions (imported by completionProvider)
9. [`src/util/getTheme.ts`](extensions/vscode/src/util/getTheme.ts) - Theme detection (mocked but needed)
10. [`src/util/errorHandling.ts`](extensions/vscode/src/util/errorHandling.ts) - Error handling (mocked)
11. [`src/autocomplete/statusBar.ts`](extensions/vscode/src/autocomplete/statusBar.ts) - Status bar (mocked)
12. [`src/autocomplete/lsp.ts`](extensions/vscode/src/autocomplete/lsp.ts) - LSP integration (mocked)
13. [`src/autocomplete/recentlyEdited.ts`](extensions/vscode/src/autocomplete/recentlyEdited.ts) - Recently edited tracking (mocked)
14. [`src/autocomplete/RecentlyVisitedRangesService.ts`](extensions/vscode/src/autocomplete/RecentlyVisitedRangesService.ts) - Visited ranges (mocked)
15. [`vitest.config.ts`](extensions/vscode/vitest.config.ts) - Test configuration

---

### ❌ REMOVE - Not Required by Tests

#### Extension Core (NOT tested)

- ❌ `src/extension.ts` - Main extension activation
- ❌ `src/commands.ts` - VS Code commands
- ❌ `src/suggestions.ts` - Suggestion handling

#### Activation (NOT tested)

- ❌ `src/activation/activate.ts` - Activation logic
- ❌ `src/activation/api.ts` - API exports
- ❌ `src/activation/InlineTipManager.ts` - Inline tips
- ❌ `src/activation/languageClient.ts` - Language client
- ❌ `src/activation/proxy.ts` - Proxy configuration

#### Extension Subdirectory (NOT tested)

- ❌ `src/extension/ConfigYamlDocumentLinkProvider.ts`
- ❌ `src/extension/EditOutcomeTracker.ts`
- ❌ `src/extension/VsCodeExtension.ts`
- ❌ `src/extension/VsCodeMessenger.ts`

#### Utility Files (NOT tested)

- ❌ `src/util/addCode.ts`
- ❌ `src/util/battery.ts`
- ❌ `src/util/cleanSlate.ts`
- ❌ `src/util/editLoggingUtils.ts`
- ❌ `src/util/expandSnippet.ts`
- ❌ `src/util/FileSearch.ts`
- ❌ `src/util/ideUtils.ts`
- ❌ `src/util/tutorial.ts`
- ❌ `src/util/vscode.ts`
- ❌ `src/util/workspaceConfig.ts`

#### Build/Package Infrastructure (NOT needed for tests)

- ❌ `scripts/*` - ALL build/package scripts
- ❌ `e2e/*` - E2E tests (different from unit tests)
- ❌ `media/*` - Media assets
- ❌ `models/*` - Model files
- ❌ `textmate-syntaxes/*` - Syntax definitions
- ❌ `tree-sitter/*` - Tree-sitter queries
- ❌ `tag-qry/*` - Tag queries

---

## Test Dependencies on Core Package

All tests depend on `core/` package modules:

### Core AutoComplete

- `core/autocomplete/CompletionProvider`
- `core/autocomplete/util/processSingleLineCompletion`
- `core/autocomplete/util/types`

### Core NextEdit

- `core/nextEdit/NextEditProvider`
- `core/nextEdit/NextEditPrefetchQueue`
- `core/nextEdit/NextEditLoggingService`
- `core/nextEdit/NextEditEditableRegionCalculator`
- `core/nextEdit/diff/diff`
- `core/nextEdit/types`

### Core Utilities

- `core/config/ConfigHandler`
- `core/codeRenderer/CodeRenderer`
- `core/diff/myers`
- `core/util/pathToUri`

**Note:** Core package must remain intact for tests to run.

---

## Test Execution Requirements

### Current Setup

- **Test Framework:** Vitest
- **Config File:** [`vitest.config.ts`](extensions/vscode/vitest.config.ts)
- **Test Pattern:** `**/*.vitest.ts`
- **Dependencies:** vscode test API (mocked), core package

### Minimal Package.json Requirements

```json
{
	"devDependencies": {
		"vitest": "^x.x.x",
		"@types/vscode": "^x.x.x"
	},
	"scripts": {
		"test": "vitest run",
		"test:watch": "vitest"
	}
}
```

---

## Final Recommendations

### Phase 1.5 Next Steps

1. **KEEP** all 6 test files - all relevant to autocomplete/nextEdit
2. **KEEP** 15 source files identified above
3. **REMOVE** ~50+ source files not required by tests
4. **REMOVE** entire build/package infrastructure (scripts, e2e, media, etc.)
5. **SIMPLIFY** package.json to minimal test dependencies
6. **VERIFY** tests still pass with minimal source files

### Expected Result

Extension becomes a **minimal test harness** with:

- **6 test files** (86 tests, ~3,200 lines)
- **15 source files** (~2,000 lines estimated)
- **vitest.config.ts** (test configuration)
- **package.json** (minimal test dependencies)
- **Core package** (unchanged, required dependency)

Total reduction: From ~100+ files to ~22 files in extension package.

---

## Test Categories Summary

| Category       | Test File                            | Tests   | Lines      | Status           |
| -------------- | ------------------------------------ | ------- | ---------- | ---------------- |
| Integration    | ContinueCompletionProvider.vitest.ts | 20+     | 488        | ✅ KEEP          |
| Autocomplete   | GhostTextAcceptanceTracker.vitest.ts | 15      | 246        | ✅ KEEP          |
| NextEdit UI    | NextEditWindowManager.vitest.ts      | 40+     | 970        | ✅ KEEP          |
| NextEdit Jump  | JumpManager.vitest.ts                | 15+     | 596        | ✅ KEEP          |
| Event Handling | SelectionChangeManager.vitest.ts     | 20+     | 899        | ✅ KEEP          |
| Utilities      | util.vitest.ts                       | 3       | 79         | ✅ KEEP          |
| **TOTAL**      | **6 files**                          | **~86** | **~3,278** | **ALL RELEVANT** |

---

## Conclusion

All 6 VSCode test files are **highly relevant** to autocomplete/nextEdit functionality and should be **KEPT** in the minimal extraction. They provide comprehensive integration testing that validates the complex coordination between autocomplete completion providers, nextEdit prediction chains, jump management, window decorations, and selection change handling.

The tests require only **15 source files** to run, making extraction to a minimal test harness straightforward. All other extension functionality (~50+ files) can be safely removed without affecting test execution.

**Analysis Complete** ✅
