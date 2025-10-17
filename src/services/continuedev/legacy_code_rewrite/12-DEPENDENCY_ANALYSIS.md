# Dependency Analysis for Autocomplete & NextEdit

## Overview

This document maps the key dependencies of autocomplete and NextEdit features, identifies which have tests, and provides recommendations on test inclusion.

---

## Autocomplete Dependencies

Based on import analysis of `core/autocomplete/`:

### Direct Dependencies

| Dependency         | Purpose                               | Has Tests?       | Test File(s)            | Used By                        |
| ------------------ | ------------------------------------- | ---------------- | ----------------------- | ------------------------------ |
| **core/config/**   | ConfigHandler, settings               | ❌ No            | None                    | CompletionProvider             |
| **core/llm/**      | LLM interfaces, token counting        | ✅ Yes           | `toolSupport.test.ts`   | CompletionProvider, templating |
| **core/indexing/** | Security checks (`isSecurityConcern`) | ✅ Yes (skipped) | `chunk/basic.test.ts`   | CompletionProvider             |
| **core/util/**     | Path utilities, parameters            | ✅ Yes           | `GlobalContext.test.ts` | Multiple files                 |
| **core/utils/**    | Markdown utilities                    | ❌ No            | None                    | Filtering                      |
| **core/diff/**     | Diff utilities, line streaming        | ❌ No            | None                    | Filtering                      |
| **core/data/**     | Logging (DataLogger)                  | ❌ No            | None                    | AutocompleteLoggingService     |
| **core/test/**     | Test fixtures (testIde, etc.)         | ❌ No            | None                    | Test files only                |

### Dependency Test Analysis

#### 1. **core/llm/** - LLM Tests

**File**: `toolSupport.test.ts` (352 lines)

**What it tests**: LLM provider tool/function calling support for chat features

- Tests which LLM providers support function calling
- Tests model name matching for tool support
- Tests various provider configurations

**Is it autocomplete-related?**
❌ **NO** - Autocomplete uses LLMs for text completion, not tool calling. Tool calling is for chat features (slash commands, context providers with tools).

**Recommendation**: ❌ **EXCLUDE** - Not used by autocomplete/NextEdit

---

#### 2. **core/indexing/** - Indexing Tests

**File**: `chunk/basic.test.ts` (87 lines)

**What it tests**: Code chunking for codebase indexing/RAG

- Tests breaking code into chunks for embedding
- Tests handling lines that exceed chunk size
- **Status**: `describe.skip` (not even running!)

**Is it autocomplete-related?**
❌ **NO** - Autocomplete only uses `indexing/ignore.js` for security checks (`isSecurityConcern`), not chunking. The chunking is for full codebase indexing which is a separate feature.

**Recommendation**: ❌ **EXCLUDE** - Skipped test, not used by autocomplete

---

#### 3. **core/util/** - Utility Tests

**File**: `GlobalContext.test.ts` (327 lines)

**What it tests**: Global context storage (user preferences, telemetry settings)

- Tests reading/writing JSON configuration
- Tests handling corrupted files
- Tests salvaging security-sensitive values

**Is it autocomplete-related?**
⚠️ **PARTIALLY** - GlobalContext is used for storing state like `indexingPaused`, but it's infrastructure, not autocomplete logic.

**Recommendation**: ⚠️ **OPTIONAL** - Infrastructure test. If GlobalContext breaks in a way that affects autocomplete, the autocomplete tests should catch it indirectly.

---

## NextEdit Dependencies

Based on import analysis of `core/nextEdit/`:

### Additional Dependencies (beyond autocomplete)

NextEdit shares most dependencies with autocomplete but adds:

| Dependency            | Purpose         | Has Tests? | Notes                 |
| --------------------- | --------------- | ---------- | --------------------- |
| All autocomplete deps | (Same as above) | (Same)     | Shared infrastructure |

NextEdit **reuses** autocomplete infrastructure:

- `ContextRetrievalService`
- `CompletionStreamer`
- `BracketMatchingService`
- `AutocompleteDebouncer`
- `AutocompleteLruCache`
- `HelperVars`

---

## Dependencies WITHOUT Tests

These critical dependencies have **NO tests** but are heavily used:

### 1. **core/diff/** - Diff Utilities

**Used by**: Autocomplete filtering, NextEdit diff formatting
**Functions**: `streamLines`, line streaming, diff generation
**Test coverage**: ❌ None
**Risk**: Medium - Used in streaming but tested indirectly through autocomplete tests

### 2. **core/config/** - Configuration

**Used by**: ConfigHandler for all settings
**Functions**: Reading config.yaml, managing LLM configurations
**Test coverage**: ❌ None
**Risk**: Medium - Critical but tested indirectly through feature tests

### 3. **core/utils/** - Markdown Utilities

**Used by**: Autocomplete filtering for markdown files
**Functions**: `isMarkdownFile`, `headerIsMarkdown`, markdown state tracking
**Test coverage**: ❌ None  
**Risk**: Low - Specific to markdown handling

### 4. **core/data/** - Logging

**Used by**: AutocompleteLoggingService, NextEditLoggingService
**Functions**: Data logging for telemetry
**Test coverage**: ❌ None
**Risk**: Low - Logging doesn't affect functionality

---

## Test Coverage Summary

### Tests Found in Dependencies

| Directory        | Test Files            | Autocomplete-Relevant?      | Recommendation |
| ---------------- | --------------------- | --------------------------- | -------------- |
| `core/llm/`      | 1 test file           | ❌ No (tool calling only)   | ❌ Exclude     |
| `core/indexing/` | 1 test file (skipped) | ❌ No (chunking for RAG)    | ❌ Exclude     |
| `core/util/`     | 1 test file           | ⚠️ Partial (infrastructure) | ⚠️ Optional    |
| `core/config/`   | 0 test files          | N/A                         | N/A            |
| `core/diff/`     | 0 test files          | N/A                         | N/A            |
| `core/utils/`    | 0 test files          | N/A                         | N/A            |
| `core/data/`     | 0 test files          | N/A                         | N/A            |

---

## Recommendations

### Include in Test Suite

✅ **Autocomplete tests** (14 files) - Direct feature tests
✅ **NextEdit tests** (8 files) - Direct feature tests
✅ **VSCode extension tests** (2 files) - Integration tests

### Consider Including

⚠️ **core/util/GlobalContext.test.ts** - Infrastructure test

- **Pros**: Tests critical configuration storage
- **Cons**: Infrastructure-level, not feature-specific
- **Decision**: Optional - include only if you want extra safety

**Recommendation**: ⚠️ **OPTIONAL** - Can add if concerned about config storage

### Definitely Exclude

❌ **core/llm/toolSupport.test.ts** - Tests chat tool calling
❌ **core/indexing/chunk/basic.test.ts** - Tests RAG chunking (skipped)

---

## Test Philosophy

### Why Not Test Every Dependency?

1. **Indirect Coverage**: If LLM token counting breaks, autocomplete tests fail
2. **Integration Tests**: Autocomplete tests verify dependencies work together
3. **Maintenance Burden**: More tests = more maintenance
4. **Clear Failures**: Feature tests pinpoint issues better than unit tests

### Tree-Sitter: A Case Study in Good Testing

Tree-sitter parsing is **complex and critical** for autocomplete, yet has no standalone tests. Why is this OK?

**Because it's extensively tested through feature tests:**

1. `RootPathContextService.vitest.ts` tests tree-sitter for:
    - Python type definitions
    - TypeScript interfaces and types
    - PHP classes and methods
    - Go struct types
2. Static context tests use tree-sitter for code structure
3. AST utility tests verify tree-sitter parsing works

**This is the RIGHT approach:**

- ✅ Tests the actual usage patterns
- ✅ Catches integration issues
- ✅ Tests multiple languages
- ✅ Easier to maintain (no mocking needed)

**If tree-sitter breaks**, the autocomplete context tests will fail immediately.

### When to Add Dependency Tests

Add tests for a dependency when:

1. ✅ It has complex logic NOT covered by feature tests
2. ✅ Failures would be hard to diagnose from feature test failures
3. ✅ The test already exists and is relevant

Don't add when:

1. ❌ Feature tests cover it adequately (**tree-sitter is this case**)
2. ❌ It's infrastructure (config, logging)
3. ❌ The dependency is simple/straightforward

---

## Final Recommendations

### Minimal Test Suite (Recommended)

```bash
# In test-autocomplete.sh
npm run vitest -- autocomplete    # 14 files
npm run vitest -- nextEdit        # 8 files
cd extensions/vscode && npm test  # 2 files
# Total: ~24 test files
```

### Extended Test Suite (Maximum Safety)

```bash
# In test-autocomplete.sh
npm run vitest -- autocomplete              # 14 files
npm run vitest -- nextEdit                  # 8 files
npm run vitest -- core/util/GlobalContext   # 1 file (infrastructure)
cd extensions/vscode && npm test            # 2 files
# Total: ~25 test files
```

**My Recommendation**: Use **Minimal Test Suite**

- Focuses on features
- Faster test execution
- If GlobalContext breaks in a way that matters, feature tests will catch it
- Can always add more tests later if needed

---

## Risk Assessment

| Risk Level | Component                  | Coverage Status                                           |
| ---------- | -------------------------- | --------------------------------------------------------- |
| 🔴 HIGH    | Autocomplete logic         | ✅ 14 test files                                          |
| 🔴 HIGH    | NextEdit logic             | ✅ 8 test files                                           |
| 🟡 MEDIUM  | LLM token counting         | ✅ Tested via autocomplete/templating tests               |
| 🟡 MEDIUM  | Config handling            | ✅ Tested via CompletionProvider tests                    |
| 🟡 MEDIUM  | **Tree-sitter parsing** ⭐ | ✅ **Extensively tested via RootPathContext + AST tests** |
| 🟢 LOW     | Diff utilities             | ✅ Tested via filtering/NextEdit tests                    |
| 🟢 LOW     | Markdown utils             | ✅ Tested via filtering tests                             |
| 🟢 LOW     | Logging                    | ⚠️ Not critical for functionality                         |

**Overall Risk**: 🟢 **LOW** - Good test coverage for critical paths
