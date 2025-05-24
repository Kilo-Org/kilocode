import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"

import { Context, McpToolCallResponse, ToolHandler } from "../types.js"
import { getI18nLocales } from "../../utils/locale-utils.js"

/**
 * Remove i18n keys tool handler
 * Removes specified keys from all locale files
 */
class RemoveKeysTool implements ToolHandler {
	name = "remove_i18n_keys"
	description = "Remove specified keys from all locale files across all languages"
	inputSchema = {
		type: "object",
		properties: {
			target: {
				type: "string",
				enum: ["core", "webview"],
				description: "Target directory (core or webview)",
			},
			file: {
				type: "string",
				description: "JSON file name without extension (e.g., 'kilocode')",
			},
			keys: {
				type: "array",
				items: {
					type: "string",
				},
				description:
					"Array of keys to remove (e.g., ['superWackyBananaPhoneTranslation', 'crazyRainbowUnicornDance'])",
			},
		},
		required: ["target", "file", "keys"],
	}

	async execute(args: any, context: Context): Promise<McpToolCallResponse> {
		console.error("🔍 DEBUG: Remove keys request received with args:", JSON.stringify(args, null, 2))

		const { target, file, keys } = args

		if (!Array.isArray(keys) || keys.length === 0) {
			return {
				content: [
					{
						type: "text",
						text: "Error: No keys provided to remove. Please specify 'keys' as an array of strings.",
					},
				],
				isError: true,
			}
		}

		try {
			// Get all locales
			const locales = await getI18nLocales(target, context.LOCALE_PATHS)
			console.error(`📋 Found ${locales.length} locales`)

			// Find the English locale for reference
			const englishLocale = locales.find((locale) => locale.toLowerCase().startsWith("en"))

			if (!englishLocale) {
				return {
					content: [
						{
							type: "text",
							text: "Error: English locale not found",
						},
					],
					isError: true,
				}
			}

			const jsonFile = `${file}.json`
			const results: string[] = []
			let totalRemoved = 0
			let totalFiles = 0

			// Process each locale
			for (const locale of locales) {
				const localeFilePath = path.join(
					context.LOCALE_PATHS[target as keyof typeof context.LOCALE_PATHS],
					locale,
					jsonFile,
				)

				// Skip if file doesn't exist
				if (!existsSync(localeFilePath)) {
					results.push(`⚠️ File not found: ${localeFilePath}`)
					continue
				}

				try {
					// Read the locale file
					const content = await fs.readFile(localeFilePath, "utf-8")
					let json = JSON.parse(content)

					let keysRemovedInThisFile = 0

					// Remove each specified key
					for (const key of keys) {
						if (json.hasOwnProperty(key)) {
							delete json[key]
							keysRemovedInThisFile++
							totalRemoved++
						}
					}

					if (keysRemovedInThisFile > 0) {
						// Write the updated file
						await fs.writeFile(localeFilePath, JSON.stringify(json, null, 2))
						results.push(`✅ Removed ${keysRemovedInThisFile} keys from ${locale}/${jsonFile}`)
						totalFiles++
					} else {
						results.push(`ℹ️ No keys to remove in ${locale}/${jsonFile}`)
					}
				} catch (error) {
					results.push(
						`❌ Error processing ${locale}/${jsonFile}: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}

			// Prepare summary
			const summary = `Successfully removed ${totalRemoved} keys from ${totalFiles} files.`

			return {
				content: [
					{
						type: "text",
						text: `${results.join("\n")}\n\n${summary}`,
					},
				],
			}
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Error: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
				isError: true,
			}
		}
	}
}

export default new RemoveKeysTool()
