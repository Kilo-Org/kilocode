import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import pLimit from "p-limit"

import { Context, McpToolCallResponse, ToolHandler } from "../types.js"
import { getI18nLocales, getI18nNamespaces, getLanguageFromLocale } from "../../utils/locale-utils.js"
import { translateI18nText } from "./translation.js"
import { getI18nNestedKey, setI18nNestedKey } from "../../utils/json-utils.js"
import { reorderJsonToMatchSource } from "../../utils/order-utils.js"

/**
 * Expand keys using the colon format
 * For example, "kilocode:veryCool" will expand to ["kilocode.veryCool.one", "kilocode.veryCool.many"]
 * The colon format is required to clearly separate the filename from the key path
 */
async function expandParentKeys(
	paths: string[],
	target: "core" | "webview",
	localePaths: { core: string; webview: string },
): Promise<string[]> {
	// Get all locales to find English
	const locales = await getI18nLocales(target, localePaths)
	const englishLocale = locales.find((locale) => locale.toLowerCase().startsWith("en"))

	if (!englishLocale) {
		throw new Error("English locale not found")
	}

	const expandedPaths: string[] = []

	for (const keyPath of paths) {
		// Skip undefined or null paths
		if (!keyPath) {
			console.error("Skipping undefined or null path")
			continue
		}

		// All keys must use the colon format (filename:keyPath)
		if (keyPath.includes(":")) {
			const parts = keyPath.split(":")

			// Ensure we have exactly two parts (fileName:parentKey)
			if (parts.length !== 2) {
				console.error(`Invalid parent key format: ${keyPath} (should be in format 'file:key')`)
				continue
			}

			const [fileName, parentKey] = parts

			// Ensure both parts are non-empty
			if (!fileName || !parentKey) {
				console.error(`Invalid parent key format: ${keyPath} (file or key is empty)`)
				continue
			}

			const jsonFile = `${fileName}.json`
			const englishFilePath = path.join(localePaths[target], englishLocale, jsonFile)

			// Log the paths being checked
			console.error(`🔍 DEBUG: Checking for English file at: ${englishFilePath}`)
			console.error(`🔍 DEBUG: localePaths for ${target}: ${localePaths[target]}`)

			// Check if the file exists
			if (!existsSync(englishFilePath)) {
				console.error(`File not found: ${englishFilePath}`)
				continue
			}

			// Read the English file
			const englishContent = await fs.readFile(englishFilePath, "utf-8")
			const englishJson = JSON.parse(englishContent)

			// Log the file content structure
			console.error(`🔍 DEBUG: Found English file with keys: ${Object.keys(englishJson).join(", ")}`)

			// Get the parent object or string
			const parentValue = getI18nNestedKey(englishJson, parentKey)

			if (parentValue === undefined) {
				console.error(`Parent key "${parentKey}" in ${jsonFile} doesn't exist`)
				continue
			}

			// Handle both object and string cases
			if (typeof parentValue === "string") {
				// If it's a string, just add the key directly
				expandedPaths.push(`${fileName}.${parentKey}`)
			} else if (typeof parentValue === "object" && parentValue !== null) {
				// If it's an object, recursively collect all leaf string keys
				const leafKeys = collectLeafStringKeys(parentValue, parentKey)

				// Add all leaf keys with the file prefix
				for (const leafKey of leafKeys) {
					expandedPaths.push(`${fileName}.${leafKey}`)
				}
			} else {
				console.error(`Parent key "${parentKey}" in ${jsonFile} is not a string or object`)
				continue
			}
		} else {
			// Reject keys that don't use the colon format
			console.error(
				`❌ Invalid key format: ${keyPath} (must use colon format 'filename:keyPath', e.g., 'kilocode:lowCreditWarning.nice')`,
			)
		}
	}

	return expandedPaths
}

/**
 * Recursively collect all leaf string keys from an object
 * Returns keys in dot notation
 */
function collectLeafStringKeys(obj: any, prefix: string = ""): string[] {
	const keys: string[] = []

	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			const value = obj[key]
			const currentPath = prefix ? `${prefix}.${key}` : key

			if (typeof value === "string") {
				// This is a leaf string node
				keys.push(currentPath)
			} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				// This is an object, recursively collect its keys
				const nestedKeys = collectLeafStringKeys(value, currentPath)
				keys.push(...nestedKeys)
			}
		}
	}

	return keys
}

/**
 * Translate i18n key tool handler
 */
class TranslateKeyTool implements ToolHandler {
	name = "translate_i18n_key"
	description = "Translate a specific key or keys from English to other languages"
	inputSchema = {
		type: "object",
		properties: {
			target: {
				type: "string",
				enum: ["core", "webview"],
				description: "Target directory (core or webview)",
			},
			paths: {
				type: "array",
				items: {
					type: "string",
				},
				description:
					'Array of paths to translate in English locale. Format: "filename:keyPath" (e.g., "kilocode:lowCreditWarning.nice") where the colon separates the filename from the key path. For parent keys (e.g., "kilocode:veryCool"), all child keys will be translated.',
			},
			useCurrentFile: {
				type: "boolean",
				description: "Use the currently open file as context for translation (optional)",
			},
			model: {
				type: "string",
				description: "Model to use for translation (optional)",
			},
			targetLocales: {
				type: "array",
				items: {
					type: "string",
				},
				description: "List of locale codes to translate to (empty for all)",
			},
		},
		required: ["target", "paths"],
	}

	async execute(args: any, context: Context): Promise<McpToolCallResponse> {
		console.error("🔍 DEBUG: Translation request received with args:", JSON.stringify(args, null, 2))
		console.error("🔍 DEBUG: Context paths:", JSON.stringify(context.LOCALE_PATHS, null, 2))

		const {
			target,
			paths,
			useCurrentFile = false,
			model = context.DEFAULT_MODEL,
			targetLocales = [],
			chunkSize = 5,
		} = args

		if (!Array.isArray(paths) || paths.length === 0) {
			console.error("❌ ERROR: No translation keys provided in paths array")
			return {
				content: [
					{
						type: "text",
						text: "Error: No translation keys provided. Please specify 'paths' as an array of strings in the format 'filename:keyPath' (e.g., 'kilocode:lowCreditWarning.nice').",
					},
				],
				isError: true,
			}
		}

		try {
			// Get all locales to translate to
			const locales = await getI18nLocales(target, context.LOCALE_PATHS)
			console.error(`📋 Found ${locales.length} locales in total`)

			// Find the English locale
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

			// Process paths to handle different formats and auto-detection
			let processedPaths = [...paths]

			// Handle context-awareness if useCurrentFile is true
			if (useCurrentFile && process.env.VSCODE_OPEN_FILES) {
				try {
					const openFiles = JSON.parse(process.env.VSCODE_OPEN_FILES)
					const i18nFiles = openFiles.filter(
						(file: string) => file.includes("/i18n/locales/") && file.endsWith(".json"),
					)

					if (i18nFiles.length > 0) {
						// Extract filename from the first i18n file
						const currentFile = i18nFiles[0]
						const fileName = path.basename(currentFile, ".json")

						// Add filename prefix to any paths that don't have it
						processedPaths = processedPaths.map((p: string) => {
							if (!p.includes(".") && !p.includes(":")) {
								return `${fileName}.${p}`
							}
							return p
						})

						console.error(`🔍 Using context from open file: ${fileName}.json`)
					}
				} catch (error) {
					console.error(`⚠️ Error processing open files context: ${error}`)
				}
			}

			// Process paths to expand parent keys and handle auto-detection
			console.error(`🔍 DEBUG: Expanding paths: ${processedPaths.join(", ")}`)
			const keyPaths = await expandParentKeys(processedPaths, target, context.LOCALE_PATHS)

			console.error(`🔍 Starting translation for ${keyPaths.length} key(s): ${keyPaths.join(", ")}`)
			console.error(`🌐 Using model: ${model}`)
			console.error(`⚡ Parallelization: Processing up to ${chunkSize} translations concurrently`)

			// Filter locales if targetLocales is specified
			const localesToTranslate =
				targetLocales.length > 0
					? locales.filter((locale) => targetLocales.includes(locale) && locale !== englishLocale)
					: locales.filter((locale) => locale !== englishLocale)

			if (localesToTranslate.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "Error: No target locales to translate to",
						},
					],
					isError: true,
				}
			}

			// Initialize results array
			const allResults: string[] = []
			let totalSuccessCount = 0
			let completedCount = 0

			// Create a concurrency limiter
			const limit = pLimit(chunkSize)

			// Group keys by file to optimize file operations
			const keysByFile: Record<string, string[]> = {}

			// Validate all keys and group them by file
			for (const keyPath of keyPaths) {
				if (!keyPath || typeof keyPath !== "string") {
					allResults.push(`❌ Invalid key path: ${keyPath}`)
					continue
				}

				// Keys must be in the format filename.key1.key2...
				// This is the internal format after expansion from filename:key1.key2...
				const parts = keyPath.split(".")
				if (parts.length < 2) {
					allResults.push(
						`❌ Invalid key format: ${keyPath} (should be in internal format 'filename.keyPath' after expansion)`,
					)
					continue
				}

				const fileName = parts[0]
				const keyParts = parts.slice(1)
				const jsonFile = `${fileName}.json`
				const keyInFile = keyParts.join(".")

				if (!keysByFile[jsonFile]) {
					keysByFile[jsonFile] = []
				}

				keysByFile[jsonFile].push(keyInFile)
			}

			// Calculate total keys to translate
			const totalKeysCount =
				Object.entries(keysByFile).reduce((acc, [_, keys]) => acc + keys.length, 0) * localesToTranslate.length
			console.error(`🔢 Total translation tasks: ${totalKeysCount}`)

			// Store all file write operations to perform at the end
			type FileWriteOperation = {
				targetFilePath: string
				targetJson: Record<string, any>
				locale: string
				jsonFile: string
			}
			const fileWriteOperations: FileWriteOperation[] = []

			// Create translation tasks for all files and locales
			const translationTasks: Promise<void>[] = []

			// Process each file
			for (const [jsonFile, keysInFile] of Object.entries(keysByFile)) {
				// Read the English source file
				const englishFilePath = path.join(
					context.LOCALE_PATHS[target as keyof typeof context.LOCALE_PATHS],
					englishLocale,
					jsonFile,
				)

				// Log the file path details
				console.error(`🔍 DEBUG: Looking for file: ${englishFilePath}`)
				console.error(
					`🔍 DEBUG: Base locale path: ${context.LOCALE_PATHS[target as keyof typeof context.LOCALE_PATHS]}`,
				)

				if (!existsSync(englishFilePath)) {
					// Try to suggest available files
					try {
						const availableFiles = await getI18nNamespaces(target, englishLocale, context.LOCALE_PATHS)
						const suggestion =
							availableFiles.length > 0 ? `\nAvailable files: ${availableFiles.join(", ")}` : ""
						allResults.push(`❌ File not found: ${englishFilePath}${suggestion}`)
					} catch (error) {
						allResults.push(`❌ File not found: ${englishFilePath}`)
					}
					continue
				}

				const englishContent = await fs.readFile(englishFilePath, "utf-8")
				const englishJson = JSON.parse(englishContent)

				// Validate all keys in this file
				const validKeys: string[] = []
				const invalidKeys: string[] = []

				for (const keyInFile of keysInFile) {
					const valueToTranslate = getI18nNestedKey(englishJson, keyInFile)
					console.error(`🔍 DEBUG: Key "${keyInFile}" in ${jsonFile} => Value: "${valueToTranslate}"`)

					if (valueToTranslate === undefined) {
						// Simply report the key was not found without suggestions
						allResults.push(`❌ Key "${keyInFile}" not found in ${jsonFile}`)
						invalidKeys.push(keyInFile)
						continue
					}

					if (typeof valueToTranslate !== "string") {
						allResults.push(`❌ Value at key "${keyInFile}" in ${jsonFile} is not a string`)
						invalidKeys.push(keyInFile)
						continue
					}

					validKeys.push(keyInFile)
				}

				if (validKeys.length === 0) {
					continue // Skip this file if no valid keys
				}

				console.error(`🌍 Preparing translations for ${localesToTranslate.length} locales for file ${jsonFile}`)

				// Process each locale
				for (const locale of localesToTranslate) {
					// Skip English locale
					if (locale === englishLocale) continue

					const targetFilePath = path.join(
						context.LOCALE_PATHS[target as keyof typeof context.LOCALE_PATHS],
						locale,
						jsonFile,
					)

					// Create directory if it doesn't exist
					const targetDir = path.dirname(targetFilePath)
					if (!existsSync(targetDir)) {
						await fs.mkdir(targetDir, { recursive: true })
					}

					// Read or create target file
					let targetJson = {}
					if (existsSync(targetFilePath)) {
						const targetContent = await fs.readFile(targetFilePath, "utf-8")
						targetJson = JSON.parse(targetContent)
					}

					// Store the file operation for later
					const fileOp: FileWriteOperation = {
						targetFilePath,
						targetJson,
						locale,
						jsonFile,
					}
					fileWriteOperations.push(fileOp)

					// Create translation tasks for each key in this file and locale
					for (const keyInFile of validKeys) {
						const valueToTranslate = getI18nNestedKey(englishJson, keyInFile)

						// Create a task for each translation and add it to the queue
						const task = limit(async () => {
							const taskId = `${locale}:${jsonFile}:${keyInFile}`
							try {
								// Translate the text
								const translatedValue = await translateI18nText(
									valueToTranslate as string,
									getLanguageFromLocale(locale),
									context.OPENROUTER_API_KEY,
									model,
								)

								// Set the translated value in the target JSON
								setI18nNestedKey(fileOp.targetJson, keyInFile, translatedValue)

								allResults.push(`✅ Translated key "${keyInFile}" in ${locale}`)
								totalSuccessCount++

								// Update progress
								completedCount++
								const progress = Math.round((completedCount / totalKeysCount) * 100)
								console.error(
									`⏳ Progress: ${completedCount}/${totalKeysCount} (${progress}%) - Completed: ${taskId}`,
								)
							} catch (error) {
								allResults.push(
									`❌ Failed to translate key "${keyInFile}" in ${locale}: ${error instanceof Error ? error.message : String(error)}`,
								)

								// Update progress even for failures
								completedCount++
								const progress = Math.round((completedCount / totalKeysCount) * 100)
								console.error(
									`⏳ Progress: ${completedCount}/${totalKeysCount} (${progress}%) - Failed: ${taskId}`,
								)
							}
						})

						translationTasks.push(task)
					}
				}
			}

			// Wait for all translation tasks to complete
			console.error(`🚀 Starting ${translationTasks.length} parallel translation tasks...`)
			await Promise.all(translationTasks)
			console.error(`✅ All translation tasks completed`)

			// Write all files after translations are complete
			console.error(`💾 Writing translated files...`)
			for (const { targetFilePath, targetJson, locale, jsonFile } of fileWriteOperations) {
				// For non-English locales, reorder the keys to match the English structure
				if (locale !== englishLocale) {
					// Get the corresponding English file to use as ordering reference
					const englishFilePath = path.join(
						context.LOCALE_PATHS[target as keyof typeof context.LOCALE_PATHS],
						englishLocale,
						jsonFile,
					)

					if (existsSync(englishFilePath)) {
						try {
							const englishContent = await fs.readFile(englishFilePath, "utf-8")
							const englishJson = JSON.parse(englishContent)

							// Reorder the JSON object to match the English structure
							const orderedJson = reorderJsonToMatchSource(targetJson, englishJson)
							await fs.writeFile(targetFilePath, JSON.stringify(orderedJson, null, 2) + "\n", "utf-8")
							console.error(`💾 Saved and reordered translations to ${locale}/${jsonFile}`)
						} catch (error) {
							console.error(`⚠️ Error reordering JSON: ${error}`)
							await fs.writeFile(targetFilePath, JSON.stringify(targetJson, null, 2) + "\n", "utf-8")
							console.error(`💾 Saved translations to ${locale}/${jsonFile} without reordering`)
						}
					} else {
						await fs.writeFile(targetFilePath, JSON.stringify(targetJson, null, 2) + "\n", "utf-8")
						console.error(`💾 Saved translations to ${locale}/${jsonFile}`)
					}
				} else {
					await fs.writeFile(targetFilePath, JSON.stringify(targetJson, null, 2) + "\n", "utf-8")
					console.error(`💾 Saved translations to ${locale}/${jsonFile}`)
				}
			}

			// Calculate success rate
			const successRate = totalKeysCount > 0 ? Math.round((totalSuccessCount / totalKeysCount) * 100) : 0

			return {
				content: [
					{
						type: "text",
						text: `Translation results:\n\n${allResults.join("\n")}\n\nSuccessfully translated ${totalSuccessCount} of ${totalKeysCount} keys (${successRate}%).\n\nThe translations have been updated.`,
					},
				],
			}
		} catch (error) {
			console.error("❌ CRITICAL ERROR in handleTranslateKey:", error)
			console.error("Error details:", error instanceof Error ? error.stack : String(error))

			return {
				content: [
					{
						type: "text",
						text: `Error translating keys: ${error instanceof Error ? error.message : String(error)}\n\nDebug information has been logged to the console. Please check the terminal where the MCP server is running.`,
					},
				],
				isError: true,
			}
		}
	}
}

// Export the tool
const translateKeyTool: ToolHandler = new TranslateKeyTool()
export default translateKeyTool
