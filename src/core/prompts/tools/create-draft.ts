// kilocode_change start: Add create_draft tool description function
import { ToolArgs } from "./types"

export function getCreateDraftDescription(args: ToolArgs): string {
	return `## create_draft
Description: Create a temporary, in-memory planning document that appears as an editor tab but is not saved to disk. These documents use a special draft:// URI scheme and are discarded when the editor session ends. This enables creating planning documents, implementation plans, and other ephemeral working documents for structured thinking.

The created document will:
- Appear as a normal editor tab that can be edited by the user
- Be accessible via read_file and write_to_file tools using the returned draft:// path
- Be automatically discarded when the editor session ends (not saved to disk)

Parameters:
- title: (required) The title/name of the draft document. Will be used as the filename (automatically adds .md extension if not present)
- content: (required) The initial content of the draft document

Usage:
<create_draft>
<title>document-title</title>
<content>
Your document content here
</content>
</create_draft>

Example: Creating a planning document
<create_draft>
<title>implementation-plan</title>
<content>
# Implementation Plan

## Step 1
- Task A
- Task B

## Step 2
- Task C
</content>
</create_draft>

Example: Creating a quick note
<create_draft>
<title>quick-notes</title>
<content>
Remember to:
1. Check API documentation
2. Test edge cases
3. Update tests
</content>
</create_draft>`
}
