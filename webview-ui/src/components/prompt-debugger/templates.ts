// Template definitions for the Prompt Debugger

export const documentationTemplate = `# Document Analysis: {{document.name}}

## File Information
- **Path:** {{document.path}}
- **Language:** {{document.language}}
- **Line Count:** {{document.lineCount}}

## Current Selection
\`\`\`{{document.language}}
{{selection.text}}
\`\`\`

## Cursor Position
- Line: {{cursor.line}}
- Column: {{cursor.column}}

## Content Before Cursor
\`\`\`{{document.language}}
{{content.beforeCursor}}
\`\`\`

## Content After Cursor
\`\`\`{{document.language}}
{{content.afterCursor}}
\`\`\`

## Generated on: {{date}}
`

export const holeFillTemplate = `You are a HOLE FILLER. You are provided with a file containing holes, formatted as '{{HOLE_NAME}}'.
Your TASK is to complete with a string to replace this hole with, including context-aware indentation, if needed.

## Current file information
- File: {{document.name}}
- Language: {{document.language}}

## Current file content with hole:
\`\`\`{{document.language}}
{{content.all}}
\`\`\`

## Cursor is at position: Line {{cursor.line}}, Column {{cursor.column}}

TASK: Fill in the code at the cursor position, ensuring it fits properly with the surrounding context.
Answer only with the CORRECT completion.`

// Default templates array
export const defaultTemplates = [
	{ id: "documentation", name: "Documentation Template", content: documentationTemplate },
	{ id: "holeFiller", name: "Hole Filler Template", content: holeFillTemplate },
]
