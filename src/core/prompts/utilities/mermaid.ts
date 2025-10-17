/**
 * Prompts for Mermaid diagram-related tasks
 */

/**
 * Generate a prompt for fixing invalid Mermaid diagram syntax
 * @param error - The error message from Mermaid parser
 * @param invalidCode - The invalid Mermaid code that needs fixing
 * @returns The formatted prompt for the AI to fix the Mermaid syntax
 */
export const mermaidFixPrompt = (error: string, invalidCode: string): string => {
	return `You are a Mermaid diagram syntax expert. Fix the following invalid Mermaid diagram syntax and return ONLY the corrected Mermaid code without any explanations or markdown formatting.

Error: ${error}

Invalid Mermaid code:
\`\`\`
${invalidCode}
\`\`\`

Requirements:
1. Return ONLY the corrected Mermaid syntax
2. Do not include markdown code blocks or explanations
3. Ensure the syntax is valid according to Mermaid specifications
4. Enclose labels and edge label within double quotes even when you do not think it necessary to ensure the syntax is robust
5. Do not point to multiple nodes with one edge, use multiple edges instead
6. Preserve the original intent and structure as much as possible
7. If the diagram type is unclear, default to a flowchart

Corrected Mermaid code:`
}
