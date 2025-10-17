# Knip Evaluation Report - Post Extraction Cleanup

**Date**: 2025-10-10  
**Context**: Evaluation after completing MINIMAL_EXTRACTION_PLAN.md  
**Objective**: Identify remaining dead code and leftovers after autocomplete/nextEdit extraction

---

## Executive Summary

### Findings

After completing the extraction plan, knip analysis (knip-phase7-analysis.txt) revealed:

- ✅ **Good Progress**: Most unrelated code removed (gui/, docs/, scripts/, etc.)
- ⚠️ **32 unused files** remain in core/
- ⚠️ **180 unused exports** (mostly language constants and internal utilities)
- 🔍 **Dual test infrastructure**: Both Jest and Vitest (only Vitest runs via test-autocomplete.sh)
- 📊 **Current tests**: 532 passing (446 core Vitest + 86 vscode-test-harness)

### Key Issues Identified

1. **Unused Mock File**: `core/__mocks__/@continuedev/fetch/index.ts` not referenced anywhere
2. **Unused LLM Files**: Several LLM-related files flagged but not imported
3. **Unused Utilities**: handlebars/, ideUtils.ts, shellPath.ts, tts.ts, url.ts, etc.
4. **Test Infrastructure Duplication**: ~30 .test.ts files (Jest) not run by test script
5. **Outdated Control-Plane References**: Stub files already deleted but some type references remain

---

## Detailed Analysis

### Category 1: Safely Removable Files (No Dependencies)

These files are not imported by autocomplete or nextEdit:

#### 1.1 Mock Files

- `core/__mocks__/@continuedev/fetch/index.ts` - Unused mock, no imports found

#### 1.2 LLM Infrastructure Files

- `core/llm/llms/index.ts` - Re-export file, not used
- `core/llm/llms/llm.ts` - Old LLM base class, not used
- `core/llm/llms/llmTestHarness.ts` - Test harness, not used
- `core/llm/streamChat.ts` - Chat streaming, not used by autocomplete/nextEdit
- `core/llm/defaultSystemMessages.ts` - Not used
- `core/llm/rules/constants.ts` - Rule constants, not used
- `core/llm/rules/rules-utils.ts` - Rule utilities, not used
- `core/llm/templates/edit/claude.ts` - Edit templates, not used
- `core/llm/templates/edit/codestral.ts` - Edit templates, not used
- `core/llm/utils/calculateRequestCost.ts` - Cost calculation, not used
- `core/llm/utils/parseArgs.ts` - Argument parsing, not used

#### 1.3 Utility Files

- `core/util/handlebars/` - Template utilities, not used
- `core/util/ideUtils.ts` - IDE utilities, not used
- `core/util/shellPath.ts` - Shell path utilities, not used
- `core/util/tts.ts` - Text-to-speech, not used
- `core/util/url.ts` - URL utilities, not used (different from uri.ts)
- `core/util/sentry/constants.ts` - Sentry constants, not used

#### 1.4 Other Files

- `core/llm-info/util.ts` - LLM info utilities, not used

**Risk Level**: ✅ LOW - These files have no imports in autocomplete/nextEdit code

---

### Category 2: Test Infrastructure (Needs Migration)

The codebase has two test systems:

#### Current State

```
Vitest (.vitest.ts)          Jest (.test.ts)
├── core/autocomplete/       ├── core/fetch/        (9 files)
├── core/nextEdit/           ├── core/util/         (15+ files)
├── core/diff/               ├── core/llm/          (4 files)
├── core/util/ (some)        └── core/test/         (1 file)
└── core/vscode-test-harness/

Run by test-autocomplete.sh  NOT run by test script
532 tests passing            Unknown number of tests
```

#### Problem

- Jest tests exist but aren't run by `test-autocomplete.sh`
- These tests cover core functionality that autocomplete/nextEdit depend on:
    - **fetch/** - HTTP request handling (critical for LLM calls)
    - **util/** - Range calculations, JSON parsing, string utilities
    - **llm/** - LLM provider tests

#### Recommendation

**Migrate critical tests to Vitest, then remove Jest**

Priority tests to migrate:

1. **High**: fetch tests (fetch.e2e.test.ts, certs.test.ts, ssl-certificate.test.ts, etc.)
2. **High**: util/ranges.test.ts (used by nextEdit)
3. **High**: util/index.test.ts (deduplicateArray, dedent utilities)
4. **Medium**: LLM tests if LLM infrastructure is kept
5. **Low**: Less critical util tests

**Risk Level**: ⚠️ MEDIUM - Need careful migration to maintain test coverage

---

### Category 3: Unused Exports (180 items)

Knip flagged 180 unused exports, mostly:

#### 3.1 Language Information (Low Priority)

- Language constants in `AutocompleteLanguageInfo.ts` (Typescript, JavaScript, Python, Java, etc.)
- These are defined but not used because autocomplete is language-agnostic in current implementation
- **Action**: Can remove or mark as `@internal` if keeping for future use

#### 3.2 Internal Utilities (Low Priority)

- Stream transforms: `onlyWhitespaceAfterEndOfLine`, `noFirstCharNewline`, etc.
- Filtering utilities: `BRACKETS`, `BRACKETS_REVERSE`
- These are internal implementation details
- **Action**: Review if truly unused or just not exported externally

#### 3.3 Path and Config Utilities (Medium Priority)

Many path/config utilities flagged:

- `getIndexFolderPath`, `getConfigJsonPath`, `getContinueRcPath`, etc.
- These were part of the original Continue config system
- **Action**: Remove if config system is fully replaced with MinimalConfig

**Risk Level**: ✅ LOW - Mostly constants and internal utilities

---

## Control-Plane References Audit

Searched for remaining control-plane references:

### Found References (Type-Only)

These are just type annotations, not actual dependencies:

- `core/nextEdit/types.ts`: `profileType?: "local" | "platform" | "control-plane"`
- `core/autocomplete/util/types.ts`: Similar type annotation
- `core/autocomplete/MinimalConfig.ts`: Type and comments
- Stub files: `core/util/env.ts`, `core/util/controlPlaneClient.ts`, etc.

### Status

✅ **Acceptable** - These are minimal type references in stub files  
✅ **Already removed**: control-plane/ directory is empty  
✅ **Stubs exist**: For backward compatibility (env.ts, controlPlaneClient.ts)

**Action**: Can optionally simplify type unions to remove "control-plane" option

---

## Recommendations

### Immediate Actions (Low Risk)

Execute **Phase 1** of KNIP_CLEANUP_PLAN.md:

1. Remove unused mock file
2. Remove unused LLM files
3. Remove unused utility files
4. Remove unused llm-info/util.ts

**Expected outcome**: Remove ~15-20 files with zero risk

### Short-Term Actions (Medium Risk)

Execute **Phase 2** of KNIP_CLEANUP_PLAN.md:

1. Migrate critical .test.ts files to .vitest.ts
    - Start with fetch tests (critical for LLM calls)
    - Then util tests (ranges, index utilities)
    - Then LLM tests if keeping LLM infrastructure

**Expected outcome**: Maintain test coverage while consolidating test infrastructure

### Long-Term Actions (Low Risk)

Execute **Phases 3-5** of KNIP_CLEANUP_PLAN.md:

1. Remove Jest infrastructure
2. Update knip configuration
3. Final verification and documentation

**Expected outcome**: Single test framework, cleaner codebase

### Optional Actions (Very Low Priority)

1. Clean up unused exports (180 items)

    - Review language constants - keep or remove
    - Review internal utilities - mark as internal or remove
    - Remove unused config path utilities

2. Simplify control-plane type references
    - Remove "control-plane" from type unions
    - Simplify to just "local" | "platform"

---

## Risk Assessment

### What Could Break

1. **If removing files without checking dependencies**:

    - Autocomplete or nextEdit might import something unexpectedly
    - **Mitigation**: Run tests after each removal

2. **If migrating tests incorrectly**:

    - Loss of test coverage for core functionality
    - **Mitigation**: Migrate high-priority tests first, verify each migration

3. **If removing Jest too early**:
    - Lose existing test coverage before migration complete
    - **Mitigation**: Complete Phase 2 before Phase 3

### What Won't Break

1. Removing files flagged by knip as unused (they have no imports)
2. Removing mock files that aren't referenced
3. Running test-autocomplete.sh after each change (catches issues immediately)

---

## Metrics

### Before Cleanup (Current State)

- Unused files: 32
- Unused exports: 180
- Test frameworks: 2 (Jest + Vitest)
- Test files: ~60 (.test.ts + .vitest.ts)
- Tests passing: 532 (Vitest only)

### After Phase 1 (Immediate Cleanup)

- Unused files: ~15-20 ← Remove 12-17 files
- Unused exports: ~170 ← Minor reduction
- Test frameworks: 2 (unchanged)
- Tests passing: 532 (should remain same)

### After All Phases (Complete Cleanup)

- Unused files: <10 ← Only unavoidable items
- Unused exports: ~50 ← Cleaned up most
- Test frameworks: 1 (Vitest only) ← Simplified
- Tests passing: 532+ ← Maintained or increased
- Code quality: Significantly improved

---

## Conclusion

The extraction plan successfully removed major unrelated components (GUI, docs, CLI, etc.), but left some unused files and dual test infrastructure.

**Key Takeaway**: The codebase is in good shape, but needs:

1. **Immediate cleanup** of obviously unused files (low risk)
2. **Test consolidation** by migrating to Vitest (medium effort)
3. **Optional polishing** of unused exports (low priority)

**Recommended Next Step**: Execute Phase 1 of KNIP_CLEANUP_PLAN.md to remove 12-17 unused files with zero risk.

---

## Appendix: Files Flagged by Knip

### Complete List of 32 Unused Files

```
core/__mocks__/@continuedev/fetch/index.ts
core/autocomplete/context/root-path-context/test/files/typescript/arrowFunctions.ts
core/autocomplete/context/root-path-context/test/files/typescript/classes.ts
core/autocomplete/context/root-path-context/test/files/typescript/classMethods.ts
core/autocomplete/context/root-path-context/test/files/typescript/functions.ts
core/autocomplete/context/root-path-context/test/files/typescript/generators.ts
core/control-plane/AuthTypes.ts [ALREADY DELETED]
core/control-plane/PolicySingleton.ts [ALREADY DELETED]
core/llm-info/util.ts
core/llm/defaultSystemMessages.ts
core/llm/llms/index.ts
core/llm/llms/llm.ts
core/llm/llms/llmTestHarness.ts
core/llm/rules/constants.ts
core/llm/rules/rules-utils.ts
core/llm/streamChat.ts
core/llm/templates/edit/claude.ts
core/llm/templates/edit/codestral.ts
core/llm/utils/calculateRequestCost.ts
core/llm/utils/parseArgs.ts
core/test/jest.global-setup.ts
core/test/vitest.global-setup.ts
core/test/vitest.setup.ts
core/util/handlebars/handlebarUtils.ts
core/util/handlebars/renderTemplatedString.ts
core/util/ideUtils.ts
core/util/sentry/constants.ts
core/util/shellPath.ts
core/util/tts.ts
core/util/url.ts
core/vitest.config.ts [FALSE POSITIVE - actually used]
core/vscode-test-harness/vitest.config.ts [FALSE POSITIVE - actually used]
```

**Note**: Some files may be false positives (vitest.config.ts files are actually used)

### Actual Removable Count: ~26-28 files
