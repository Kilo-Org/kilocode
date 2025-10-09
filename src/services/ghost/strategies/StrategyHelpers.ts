import type { TextDocument, Range, Diagnostic } from "vscode"
import { CURSOR_MARKER } from "../ghostConstants"
import { DiagnosticSeverityNames } from "./diagnostics"

export function getBaseSystemInstructions(): string {
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

CHANGE ORDERING PRIORITY:
- CRITICAL: Order all <change> blocks by proximity to the cursor marker (<<<AUTOCOMPLETE_HERE>>>)
- Put changes closest to the cursor marker FIRST in your response
- This allows immediate display of the most relevant suggestions to the user
- Changes further from the cursor should come later in the response
- Measure proximity by line distance from the cursor marker position

CONTENT MATCHING RULES:
- Search content must match EXACTLY (including whitespace, indentation, and line breaks)
- Use CDATA wrappers for all code content
- Preserve all line breaks and formatting within CDATA sections
- Never generate overlapping changes
- The <search> block must contain exact text that exists in the code
- If you can't find exact match, don't generate that change

EXAMPLE:
<change><search><![CDATA[function example() {
	 // old code
}]]></search><replace><![CDATA[function example() {
	 // new code
}]]></replace></change>

--

`
}

export function addCursorMarker(document: TextDocument, range?: Range): string {
	if (!range) return document.getText()

	const fullText = document.getText()
	const cursorOffset = document.offsetAt(range.start)
	const beforeCursor = fullText.substring(0, cursorOffset)
	const afterCursor = fullText.substring(cursorOffset)

	return `${beforeCursor}${CURSOR_MARKER}${afterCursor}`
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
	if (!diagnostics || diagnostics.length === 0) return ""

	let result = "## Active Issues\n"

	const sorted = [...diagnostics].sort((a, b) => a.severity - b.severity)

	sorted.forEach((d) => {
		const severity = DiagnosticSeverityNames[d.severity] || "Unknown"
		const line = d.range.start.line + 1
		result += `- **${severity}** at line ${line}: ${d.message}\n`
	})

	return result
}

export function formatDocumentWithCursor(document: TextDocument, range?: Range, languageId?: string): string {
	const lang = languageId || document.languageId
	const codeWithCursor = addCursorMarker(document, range)

	return `\`\`\`${lang}
${codeWithCursor}
\`\`\``
}
