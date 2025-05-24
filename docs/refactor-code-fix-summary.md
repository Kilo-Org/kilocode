# Refactor Code Tool - Fixes and Enhancements

## 1. Approval Flow Fix

### Problem

The refactor code tool was applying changes before asking for user approval, which caused:

1. Changes were visible in the editor before approval
2. The LLM got confused reading the old state after changes were already applied
3. The approval flow was backwards compared to other tools

### Solution Implemented

- Moved the approval request to happen BEFORE executing any refactoring commands
- Show a clear description of what refactoring will be performed
- Only apply changes after user approves
- Removed the redundant undo logic since changes aren't applied until after approval

## 2. Batch Operations Support

### Enhancement

Added support for batch refactoring operations to make the tool more efficient when multiple refactorings are needed.

### Features

- Support for both single operation and batch operations
- Backward compatibility with legacy single operation format
- Clear batch operation descriptions in approval UI
- Sequential execution of batch operations with proper error handling

### New Format Examples

**Single operation (new format):**

```xml
<refactor_code>
<path>src/api.ts</path>
<operations>
{
  "operation": "rename_symbol",
  "start_line": 15,
  "new_name": "apiEndpoint"
}
</operations>
</refactor_code>
```

**Batch operations:**

```xml
<refactor_code>
<path>src/api.ts</path>
<operations>
[
  {
    "operation": "rename_symbol",
    "start_line": 10,
    "new_name": "apiBaseUrl"
  },
  {
    "operation": "rename_symbol",
    "start_line": 15,
    "new_name": "apiTimeout"
  },
  {
    "operation": "extract_function",
    "start_line": 20,
    "end_line": 30,
    "new_name": "validateRequest"
  }
]
</operations>
</refactor_code>
```

### Benefits

- Much faster for multiple refactorings (single approval for all operations)
- Clear visibility of all operations before approval
- Maintains file consistency by re-reading after each operation
- Comprehensive error reporting for each operation in the batch

## 3. Robust Symbol Renaming

### Enhancement

Added support for more robust symbol renaming that can survive file edits by using symbol names instead of just line numbers.

### Features

- **old_name parameter**: Specify the current name to rename (more robust than line numbers)
- **Flexible matching**: Can use either line number, old_name, or both
- **Smart search**: When using old_name, finds the first renameable occurrence
- **Hybrid approach**: When both are provided, verifies old_name exists at the specified line

### Examples

**Rename by name (recommended for robustness):**

```xml
<refactor_code>
<path>src/api.ts</path>
<operations>
{
  "operation": "rename_symbol",
  "old_name": "apiKey",
  "new_name": "apiToken"
}
</operations>
</refactor_code>
```

**Rename by line (when symbol name is ambiguous):**

```xml
<refactor_code>
<path>src/api.ts</path>
<operations>
{
  "operation": "rename_symbol",
  "start_line": 25,
  "new_name": "apiToken"
}
</operations>
</refactor_code>
```

**Rename with both (most precise):**

```xml
<refactor_code>
<path>src/api.ts</path>
<operations>
{
  "operation": "rename_symbol",
  "old_name": "data",
  "start_line": 25,
  "new_name": "processedData"
}
</operations>
</refactor_code>
```

### Benefits

- **Survives file edits**: Using old_name allows renaming even if lines shift
- **Handles ambiguity**: Can specify line number when multiple symbols have the same name
- **Backward compatible**: Still supports line-only renaming
- **Smart matching**: Automatically finds the first renameable occurrence

## Implementation Summary

### Key Changes:

1. **Approval First**: Ask for approval before applying any changes
2. **Batch Support**: Accept array of operations in addition to single operation
3. **Robust Renaming**: Support old_name parameter for rename operations
4. **Legacy Support**: Maintain backward compatibility with old parameter format
5. **Clear Messaging**: Show descriptive operation summaries in approval UI
6. **Error Handling**: Report individual operation failures in batch mode

### Technical Details:

- Refactored parameter parsing to support JSON operations format
- Added loop to process multiple operations sequentially
- Implemented smart symbol search using VS Code's rename provider
- Re-read document between operations to handle file changes
- Aggregate results for batch operations
- Maintain success/failure tracking across operations
