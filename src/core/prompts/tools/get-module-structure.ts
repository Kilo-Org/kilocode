// kilocode_change - new file

import { ToolArgs } from "./types"

export function getGetModuleStructureDescription(args: ToolArgs): string {
	return `## get_module_structure
Description: Get a high-level overview of the directory/module structure as a tree.

Parameters:
- path: (optional) Subdirectory path (relative to the current workspace directory ${args.cwd}). Leave empty for workspace root.
- depth: (optional) Tree depth (1-4). Default: 2.

Usage:
<get_module_structure>
<path>Optional subdirectory path</path>
<depth>2</depth>
</get_module_structure>
`
}
