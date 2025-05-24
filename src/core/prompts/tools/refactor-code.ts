import { ToolArgs } from "./types"

export function getRefactorCodeDescription(args: ToolArgs): string {
	return `## refactor_code
Description: Request to perform code refactoring operations on TypeScript/JavaScript files. This tool provides automated refactoring capabilities including extracting functions, moving code to new files, and renaming symbols across all references. Supports both single and batch operations for efficiency.
Parameters:
- path: (required) The path of the file to refactor (relative to the current workspace directory ${args.cwd})
- operations: (required) Either a single operation object or an array of operation objects. Each operation object contains:
  * operation: The refactoring operation to perform (extract_function, move_to_file, or rename_symbol)
  * start_line: The starting line number of the code to refactor (1-based, optional for rename_symbol if old_name is provided)
  * end_line: The ending line number (required for extract_function and move_to_file)
  * new_name: The new name (required for extract_function and rename_symbol)
  * old_name: The current name to rename (optional for rename_symbol, provides more robust matching)
  * target_path: The target file path (required for move_to_file)

Usage for single operation:
<refactor_code>
<path>File path here</path>
<operations>
{
  "operation": "rename_symbol",
  "start_line": 15,
  "new_name": "apiEndpoint"
}
</operations>
</refactor_code>

Usage for batch operations:
<refactor_code>
<path>File path here</path>
<operations>
[
  {
    "operation": "rename_symbol",
    "start_line": 15,
    "new_name": "apiEndpoint"
  },
  {
    "operation": "rename_symbol",
    "start_line": 25,
    "new_name": "userService"
  },
  {
    "operation": "extract_function",
    "start_line": 30,
    "end_line": 40,
    "new_name": "validateInput"
  }
]
</operations>
</refactor_code>

Examples:

1. Batch rename multiple symbols (using old_name for robustness):
<refactor_code>
<path>src/services/api.ts</path>
<operations>
[
  {
    "operation": "rename_symbol",
    "old_name": "baseUrl",
    "new_name": "apiBaseUrl"
  },
  {
    "operation": "rename_symbol",
    "old_name": "timeout",
    "new_name": "apiTimeout"
  },
  {
    "operation": "rename_symbol",
    "old_name": "headers",
    "new_name": "apiHeaders"
  }
]
</operations>
</refactor_code>

2. Single extract function:
<refactor_code>
<path>src/utils/helpers.ts</path>
<operations>
{
  "operation": "extract_function",
  "start_line": 10,
  "end_line": 20,
  "new_name": "calculateTotal"
}
</operations>
</refactor_code>

3. Mixed batch operations:
<refactor_code>
<path>src/components/index.ts</path>
<operations>
[
  {
    "operation": "rename_symbol",
    "start_line": 5,
    "new_name": "ComponentBase"
  },
  {
    "operation": "move_to_file",
    "start_line": 25,
    "end_line": 50,
    "target_path": "src/components/UserProfile.ts"
  }
]
</operations>
</refactor_code>

4. Rename with line number (when symbol name is ambiguous):
<refactor_code>
<path>src/utils/helpers.ts</path>
<operations>
{
  "operation": "rename_symbol",
  "start_line": 25,
  "new_name": "processedData"
}
</operations>
</refactor_code>

5. Rename with old_name (more robust against file changes):
<refactor_code>
<path>src/utils/helpers.ts</path>
<operations>
{
  "operation": "rename_symbol",
  "old_name": "data",
  "new_name": "processedData"
}
</operations>
</refactor_code>

Note: This tool currently supports TypeScript and JavaScript files. The refactoring operations use VS Code's built-in refactoring capabilities, ensuring safe and accurate code transformations. Batch operations are executed sequentially in the order specified. For rename_symbol, using old_name instead of start_line provides more robust matching that survives file edits.`
}
