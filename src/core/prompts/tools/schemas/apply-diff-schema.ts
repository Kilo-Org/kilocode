import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

export function generateApplyDiffSchema(args: ToolArgs): BaseToolSchema {
	if (args?.diffStrategy?.getName() === "MultiFileSearchReplace") {
		return generateMultipleApplyDiffSchema(args)
	}
	const schema: BaseToolSchema = {
		name: "apply_diff",
		description: `Request to apply PRECISE, TARGETED modifications to an existing file by searching for specific sections of content and replacing them. This tool is for SURGICAL EDITS ONLY - specific changes to existing code.
You can perform multiple distinct search and replace operations within a single \`apply_diff\` call by providing multiple SEARCH/REPLACE blocks in the \`diff\` parameter. This is the preferred way to make several targeted changes efficiently.
The SEARCH section must exactly match existing content including whitespace and indentation.
If you're not confident in the exact content to search for, use the read_file tool first to get the exact content.
When applying the diffs, be extra careful to remember to change any closing brackets or other syntax that may be affected by the diff farther down in the file.
ALWAYS make as many changes in a single 'apply_diff' request as possible using multiple SEARCH/REPLACE blocks.
The \`search\` parameter MUST BE a verbatim, character-for-character copy from the file content.`,
		parameters: [
			{
				name: "path",
				type: "string",
				description: `The path of the file to modify (relative to the current workspace directory ${args.cwd})`,
				required: true,
			},
			{
				name: "diff",
				type: "array",
				description: `A list of search-and-replace operations to perform on the file. Multiple operations can be provided to make several targeted changes in a single efficient call.`,
				required: true,
				items: {
					name: "diffItem",
					type: "object",
					description: "A single search-and-replace operation.",
					required: true,
					properties: {
						start_line: {
							name: "start_line",
							type: "number",
							description: "The line number of original content where the search block starts.",
							required: true,
						},
						search: {
							name: "search",
							type: "string",
							description:
								"The exact block of text to be replaced. **CRITICAL:** This text MUST BE a *verbatim copy* from the file, including all whitespace, indentation, and newlines and must be not empty string. To maximize success, keep this block as short as possible while ensuring it's unique enough to avoid incorrect matches.",
							required: true,
						},
						replace: {
							name: "replace",
							type: "string",
							description:
								"The new text that will replace the `search` block. **IMPORTANT:** You must provide the correct indentation and formatting for this new code block so it fits seamlessly into the surrounding file content.",
							required: true,
						},
					},
				},
			},
		],

		systemPrompt: `## apply_diff
Description: Request to apply PRECISE, TARGETED modifications to an existing file by searching for specific sections of content and replacing them. This tool is for SURGICAL EDITS ONLY - specific changes to existing code.
You can perform multiple distinct search and replace operations within a single \`apply_diff\` call by providing multiple SEARCH/REPLACE blocks in the \`diff\` parameter. This is the preferred way to make several targeted changes efficiently.
The SEARCH section must exactly match existing content including whitespace and indentation.
If you're not confident in the exact content to search for, use the read_file tool first to get the exact content.
When applying the diffs, be extra careful to remember to change any closing brackets or other syntax that may be affected by the diff farther down in the file.
ALWAYS make as many changes in a single 'apply_diff' request as possible using multiple SEARCH/REPLACE blocks

Parameters:
- path: (required) The path of the file to modify (relative to the current workspace directory ${args.cwd})
- diff: (required) The search/replace block defining the changes.

Diff format:
\`\`\`
<<<<<<< SEARCH
:start_line: (required) The line number of original content where the search block starts.
-------
[exact content to find including whitespace]
=======
[new content to replace with]
>>>>>>> REPLACE

\`\`\`


Example:

Original file:
\`\`\`
1 | def calculate_total(items):
2 |     total = 0
3 |     for item in items:
4 |         total += item
5 |     return total
\`\`\`

Search/Replace content:
\`\`\`
<<<<<<< SEARCH
:start_line:1
-------
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
=======
def calculate_total(items):
    """Calculate total with 10% markup"""
    return sum(item * 1.1 for item in items)
>>>>>>> REPLACE

\`\`\`

Search/Replace content with multiple edits:
\`\`\`
<<<<<<< SEARCH
:start_line:1
-------
def calculate_total(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:4
-------
        total += item
    return total
=======
        sum += item
    return sum 
>>>>>>> REPLACE
\`\`\`


Usage:
<apply_diff>
<path>File path here</path>
<diff>
Your search/replace content here
You can use multi search/replace block in one diff block, but make sure to include the line numbers for each block.
Only use a single line of '=======' between search and replacement content, because multiple '=======' will corrupt the file.
</diff>
</apply_diff>`,
	}

	return schema
}

function generateMultipleApplyDiffSchema(args: ToolArgs): BaseToolSchema {
	const schema: BaseToolSchema = {
		name: "apply_diff",
		description: `Request to apply PRECISE, TARGETED modifications to one or more files by searching for specific sections of content and replacing them. This tool is for SURGICAL EDITS ONLY - specific changes to existing code. This tool supports both single-file and multi-file operations, allowing you to make changes across multiple files in a single request.

**IMPORTANT: You MUST use multiple files in a single operation whenever possible to maximize efficiency and minimize back-and-forth.**

You can perform multiple distinct search and replace operations within a single \`apply_diff\` call by providing multiple SEARCH/REPLACE blocks in the \`diff\` parameter. This is the preferred way to make several targeted changes efficiently.

The SEARCH section must exactly match existing content including whitespace and indentation.
If you're not confident in the exact content to search for, use the read_file tool first to get the exact content.
When applying the diffs, be extra careful to remember to change any closing brackets or other syntax that may be affected by the diff farther down in the file.
ALWAYS make as many changes in a single 'apply_diff' request as possible using multiple SEARCH/REPLACE blocks.
The \`search\` parameter MUST BE a verbatim, character-for-character copy from the file content.`,
		parameters: [
			{
				name: "file",
				type: "array",
				description: `One or more file change objects.`,
				required: true,
				items: {
					name: "fileItem",
					type: "object",
					description: "A file modification object containing the path and diff operations.",
					required: true,
					properties: {
						path: {
							name: "path",
							type: "string",
							description: `The path of the file to modify (relative to the current workspace directory ${args.cwd})`,
							required: true,
						},
						diff: {
							name: "diff",
							type: "array",
							description:
								"One or more diff operations for this file - batch multiple changes per file for efficiency.",
							required: true,
							items: {
								name: "diffItem",
								type: "object",
								description:
									"A single search-and-replace operation. This object contains the search criteria and the replacement content.",
								required: true,
								properties: {
									search: {
										name: "search",
										type: "string",
										description:
											"The exact block of text to be replaced. **CRITICAL:** This text MUST BE a *verbatim copy* from the file, including all whitespace, indentation, and newlines and must be not empty string. To maximize success, keep this block as short as possible while ensuring it's unique enough to avoid incorrect matches.",
										required: true,
									},
									replace: {
										name: "replace",
										type: "string",
										description:
											"The new text that will replace the `search` block. **IMPORTANT:** You must provide the correct indentation and formatting for this new code block so it fits seamlessly into the surrounding file content.",
										required: true,
									},
									start_line: {
										name: "start_line",
										type: "number",
										description:
											"The line number of original content where the search block starts.",
										required: false,
									},
								},
							},
						},
					},
				},
			},
		],
		systemPrompt: `## apply_diff

Description: Request to apply PRECISE, TARGETED modifications to one or more files by searching for specific sections of content and replacing them. This tool is for SURGICAL EDITS ONLY - specific changes to existing code. This tool supports both single-file and multi-file operations, allowing you to make changes across multiple files in a single request.

**IMPORTANT: You MUST use multiple files in a single operation whenever possible to maximize efficiency and minimize back-and-forth.**

You can perform multiple distinct search and replace operations within a single \`apply_diff\` call by providing multiple SEARCH/REPLACE blocks in the \`diff\` parameter. This is the preferred way to make several targeted changes efficiently.

The SEARCH section must exactly match existing content including whitespace and indentation.
If you're not confident in the exact content to search for, use the read_file tool first to get the exact content.
When applying the diffs, be extra careful to remember to change any closing brackets or other syntax that may be affected by the diff farther down in the file.
ALWAYS make as many changes in a single 'apply_diff' request as possible using multiple SEARCH/REPLACE blocks

Parameters:
- args: Contains one or more file elements, where each file contains:
  - path: (required) The path of the file to modify (relative to the current workspace directory ${args.cwd})
  - diff: (required) One or more diff elements containing:
    - content: (required) The search/replace block defining the changes.
    - start_line: (required) The line number of original content where the search block starts.

Diff format:
\`\`\`
<<<<<<< SEARCH
:start_line: (required) The line number of original content where the search block starts.
-------
[exact content to find including whitespace]
=======
[new content to replace with]
>>>>>>> REPLACE
\`\`\`

Example:

Original file:
\`\`\`
1 | def calculate_total(items):
2 |     total = 0
3 |     for item in items:
4 |         total += item
5 |     return total
\`\`\`

Search/Replace content:
<apply_diff>
<args>
<file>
  <path>eg.file.py</path>
  <diff>
    <content><![CDATA[
<<<<<<< SEARCH
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
=======
def calculate_total(items):
    """Calculate total with 10% markup"""
    return sum(item * 1.1 for item in items)
>>>>>>> REPLACE
]]></content>
  </diff>
</file>
</args>
</apply_diff>

Search/Replace content with multi edits across multiple files:
<apply_diff>
<args>
<file>
  <path>eg.file.py</path>
  <diff>
    <content><![CDATA[
<<<<<<< SEARCH
def calculate_total(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE
]]></content>
  </diff>
  <diff>
    <content><![CDATA[
<<<<<<< SEARCH
        total += item
    return total
=======
        sum += item
    return sum 
>>>>>>> REPLACE
]]></content>
  </diff>
</file>
<file>
  <path>eg.file2.py</path>
  <diff>
    <content><![CDATA[
<<<<<<< SEARCH
def greet(name):
    return "Hello " + name
=======
def greet(name):
    return f"Hello {name}!"
>>>>>>> REPLACE
]]></content>
  </diff>
</file>
</args>
</apply_diff>


Usage:
<apply_diff>
<args>
<file>
  <path>File path here</path>
  <diff>
    <content>
Your search/replace content here
You can use multi search/replace block in one diff block, but make sure to include the line numbers for each block.
Only use a single line of '=======' between search and replacement content, because multiple '=======' will corrupt the file.
    </content>
    <start_line>1</start_line>
  </diff>
</file>
<file>
  <path>Another file path</path>
  <diff>
    <content>
Another search/replace content here
You can apply changes to multiple files in a single request.
Each file requires its own path, start_line, and diff elements.
    </content>
    <start_line>5</start_line>
  </diff>
</file>
</args>
</apply_diff>`,
	}

	return schema
}
