// kilocode_change - new file

import { ToolArgs } from "./types"

export function getFindReferencesDescription(args: ToolArgs): string {
	return `## find_references
Description: Find references/usages of a symbol in the workspace using fast regex search (word-boundary match).

Parameters:
- symbol: (required) Symbol name (class/function/variable) to search for
- path: (optional) Limit search to specific subdirectory (relative to the current workspace directory ${args.cwd}). Leave empty for entire workspace.

Usage:
<find_references>
<symbol>SymbolName</symbol>
<path>Optional subdirectory path</path>
</find_references>
`
}
