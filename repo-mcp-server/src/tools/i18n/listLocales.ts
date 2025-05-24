import { Context, McpToolCallResponse, ToolHandler } from "../types.js"
import { getI18nLocales, getI18nNamespaces } from "../../utils/locale-utils.js"

/**
 * List locales tool handler
 */
class ListLocalesTool implements ToolHandler {
	name = "list_locales"
	description = "List all available locales"
	inputSchema = {
		type: "object",
		properties: {
			target: {
				type: "string",
				enum: ["core", "webview"],
				description: "Target directory (core or webview)",
			},
		},
		required: ["target"],
	}

	async execute(args: any, context: Context): Promise<McpToolCallResponse> {
		console.error("🔍 DEBUG: List locales request received with args:", JSON.stringify(args, null, 2))

		const { target } = args

		try {
			// Get all locales
			const locales = await getI18nLocales(target, context.LOCALE_PATHS)
			console.error(`📋 Found ${locales.length} locales`)

			// Get namespaces (files) for English locale to show available files
			const englishLocale = locales.find((locale) => locale.toLowerCase().startsWith("en"))
			let namespaces: string[] = []

			if (englishLocale) {
				namespaces = await getI18nNamespaces(target, englishLocale, context.LOCALE_PATHS)
			}

			// Format the output
			const localesList = locales.map((locale) => `- ${locale}`).join("\n")
			const namespacesList =
				namespaces.length > 0
					? `\n\nAvailable files in English locale:\n${namespaces.map((ns) => `- ${ns}`).join("\n")}`
					: ""

			return {
				content: [
					{
						type: "text",
						text: `Available locales for ${target}:\n${localesList}${namespacesList}`,
					},
				],
			}
		} catch (error) {
			console.error("❌ ERROR in handleListLocales:", error)
			return {
				content: [
					{
						type: "text",
						text: `Error listing locales: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
				isError: true,
			}
		}
	}
}

export default new ListLocalesTool()
