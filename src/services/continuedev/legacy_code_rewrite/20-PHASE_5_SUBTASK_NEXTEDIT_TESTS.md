# Phase 5 Subtask: Add Test Coverage for NextEdit Context Files

## Objective

Create vitest tests for the 5 NextEdit context files that were mistakenly identified as unused in Phase 4 Batch 3. These files are part of the NextEdit feature and should be retained with proper test coverage.

In the original codebase, usage looked e.g. like this in core.ts:

    on("files/smallEdit", async ({ data }) => {
      const EDIT_AGGREGATION_OPTIONS = {
        deltaT: 1.0,
        deltaL: 5,
        maxEdits: 500,
        maxDuration: 120.0,
        contextSize: 5,
      };

      EditAggregator.getInstance(
        EDIT_AGGREGATION_OPTIONS,
        (
          beforeAfterdiff: BeforeAfterDiff,
          cursorPosBeforeEdit: Position,
          cursorPosAfterPrevEdit: Position,
        ) => {
          void processSmallEdit(
            beforeAfterdiff,
            cursorPosBeforeEdit,
            cursorPosAfterPrevEdit,
            data.configHandler,
            data.getDefsFromLspFunction,
            this.ide,
          );
        },
      );

      const workspaceDir =
        data.actions.length > 0 ? data.actions[0].workspaceDir : undefined;

      // Store the latest context data
      const instance = EditAggregator.getInstance();
      (instance as any).latestContextData = {
        configHandler: data.configHandler,
        getDefsFromLspFunction: data.getDefsFromLspFunction,
        recentlyEditedRanges: data.recentlyEditedRanges,
        recentlyVisitedRanges: data.recentlyVisitedRanges,
        workspaceDir: workspaceDir,
      };

      // queueMicrotask prevents blocking the UI thread during typing
      queueMicrotask(() => {
        void EditAggregator.getInstance().processEdits(data.actions);
      });
    });

## Files Requiring Test Coverage

### 1. core/nextEdit/context/aggregateEdits.ts

**Purpose**: Aggregates multiple edits together for NextEdit
**Key Functions to Test**:

- Main aggregation logic
- Edge cases: empty edits, single edit, multiple edits
- Proper handling of edit ranges and content

### 2. core/nextEdit/context/autocompleteContextFetching.ts

**Purpose**: Fetches context for autocomplete/NextEdit
**Key Functions to Test**:

- Context fetching with different inputs
- Handling of file paths and positions
- Return value structure

### 3. core/nextEdit/context/prevEditLruCache.ts

**Purpose**: LRU cache for previous edits
**Key Functions to Test**:

- Cache operations: set, get, has
- LRU eviction behavior
- Cache size limits

### 4. core/nextEdit/context/processNextEditData.ts

**Purpose**: Processes NextEdit data/responses
**Key Functions to Test**:

- Data processing pipeline
- Input validation
- Output formatting

### 5. core/nextEdit/context/processSmallEdit.ts

**Purpose**: Handles processing of small/incremental edits
**Key Functions to Test**:

- Small edit detection
- Edit processing logic
- Integration with larger edit system

## Implementation Steps

### Step 1: Analyze File Exports and Usage

```bash
# Check what each file exports
grep -r "export" core/nextEdit/context/aggregateEdits.ts
grep -r "export" core/nextEdit/context/autocompleteContextFetching.ts
grep -r "export" core/nextEdit/context/prevEditLruCache.ts
grep -r "export" core/nextEdit/context/processNextEditData.ts
grep -r "export" core/nextEdit/context/processSmallEdit.ts

# Check where they're imported
grep -r "from.*aggregateEdits" core/nextEdit/
grep -r "from.*autocompleteContextFetching" core/nextEdit/
grep -r "from.*prevEditLruCache" core/nextEdit/
grep -r "from.*processNextEditData" core/nextEdit/
grep -r "from.*processSmallEdit" core/nextEdit/
```

### Step 2: Create Test Files

Create vitest test files for each:

- `core/nextEdit/context/aggregateEdits.vitest.ts`
- `core/nextEdit/context/autocompleteContextFetching.vitest.ts`
- `core/nextEdit/context/prevEditLruCache.vitest.ts`
- `core/nextEdit/context/processNextEditData.vitest.ts`
- `core/nextEdit/context/processSmallEdit.vitest.ts`

### Step 3: Write Minimal Core Feature Tests

For each test file, follow this pattern:

```typescript
import { describe, it, expect } from "vitest"
import { functionName } from "./filename"

describe("filename", () => {
	describe("functionName", () => {
		it("should handle basic case", () => {
			// Test core functionality
			const result = functionName(testInput)
			expect(result).toBeDefined()
			// Add specific assertions based on function behavior
		})

		it("should handle empty/null inputs", () => {
			// Test edge cases
		})

		it("should handle typical usage pattern", () => {
			// Test realistic usage scenario
		})
	})
})
```

### Step 4: Test Coverage Goals

- **NOT aiming for 100% coverage** - just enough to prove the code is used
- **Focus on**: Main exported functions, typical usage patterns, critical edge cases
- **Skip**: Internal helpers, error handling minutiae, every possible permutation

### Step 5: Verify Tests Pass

```bash
./test-autocomplete.sh
```

## Success Criteria

- [ ] All 5 context files have vitest test files
- [ ] Each test file has at least 3-5 meaningful tests covering core functionality
- [ ] All existing tests still pass (531 total)
- [ ] New tests demonstrate the files are actually used and functional
- [ ] Tests are minimal but sufficient - not over-engineered

## Notes

- If any file truly is unused (no imports found), document that instead of writing tests
- Focus on black-box testing of public APIs, not internal implementation details
- Mock external dependencies where needed to isolate the code under test
- Keep tests simple and maintainable
