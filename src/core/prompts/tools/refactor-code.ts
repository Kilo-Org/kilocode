import { ToolArgs } from "./types"

export function getRefactorCodeDescription(args: ToolArgs): string {
  return `## refactor_code
Description: Request to perform code refactoring operations on TypeScript/JavaScript files. This tool provides automated refactoring capabilities for moving code to new files and renaming symbols across all references. Supports both single and batch operations for efficiency.
Parameters:
- path: (required) The path of the file to refactor (relative to the current workspace directory ${args.cwd})
- operations: (required) Either a single operation object or an array of operation objects. Each operation must specify one of the following types:

For "move_to_file" operations:
  {
    "operation": "move_to_file",
    "start_line": <number>,     // (required) The starting line number (1-based)
    "end_line": <number>,       // (required) The ending line number (1-based)
    "target_path": <string>     // (required) The target file path
  }

For "rename_symbol" operations:
  {
    "operation": "rename_symbol",
    "new_name": <string>,       // (required) The new name for the symbol
    // Plus ONE of the following to identify the symbol:
    "start_line": <number>,     // Option 1: The line number where the symbol appears (1-based)
    "old_name": <string>        // Option 2: The current name of the symbol (more robust)
  }

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
    "operation": "move_to_file",
    "start_line": 30,
    "end_line": 40,
    "target_path": "src/utils/validation.ts"
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

2. Mixed batch operations:
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

3. Move code to a new file:
<refactor_code>
<path>src/utils/helpers.ts</path>
<operations>
{
  "operation": "move_to_file",
  "start_line": 10,
  "end_line": 20,
  "target_path": "src/utils/formatting.ts"
}
</operations>
</refactor_code>

4. Rename symbol by line number:
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

5. Rename symbol by name (more robust against file changes):
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

Note: This tool supports TypeScript and JavaScript files. It uses VS Code's built-in refactoring capabilities and jscodeshift for code movement operations, ensuring safe and accurate code transformations. Important tips:

1. Batch operations are executed sequentially in the order specified
2. For rename_symbol, using old_name instead of start_line provides more robust matching that survives file edits
3. For move_to_file, ensure the line range contains complete functions/classes/declarations for best results
4. The tool automatically adds export statements to moved code when appropriate`
}
