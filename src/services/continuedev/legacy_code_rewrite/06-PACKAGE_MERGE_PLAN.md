# Package Merge Plan: Consolidating Internal Packages into Core

**Status:** Planning Complete - Ready for Execution  
**Goal:** Merge all internal @continuedev packages into core/ to improve Knip analysis  
**Risk Level:** High (84 import updates required)

---

## Package Inventory

### 1. @continuedev/config-types (1 file)

**Source:** `packages/config-types/src/index.ts`  
**Target:** `core/config-types/index.ts`  
**Reason:** Simplest package, good starting point

### 2. @continuedev/fetch (12 files)

**Source:** `packages/fetch/src/`  
**Target:** `core/fetch/`  
**Files:**

```
certs.test.ts, certs.ts, fetch.e2e.test.ts, fetch.ts,
getAgentOptions.test.ts, getAgentOptions.ts, index.ts,
ssl-certificate.test.ts, stream.test.ts, stream.ts,
util.test.ts, util.ts
```

### 3. @continuedev/llm-info (17 files)

**Source:** `packages/llm-info/src/`  
**Target:** `core/llm-info/`  
**Files:**

```
index.ts, types.ts, util.ts
providers/: anthropic.ts, azure.ts, bedrock.ts, cohere.ts, cometapi.ts,
            gemini.ts, mistral.ts, ollama.ts, openai.ts, os.ts,
            vertexai.ts, vllm.ts, voyage.ts, xAI.ts
```

### 4. @continuedev/openai-adapters (37 files)

**Source:** `packages/openai-adapters/src/`  
**Target:** `core/llm/openai-adapters/`  
**Files:**

```
index.ts, types.ts, util.ts
apis/: 28 provider implementation files
test/: 5 test files
util/: 4 utility files
```

### 5. @continuedev/config-yaml (70 files)

**Source:** `packages/config-yaml/src/`  
**Target:** Core already has `core/config/yaml/` - need to merge carefully  
**Strategy:** This package overlaps with existing `core/config/yaml/` - needs special handling

---

## Execution Strategy

### Phase 1: Simple Packages (Low Risk)

1. ✅ Merge config-types (1 file, minimal imports)
2. ✅ Merge fetch (12 files, used in a few places)
3. ✅ Merge llm-info (17 files, provider info lookup)

### Phase 2: Complex Packages (Medium Risk)

4. ✅ Merge openai-adapters (37 files, many LLM provider implementations)

### Phase 3: Overlapping Package (High Risk)

5. ✅ Handle config-yaml (70 files, overlaps with existing core/config/yaml/)

### Phase 4: Update Imports (Critical)

6. ✅ Update all 84 import statements
7. ✅ Update package.json dependencies
8. ✅ Test everything

---

## Import Update Pattern

### From (Package Import):

```typescript
import { something } from "@continuedev/fetch"
import { something } from "@continuedev/llm-info"
import { something } from "@continuedev/openai-adapters"
import { something } from "@continuedev/config-types"
import { something } from "@continuedev/config-yaml"
```

### To (Relative Import):

```typescript
import { something } from "../fetch" // from core/
import { something } from "../../fetch" // from core/subdir/
import { something } from "../../../fetch" // from core/subdir/subdir/
import { something } from "../llm-info" // etc.
import { something } from "../llm/openai-adapters"
import { something } from "../config-types"
import { something } from "../config/yaml-loader" // special case
```

---

## Special Considerations

### config-yaml Overlap

Core already has `core/config/yaml/` with these files:

- `loadYaml.ts`
- `loadYaml.vitest.ts`
- `LocalPlatformClient.vitest.ts`
- `default.ts`
- `models.vitest.ts`

Package has 70 files including schemas, validation, etc.

**Strategy:**

- Rename existing `core/config/yaml/` to `core/config/yaml-loader/`
- Move package content to `core/config/yaml/` (new location)
- Update imports to distinguish between loader and package

---

## Risk Mitigation

1. **Work in order** (simple → complex)
2. **Test after each package** merge
3. **Use git commits** to allow easy rollback
4. **Verify imports** with grep before proceeding
5. **Run ./test-autocomplete.sh** after each phase

---

## File Count Summary

- **Total files to move:** 137
- **Import statements to update:** 84
- **Package.json files to update:** 3 (root, core, extensions/vscode)
- **Risk level:** HIGH but manageable with incremental approach

---

## Success Criteria

✅ All package source files moved to core/  
✅ All imports updated to relative paths  
✅ All tests passing (./test-autocomplete.sh)  
✅ No @continuedev/ dependencies in package.json files  
✅ Knip can now analyze all code without false positives  
✅ Build succeeds

---

## Rollback Plan

If anything fails:

```bash
git reset --hard HEAD  # Revert all changes
```

Each phase will be committed separately to allow selective rollback.

---

## Next Steps

1. Start with Phase 1: config-types (safest)
2. Commit after success
3. Proceed to fetch
4. Continue through phases
5. Test thoroughly at end
