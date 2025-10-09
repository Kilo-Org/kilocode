// kilocode_change: Morph fast apply - file added

import { getGrokToolCallGuidance, shouldUseGrokToolHandling } from "../../../core/tools/grokUtils"
import { type ClineProviderState } from "../../webview/ClineProvider"

export function getMorphEditingInstructions(): string {
	return `- **You are using specialized \`edit_file\` tool for rapid and reliable code editing.** You MUST ONLY use the \`edit_file\` tool for all file modifications. All other file editing tools are disabled.
- **Follow the formatting rules** in the tool description to ensure your edits are applied correctly.
- When planning to make the edit, briefly think about unchanged sections.
- **USE ELLIPSIS COMMENTS (e.g., \`// ... existing code ...\`) TO CLEARLY MARK UNCHANGED SECTIONS.**`
}

export function getFastApplyEditingInstructions(modelType: "Morph" | "Relace"): string {
	return getMorphEditingInstructions()
}

export function getEditFileDescription(state?: ClineProviderState): string {
	const useGrokGuidance = shouldUseGrokToolHandling(state)
	const grokGuidance = useGrokGuidance ? getGrokToolCallGuidance() : ""

	return `## edit_file

**Purpose**: The ONLY tool for ALL file modifications
**Description**: This tool is highly optimized for speed and accuracy. To ensure your changes are applied both quickly and correctly, it is essential that you follow the formatting rules with precision.

###  CRITICAL Formatting Rules for \`code_edit\`

- 1. **Consolidate Your Edits:** Before using this tool, think through all the changes you need to make to the file. Your \`code_edit\` submission must contain all modifications in a single, complete snippet rather than making small, incremental edits.
- 2. **Use Placeholder Comments:** Represent unchanged code with a placeholder comment (e.g., \`// ... existing code ...\`, \`# ... unchanged code ...\`).
- 3. **Provide Clear Context:** Include 1-3 lines of original, unchanged code to anchor the edit. Be as length-efficient as possible, but always provide enough context to make the edit's location unambiguous.
- 4. **Maintain Exact Formatting:** Ensure your code snippet precisely matches the final desired indentation and structure. The edit should appear exactly as it will in the final version of the file.
- 5. **Handle Deletions:** To remove a block of code, show the lines immediately before and after it.

### REQUIRED Parameters
**target_file:** (string, required) The absolute path to the file to be modified.
**instructions:** (string, required) A brief, first-person sentence describing the intent of your change (e.g., "I will add error handling to the database connection logic").
**code_edit:** (string, required) The code snippet for the edit, following all the formatting rules listed above.

### Example of \`edit_file\` Usage
To update a constant, add a new log to a function, and delete an obsolete function (\`oldFunction\`), your edit should look like this:
\`\`\`
<edit_file>
<target_file>/path/to/file.js</target_file>
<instructions>I will update the MAX_ITEMS constant, add logging to processItems, and remove oldFunction</instructions>
<code_edit>
// ... existing imports ...
const MAX_ITEMS = 100;  // Updated from 50
// ... existing code ...

function processItems() {
  // ... no changes ...
  validateInput();
  console.log("Processing items...");  // Added logging
  for (let i = 0; i < MAX_ITEMS; i++) {
    // ... existing code ...
  }
}
// oldFunction removed - was here between processItems and newFunction

function newFunction() {
  // ... unchanged code ...
}
// ... existing code ...
</code_edit>
</edit_file>
\`\`\`${grokGuidance}`
}
