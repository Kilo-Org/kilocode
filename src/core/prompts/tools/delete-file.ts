// kilocode_change - file added

import { ToolArgs } from "./types"

export function getDeleteFileDescription(args: ToolArgs): string {
	return `## delete_file

Delete a file or directory from the workspace. This tool provides a safe alternative to rm commands and works across all platforms.

**Parameters:**
- path (required): Relative path to the file or directory to delete

**Usage:**
\`\`\`xml
<delete_file>
<path>path/to/file.txt</path>
</delete_file>
\`\`\`

**Safety Features:**
- Only deletes files/directories within the workspace
- Requires user confirmation before deletion
- Prevents deletion of write-protected files
- Validates all files against .kilocodeignore rules
- For directories: scans recursively and shows statistics (file count, directory count, total size) before deletion
- Blocks directory deletion if any contained file is protected or ignored

**Examples:**

Delete a single file:
\`\`\`xml
<delete_file>
<path>temp/old_file.txt</path>
</delete_file>
\`\`\`

Delete a directory (requires approval with statistics):
\`\`\`xml
<delete_file>
<path>old_project/</path>
</delete_file>
\`\`\``
}
