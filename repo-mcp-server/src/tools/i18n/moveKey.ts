import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"

import { Context, McpToolCallResponse, ToolHandler } from "../types.js"
import { getI18nLocales } from "../../utils/locale-utils.js"
import {
	getI18nNestedKey,
	setI18nNestedKey,
	deleteI18nNestedKey,
	cleanupEmptyI18nObjects,
	detectIndentation,
} from "../../utils/json-utils.js"
import { reorderJsonToMatchSource } from "../../utils/order-utils.js"

/**
 * Helper function to move a key from one file to another for a specific locale
 */
async function moveKeyForLocale(
	sourceFilePath: string,
	destFilePath: string,
	keyToMove: string,
	newKeyName: string | undefined,
	locale: string,
	isEnglishLocale: boolean,
	englishDestFilePath?: string,
): Promise<string> {
	// Ensure the source file exists
	if (!existsSync(sourceFilePath)) {
		return `❌ Source file not found for locale ${locale}: ${sourceFilePath}`
	}

	// Read source file
	const sourceContent = await fs.readFile(sourceFilePath, "utf-8")
	let sourceJson
	try {
		sourceJson = JSON.parse(sourceContent)
	} catch (error) {
		return `❌ Error parsing source file for locale ${locale}: ${error instanceof Error ? error.message : String(error)}`
	}

	// Get the value to move
	const valueToMove = getI18nNestedKey(sourceJson, keyToMove)
	if (valueToMove === undefined) {
		return `❓ Key "${keyToMove}" not found in source file for locale ${locale}`
	}

	// Create or read destination file
	let destJson = {}
	if (existsSync(destFilePath)) {
		const destContent = await fs.readFile(destFilePath, "utf-8")
		try {
			destJson = JSON.parse(destContent)
		} catch (error) {
			return `❌ Error parsing destination file for locale ${locale}: ${error instanceof Error ? error.message : String(error)}`
		}
	} else {
		// Create directory if it doesn't exist
		const destDir = path.dirname(destFilePath)
		if (!existsSync(destDir)) {
			await fs.mkdir(destDir, { recursive: true })
		}
	}

	// Set the value in the destination file
	const keyToSet = newKeyName || keyToMove
	setI18nNestedKey(destJson, keyToSet, valueToMove)

	// Remove the key from the source file
	deleteI18nNestedKey(sourceJson, keyToMove)

	// Clean up any empty objects left behind
	cleanupEmptyI18nObjects(sourceJson)

	// Detect indentation from source file or use default
	const indent = detectIndentation(sourceContent) || 2

	// Write the updated files
	// Use the size property if indent is an object, or use indent directly if it's a number
	const indentSize = typeof indent === "object" ? indent.size : indent

	// Write source file (always as-is)
	await fs.writeFile(sourceFilePath, JSON.stringify(sourceJson, null, indentSize) + "\n", "utf-8")

	// For non-English locales, reorder keys to match English structure if available
	if (!isEnglishLocale && englishDestFilePath && existsSync(englishDestFilePath)) {
		try {
			const englishContent = await fs.readFile(englishDestFilePath, "utf-8")
			const englishJson = JSON.parse(englishContent)

			// Reorder the destination JSON to match the English structure
			const reorderedDestJson = reorderJsonToMatchSource(englishJson, destJson)

			// Write the reordered destination JSON
			await fs.writeFile(destFilePath, JSON.stringify(reorderedDestJson, null, indentSize) + "\n", "utf-8")
		} catch (error) {
			// If reordering fails, fall back to original order
			console.error(`⚠️ Failed to reorder keys for ${locale}, writing with original order: ${error}`)
			await fs.writeFile(destFilePath, JSON.stringify(destJson, null, indentSize) + "\n", "utf-8")
		}
	} else {
		// English locale or no English reference file available
		await fs.writeFile(destFilePath, JSON.stringify(destJson, null, indentSize) + "\n", "utf-8")
	}

	return `✅ Moved key "${keyToMove}" ${newKeyName ? `to "${newKeyName}"` : ""} for locale ${locale}`
}

/**
 * Move i18n key tool handler
 */
class MoveKeyTool implements ToolHandler {
	name = "move_i18n_key"
	description = "Move a key from one JSON file to another across all locales"
	inputSchema = {
		type: "object",
		properties: {
			target: {
				type: "string",
				enum: ["core", "webview"],
				description: "Target directory (core or webview)",
			},
			key: {
				type: "string",
				description: "Key to move (dot notation)",
			},
			source: {
				type: "string",
				description: 'Source file name (e.g., "common.json")',
			},
			destination: {
				type: "string",
				description: 'Destination file name (e.g., "tools.json")',
			},
			newKey: {
				type: "string",
				description: "Optional new key name for the destination",
			},
		},
		required: ["target", "key", "source", "destination"],
	}

	async execute(args: any, context: Context): Promise<McpToolCallResponse> {
		console.error("🔍 DEBUG: Move key request received with args:", JSON.stringify(args, null, 2))

		const { target, key, source, destination, newKey } = args

		try {
			// Get all locales
			const locales = await getI18nLocales(target, context.LOCALE_PATHS)
			console.error(`📋 Found ${locales.length} locales`)

			// Find the English locale
			const englishLocale = locales.find((locale) => locale.toLowerCase().startsWith("en"))
			if (!englishLocale) {
				throw new Error("English locale not found")
			}

			// Ensure source and destination file names have .json extension
			const sourceFile = source.endsWith(".json") ? source : `${source}.json`
			const destFile = destination.endsWith(".json") ? destination : `${destination}.json`

			// Move the key for each locale
			const results: string[] = []
			for (const locale of locales) {
				const sourceFilePath = path.join(
					context.LOCALE_PATHS[target as keyof typeof context.LOCALE_PATHS],
					locale,
					sourceFile,
				)
				const destFilePath = path.join(
					context.LOCALE_PATHS[target as keyof typeof context.LOCALE_PATHS],
					locale,
					destFile,
				)

				// For non-English locales, provide path to English destination file for key ordering
				const isEnglishLocale = locale === englishLocale
				const englishDestFilePath = isEnglishLocale
					? undefined
					: path.join(
						context.LOCALE_PATHS[target as keyof typeof context.LOCALE_PATHS],
						englishLocale,
						destFile,
					)

				const result = await moveKeyForLocale(
					sourceFilePath,
					destFilePath,
					key,
					newKey,
					locale,
					isEnglishLocale,
					englishDestFilePath,
				)
				results.push(result)
			}

			return {
				content: [
					{
						type: "text",
						text: `Results of moving key "${key}" from "${source}" to "${destination}":\n\n${results.join("\n")}`,
					},
				],
			}
		} catch (error) {
			console.error("❌ ERROR in handleMoveKey:", error)
			return {
				content: [
					{
						type: "text",
						text: `Error moving key: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
				isError: true,
			}
		}
	}
}

export default new MoveKeyTool()
