import { ToolArgs } from "./types"

export function getDeleteFileDescription(args: ToolArgs): string {
	return `## delete_file

Delete a file from the workspace. This tool provides a safe alternative to rm commands and works across all platforms.

**Parameters:**
- path (required): Relative path to the file to delete

**Usage:**
\`\`\`xml
<delete_file>
<path>path/to/file.txt</path>
</delete_file>
\`\`\`

**Safety Features:**
- Only deletes files within the workspace
- Requires user confirmation before deletion
- Prevents deletion of system files and directories
- Currently supports single files only

**Examples:**
\`\`\`xml
<delete_file>
<path>temp/old_file.txt</path>
</delete_file>
\`\`\`

Note: Directory deletion is not currently supported. Delete files individually instead.`
}
