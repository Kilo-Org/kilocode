import { ToolArgs } from "./types"

export function getRefactorCodeDescription(args: ToolArgs): string {
	return `## refactor_code
Description: Request to perform code refactoring operations on TypeScript/JavaScript files. This tool provides automated refactoring capabilities including extracting functions, moving code to new files, and renaming symbols across all references.
Parameters:
- path: (required) The path of the file to refactor (relative to the current workspace directory ${args.cwd})
- operation: (required) The refactoring operation to perform. Supported operations:
  * extract_function: Extract selected code into a new function
  * move_to_file: Move a function or class to a new file
  * rename_symbol: Rename a symbol (variable, function, class, etc.) across all references
- start_line: (required for all operations) The starting line number of the code to refactor (1-based)
- end_line: (required for extract_function and move_to_file) The ending line number of the code to refactor (1-based, inclusive)
- new_name: (required for extract_function and rename_symbol) The new name for the extracted function or renamed symbol
- target_path: (required for move_to_file) The target file path where the code should be moved
Usage:
<refactor_code>
<path>File path here</path>
<operation>Operation type here</operation>
<start_line>Starting line number</start_line>
<end_line>Ending line number (if needed)</end_line>
<new_name>New name (if needed)</new_name>
<target_path>Target file path (if needed)</target_path>
</refactor_code>

Examples:

1. Extract a function from lines 10-20:
<refactor_code>
<path>src/utils/helpers.ts</path>
<operation>extract_function</operation>
<start_line>10</start_line>
<end_line>20</end_line>
<new_name>calculateTotal</new_name>
</refactor_code>

2. Move a class to a new file:
<refactor_code>
<path>src/components/index.ts</path>
<operation>move_to_file</operation>
<start_line>25</start_line>
<end_line>50</end_line>
<target_path>src/components/UserProfile.ts</target_path>
</refactor_code>

3. Rename a variable across all references:
<refactor_code>
<path>src/services/api.ts</path>
<operation>rename_symbol</operation>
<start_line>15</start_line>
<new_name>apiEndpoint</new_name>
</refactor_code>

Note: This tool currently supports TypeScript and JavaScript files. The refactoring operations use VS Code's built-in refactoring capabilities, ensuring safe and accurate code transformations.`
}
