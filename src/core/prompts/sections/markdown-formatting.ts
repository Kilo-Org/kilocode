import { ToolUseStyle } from "../../../../packages/types/src/kilocode/native-function-calling"

export function markdownFormattingSection(
	toolUseStyle: ToolUseStyle, // kilocode_change
): string {
	return `====

MARKDOWN RULES

ALL responses MUST show ANY \`language construct\` OR filename reference as clickable, exactly as [\`filename OR language.declaration()\`](relative/file/path.ext:line); line is required for \`syntax\` and optional for filename links. This applies to ALL markdown responses and ALSO those in ${toolUseStyle === "json" ? "attempt_completion" : "<attempt_completion>" /*kilocode_change*/}`
}
