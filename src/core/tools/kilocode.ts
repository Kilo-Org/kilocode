import { ApiHandler } from "../../api"

export async function summarizeSuccessfulMcpOutputWhenTooLong(api: ApiHandler, outputText: string) {
	const tokenLimit = 0.8 * api.getModel().info.contextWindow
	const tokenEstimate = await api.countTokens([{ type: "text", text: outputText }])
	if (tokenEstimate < tokenLimit) {
		return outputText
	}
	return (
		`The MCP tool executed successfully, but the output is unavailable, ` +
		`because it is too long (${outputText.length} characters). ` +
		`If you need the output, find an alternative way to get it in manageable chunks.`
	)
}
