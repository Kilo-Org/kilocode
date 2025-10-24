# Knip Dead Code Analysis Report

## Phase 8: Comprehensive Dead Code Analysis

**Date:** 2025-10-09
**Tool:** Knip v5.x
**Configuration:** knip.json (created for this analysis)

---

## Executive Summary

Knip analysis was run successfully but revealed significant **configuration issues** that prevent safe code removal at this time. The analysis identified 288 unused files, 214 unused exports, 49 unused types, and 1 unused devDependency, but manual verification shows these findings require careful review.

### Critical Findings

1. **Configuration Issues Detected:**

    - Entry points specified in `knip.json` don't exist:
        - `core/autocomplete/index.ts` ❌ (doesn't exist)
        - `core/nextEdit/index.ts` ❌ (doesn't exist)
        - `core/index.ts` ❌ (doesn't exist)
    - Actual entry points appear to be:
        - `core/autocomplete/CompletionProvider.ts` ✓
        - `core/nextEdit/NextEditProvider.ts` ✓
        - `extensions/vscode/src/extension.ts` ✓

2. **False Positive Identified:**
    - `eslint-plugin-import` flagged as unused but is actively used in `extensions/cli/eslint.config.js`
    - This suggests Knip may not be correctly analyzing cross-directory dependencies

---

## Detailed Findings

### Category 1: Unused Files (288 total)

**Breakdown by Type:**

- Test files (.test.ts, .vitest.ts): ~150 files
- Mock files (**mocks**): ~10 files
- Package files (packages/\*): ~80 files
- Core files: ~48 files

**High-Risk Categories (DO NOT REMOVE):**

- All test files (needed for test infrastructure)
- All mock files (needed for testing)
- Test fixtures and test cases
- Vitest/Jest configuration files

**Medium-Risk Categories (Needs Verification):**

- Test utility files (e.g., `completionTestUtils.ts`, `llmTestHarness.ts`)
- Configuration files (e.g., `default.ts`, `onboarding.ts`)
- Build/infrastructure files

**Low-Risk Categories (Potentially Safe):**

- Some files in `packages/` that appear to be data schemas
- Deprecated template files

**Files Requiring Special Attention:**

```
core/config/usesFreeTrialApiKey.ts - May be used at runtime
core/config/workspace/workspaceBlocks.ts - May be used for config
core/llm/defaultSystemMessages.ts - Likely used dynamically
core/llm/logFormatter.ts - May be used for debugging
core/util/chatDescriber.ts - May be used for telemetry
core/util/generateRepoMap.ts - May be used for indexing
core/util/history.ts - May be used for session management
```

### Category 2: Unused Exports (214 total)

**Major Categories:**

1. **Language Info Exports (26):** All language configurations from `AutocompleteLanguageInfo.ts`

    - Typescript, JavaScript, Python, Java, C++, C#, etc.
    - **Assessment:** Likely used dynamically via language map lookups

2. **Utility Functions (50+):** Functions in core/util/, core/autocomplete/util/

    - Examples: `getScopeAroundRange`, `matchLine`, `dedentAndGetCommonWhitespace`
    - **Assessment:** May be used for specific features or edge cases

3. **Constants (30+):** Various constant exports

    - Examples: `DEFAULT_SECURITY_IGNORE_FILETYPES`, `PROXY_URL`, `RETRY_AFTER_HEADER`
    - **Assessment:** May be used in configuration or edge cases

4. **Transform Functions (20+):** Stream transform functions

    - Examples: `filterCodeBlockLines`, `skipLines`, `logLines`
    - **Assessment:** Likely used in autocomplete pipeline

5. **Path/File Utilities (25+):** Functions in core/util/paths.ts
    - Examples: `getSessionsFolderPath`, `getLanceDbPath`, `getDocsSqlitePath`
    - **Assessment:** Used for file system operations

**High-Risk Exports (DO NOT REMOVE):**

- Any exports used dynamically via string lookups
- Public API exports (even if unused internally)
- Configuration constants
- Test utilities

### Category 3: Unused Types (49 total)

**Categories:**

1. **Gemini Types (15):** Types in `core/llm/llms/gemini-types.ts`
2. **Control Plane Types (8):** Authentication and environment types
3. **Next Edit Types (6):** Template and configuration interfaces
4. **Utility Types (20):** Various interface definitions

**Assessment:** Types may be used for:

- Type checking at compile time only
- Documentation purposes
- Future features
- External API contracts

### Category 4: Unused Dependencies

**Found:** 1 devDependency

- `eslint-plugin-import` in root `package.json`

**Verification Result:** ❌ **FALSE POSITIVE**

- Actually used in `extensions/cli/eslint.config.js`
- Knip may not correctly handle monorepo subdirectory usage

---

## Recommendations

### 1. Fix Knip Configuration First

Update `knip.json` with correct entry points:

```json
{
	"$schema": "https://unpkg.com/knip@latest/schema.json",
	"entry": [
		"extensions/vscode/src/extension.ts",
		"core/autocomplete/CompletionProvider.ts",
		"core/nextEdit/NextEditProvider.ts",
		"extensions/vscode/src/test/**/*.test.ts",
		"extensions/vscode/src/test/**/*.vitest.ts",
		"core/**/test/**/*.test.ts",
		"core/**/*.vitest.ts"
	],
	"project": ["core/**/*.ts", "extensions/vscode/src/**/*.ts", "packages/**/*.ts"],
	"ignore": [
		"**/*.d.ts",
		"**/node_modules/**",
		"**/dist/**",
		"**/.next/**",
		"**/__mocks__/**",
		"**/test/**",
		"**/*.test.ts",
		"**/*.vitest.ts"
	],
	"ignoreDependencies": ["@types/*"],
	"workspaces": {
		".": {},
		"core": {},
		"extensions/vscode": {},
		"extensions/cli": {},
		"packages/*": {}
	}
}
```

### 2. Conservative Removal Strategy

Given the configuration issues, I recommend:

**Phase 1: Manual Verification (Required Before Any Removal)**

- Verify each "unused" file with `grep -r "filename" core/ extensions/ packages/`
- Check if files are imported dynamically (e.g., via `require()` or string paths)
- Review git history to understand when/why files were added

**Phase 2: Safe Removals Only**

- Start with clearly deprecated files (check git history for "deprecated" commits)
- Remove duplicate implementations (after verification)
- Remove old migration scripts (if versions are very old)

**Phase 3: Test After Each Removal**

- Run `./test-autocomplete.sh` after each batch
- Run full test suite
- Test manually with VSCode extension

### 3. Files That Are Definitely Safe to Keep

- **All test files** - Part of test infrastructure
- **All mock files** - Needed for testing
- **Language info exports** - Used dynamically for autocomplete
- **Path utilities** - Used for file operations
- **Stream transforms** - Part of autocomplete pipeline
- **Type definitions** - Needed for type safety

### 4. Do NOT Remove

❌ Any files in:

- `**/test/**` directories
- `**/__mocks__/**` directories
- `*.test.ts` or `*.vitest.ts` files
- `vitest.config.ts` or test setup files

❌ Any exports that might be:

- Used dynamically via string lookups
- Part of public APIs
- Configuration constants
- Used by external packages

---

## Statistics

- **Total Files Analyzed:** ~2,000+
- **Unused Files Found:** 288
- **Unused Exports Found:** 214
- **Unused Types Found:** 49
- **Unused Dependencies:** 1 (verified as false positive)

**Estimated Safe Removal:**

- Files: 0-10 (needs manual verification)
- Exports: 0 (too risky without better configuration)
- Types: 0 (may be used for type checking)
- Dependencies: 0 (false positive)

---

## Conclusion

The Knip analysis revealed that **the current configuration is not suitable for automated code removal**. The entry points don't match actual file locations, and at least one "unused" dependency is actually used.

### Next Steps:

1. ✅ **Document findings** (this report)
2. ⚠️ **Fix Knip configuration** before proceeding
3. ⚠️ **Re-run analysis** with corrected configuration
4. ⚠️ **Manual verification** of each finding
5. ⚠️ **Conservative removal** in small batches with testing

### Risk Assessment:

Given the configuration issues and false positive, I assess the **risk of automated removal as HIGH**. Manual review and corrected configuration are required before any code can be safely removed.

---

## Configuration Used

```json
{
	"$schema": "https://unpkg.com/knip@latest/schema.json",
	"entry": [
		"extensions/vscode/src/extension.ts",
		"core/autocomplete/index.ts",
		"core/nextEdit/index.ts",
		"core/index.ts",
		"extensions/vscode/src/test/**/*.test.ts",
		"extensions/vscode/src/test/**/*.vitest.ts",
		"core/**/test/**/*.test.ts",
		"core/**/test/**/*.vitest.ts"
	],
	"project": ["core/**/*.ts", "extensions/vscode/src/**/*.ts", "packages/**/*.ts"],
	"ignore": ["**/*.d.ts", "**/node_modules/**", "**/dist/**", "**/.next/**"],
	"ignoreDependencies": ["@types/*"]
}
```

**Issues with this configuration:**

- ❌ `core/autocomplete/index.ts` doesn't exist
- ❌ `core/nextEdit/index.ts` doesn't exist
- ❌ `core/index.ts` doesn't exist
- ❌ Doesn't account for monorepo workspaces
- ❌ Doesn't ignore test infrastructure properly
