import { LLMClient } from "./llm-client.js"

const CURSOR_MARKER = "<<<AUTOCOMPLETE_HERE>>>"

export class AutoTriggerStrategyTester {
	private llmClient: LLMClient

	constructor(llmClient: LLMClient) {
		this.llmClient = llmClient
	}

	getSystemInstructions(): string {
		return `CRITICAL OUTPUT FORMAT:
You must respond with XML-formatted changes ONLY. No explanations or text outside XML tags.

Format: <change><search><![CDATA[exact_code]]></search><replace><![CDATA[new_code]]></replace></change>

MANDATORY XML STRUCTURE RULES:
- Every <change> tag MUST have a closing </change> tag
- Every <search> tag MUST have a closing </search> tag
- Every <replace> tag MUST have a closing </replace> tag
- Every <![CDATA[ MUST have a closing ]]>
- XML tags should be properly formatted and nested
- Multiple <change> blocks allowed for different modifications

Task: Subtle Auto-Completion
Provide non-intrusive completions after a typing pause. Be conservative and helpful.

Auto-Complete Rules:
- Small, obvious completions only
- Single line preferred (max 2-3 lines)
- Complete the current thought based on context
- Don't be creative or add new features
- Match exactly what seems to be typed
- Only suggest if there's a clear, obvious completion

Common Completions:
- Closing brackets, parentheses, or braces
- Semicolons at end of statements
- Simple property or method access
- Variable assignments after declaration
- Return statements in functions
- Import statements completion
- Simple loop or conditional bodies

Avoid:
- Multi-line complex suggestions
- New functionality or features
- Refactoring existing code
- Complex logic or algorithms
- Anything that changes program behavior significantly

## CRITICAL: Cursor Marker Usage
- The cursor position is marked with ${CURSOR_MARKER}
- Your <search> block MUST include the cursor marker to avoid conflicts
- When creating <search> content, include text around the cursor marker
- This ensures you target the exact location, not similar text elsewhere

Important:
- If nothing obvious to complete, provide NO suggestion
- Respect the user's coding style
- Keep suggestions minimal and predictable
- Focus on helping finish what's being typed`
	}

	buildUserPrompt(code: string, cursorPosition: { line: number; character: number }): string {
		const lines = code.split("\n")
		const currentLine = lines[cursorPosition.line]
		const cursorChar = cursorPosition.character

		let prompt = ""

		// Analyze what might need completion
		const beforeCursor = currentLine.substring(0, cursorChar).trim()
		const afterCursor = currentLine.substring(cursorChar).trim()

		prompt += "## Completion Context\n"

		// Check for incomplete patterns
		if (beforeCursor.endsWith(".")) {
			prompt += "- Property or method access started\n"
		}
		if (beforeCursor.endsWith("(")) {
			prompt += "- Function call or declaration started\n"
		}
		if (beforeCursor.endsWith("{")) {
			prompt += "- Block or object literal started\n"
		}
		if (beforeCursor.endsWith("[")) {
			prompt += "- Array or index access started\n"
		}
		if (beforeCursor.match(/=\s*$/)) {
			prompt += "- Assignment started\n"
		}
		if (beforeCursor.match(/return\s*$/)) {
			prompt += "- Return statement started\n"
		}
		if (beforeCursor.match(/import\s+.*\s+from\s*$/)) {
			prompt += "- Import statement needs module\n"
		}
		if (beforeCursor.match(/^\s*(const|let|var)\s+\w+\s*$/)) {
			prompt += "- Variable declaration needs initialization\n"
		}

		// Check for missing closures
		const openParens = (beforeCursor.match(/\(/g) || []).length
		const closeParens = (beforeCursor.match(/\)/g) || []).length
		if (openParens > closeParens) {
			prompt += `- ${openParens - closeParens} unclosed parenthesis\n`
		}

		const openBrackets = (beforeCursor.match(/\[/g) || []).length
		const closeBrackets = (beforeCursor.match(/\]/g) || []).length
		if (openBrackets > closeBrackets) {
			prompt += `- ${openBrackets - closeBrackets} unclosed bracket\n`
		}

		const openBraces = (beforeCursor.match(/\{/g) || []).length
		const closeBraces = (beforeCursor.match(/\}/g) || []).length
		if (openBraces > closeBraces && !afterCursor.startsWith("}")) {
			prompt += `- ${openBraces - closeBraces} unclosed brace\n`
		}

		prompt += "\n## Current Position\n"
		prompt += `Line ${cursorPosition.line + 1}, Character ${cursorPosition.character + 1}\n\n`

		prompt += "## Full Code\n"
		prompt += "```javascript\n"
		prompt += code
		prompt += "\n```\n\n"

		prompt += "## Instructions\n"
		prompt += `Provide a minimal, obvious completion at the cursor position (${CURSOR_MARKER}).\n`
		prompt += `IMPORTANT: Your <search> block must include the cursor marker ${CURSOR_MARKER} to target the exact location.\n`
		prompt += "Include surrounding text with the cursor marker to avoid conflicts with similar code elsewhere.\n"
		prompt += "Complete only what the user appears to be typing.\n"
		prompt += "Single line preferred, no new features.\n"
		prompt += "If nothing obvious to complete, provide NO suggestion.\n"

		return prompt
	}

	async getCompletion(code: string, cursorPosition: { line: number; character: number }): Promise<string> {
		const systemPrompt = this.getSystemInstructions()
		const userPrompt = this.buildUserPrompt(code, cursorPosition)

		const response = await this.llmClient.sendPrompt(systemPrompt, userPrompt)
		return response.content
	}

	parseCompletion(xmlResponse: string): { search: string; replace: string }[] {
		const changes: { search: string; replace: string }[] = []

		// Parse XML response to extract change blocks
		const changeRegex =
			/<change>\s*<search><!\[CDATA\[(.*?)\]\]><\/search>\s*<replace><!\[CDATA\[(.*?)\]\]><\/replace>\s*<\/change>/gs

		let match
		while ((match = changeRegex.exec(xmlResponse)) !== null) {
			changes.push({
				search: match[1],
				replace: match[2],
			})
		}

		return changes
	}
}
