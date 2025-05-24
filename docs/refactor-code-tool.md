# Refactor Code Tool

The `refactor_code` tool provides automated refactoring capabilities for TypeScript and JavaScript files using VS Code's built-in refactoring features.

## Supported Operations

### 1. Extract Function

Extracts selected lines of code into a new function.

**Parameters:**

- `path`: The file path
- `operation`: "extract_function"
- `start_line`: Starting line number (1-based)
- `end_line`: Ending line number (1-based, inclusive)
- `new_name`: Name for the extracted function

**Example:**

```xml
<refactor_code>
<path>src/utils/calculator.ts</path>
<operation>extract_function</operation>
<start_line>10</start_line>
<end_line>15</end_line>
<new_name>calculateSum</new_name>
</refactor_code>
```

### 2. Move to File

Moves a function or class to a new file.

**Parameters:**

- `path`: The source file path
- `operation`: "move_to_file"
- `start_line`: Starting line number of the code to move
- `end_line`: Ending line number of the code to move
- `target_path`: The destination file path

**Example:**

```xml
<refactor_code>
<path>src/components/index.ts</path>
<operation>move_to_file</operation>
<start_line>25</start_line>
<end_line>50</end_line>
<target_path>src/components/UserProfile.ts</target_path>
</refactor_code>
```

### 3. Rename Symbol

Renames a variable, function, class, or other symbol across all references.

**Parameters:**

- `path`: The file path
- `operation`: "rename_symbol"
- `start_line`: Line number where the symbol is defined
- `new_name`: New name for the symbol

**Example:**

```xml
<refactor_code>
<path>src/services/api.ts</path>
<operation>rename_symbol</operation>
<start_line>15</start_line>
<new_name>apiEndpoint</new_name>
</refactor_code>
```

## Implementation Details

The tool uses VS Code's built-in refactoring capabilities:

- `editor.action.codeAction` with `CodeActionKind.RefactorExtract` for extract function
- `editor.action.codeAction` with `CodeActionKind.RefactorMove` for move to file
- `editor.action.rename` for rename symbol

## Error Handling

The tool handles various error cases:

- Missing required parameters
- Invalid line numbers
- File not found
- Refactoring operation failures

## User Approval

All refactoring operations require user approval before being applied. Users can:

- Review the proposed changes
- Accept the refactoring
- Reject and undo the changes

## Current Limitations

- Currently supports TypeScript and JavaScript files only
- Relies on VS Code's refactoring capabilities
- Some complex refactorings may require manual adjustments
