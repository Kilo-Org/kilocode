# Refactor Code Tool - Auto-Save Implementation

## Summary

Added automatic file saving after batch rename operations are applied in the refactorCodeTool.

## Changes Made

### 1. Core Implementation (`src/core/tools/refactorCodeTool.ts`)

Added automatic save after all refactoring operations are completed:

```typescript
// Save the document after all operations are completed
await document.save()
```

This ensures that:

- Files are saved between operations in a batch (already existed)
- Files are saved after ALL operations are completed (newly added)

### 2. Test Updates (`src/core/tools/__tests__/refactorCodeTool.test.ts`)

Updated all test cases to include the `save` mock on document objects:

```typescript
const mockDocument = {
	// ... other properties
	save: jest.fn().mockResolvedValue(true),
}
```

Also updated test assertions to verify that save is called:

```typescript
expect(mockDocument.save).toHaveBeenCalled()
```

## Behavior

Now when using the refactor_code tool:

1. **Single Operation**: The file is saved once after the operation completes
2. **Batch Operations**:
    - Files are saved between each operation (for operations after the first)
    - Files are saved once more after all operations complete

This ensures that all refactoring changes are persisted to disk automatically, matching the behavior of other file-editing operations in the codebase.

## Testing

All 17 tests in the refactorCodeTool test suite are passing, confirming that:

- The save functionality works correctly
- Existing functionality is not broken
- Both single and batch operations save files appropriately
