import Anthropic from "@anthropic-ai/sdk"

export function mergeEnvironmentDetailsIntoUserContent(
	userContent: Anthropic.ContentBlockParam[],
	environmentDetails: string,
) {
	const result = [...userContent]
	const lastIndex = result.length - 1
	const lastItem = result[lastIndex]
	const environmentDetailsBlock = { type: "text" as const, text: environmentDetails }
	if (lastItem && lastItem.type === "tool_result") {
		if (Array.isArray(lastItem.content)) {
			result[lastIndex] = {
				...lastItem,
				content: [...lastItem.content, environmentDetailsBlock],
			}
		} else if (lastItem.content) {
			result[lastIndex] = {
				...lastItem,
				content: [{ type: "text", text: lastItem.content }, environmentDetailsBlock],
			}
		} else {
			result[lastIndex] = { ...lastItem, content: environmentDetails }
		}
	} else {
		result.push(environmentDetailsBlock)
	}
	return result
}
