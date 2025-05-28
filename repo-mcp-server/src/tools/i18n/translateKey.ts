import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import pLimit from "p-limit"
import commentJson from "comment-json"

import { Context, McpToolCallResponse, ToolHandler } from "../types.js"
import { getI18nLocales, getI18nNamespaces, getLocaleForTranslation } from "../../utils/locale-utils.js"
import { translateI18nText } from "./translation.js"
import { getI18nNestedKey, setI18nNestedKey, detectIndentation } from "../../utils/json-utils.js"
import { reorderJsonToMatchSource } from "../../utils/order-utils.js"

/**
 * Represents a file write operation for translation
 */
interface FileWriteOperation {
	targetFilePath: string
	targetJson: Record<string, any>
	locale: string
	jsonFile: string
	sourceIndentation?: IndentationSettings
}

/**
 * Represents indentation settings for JSON files
 */
interface IndentationSettings {
	char: string
	size: number
}

/**
 * Expands parent keys into their leaf string keys
 */
async function expandParentKeys(
	paths: string[],
	target: "core" | "webview",
	localePaths: { core: string; webview: string },
	englishLocale: string,
): Promise<string[]> {
	const expandedPaths: string[] = []

	for (const keyPath of paths) {
		if (!keyPath) continue

		if (keyPath.includes(":")) {
			const parts = keyPath.split(":")
			if (parts.length !== 2) continue

			const [fileName, parentKey] = parts
			if (!fileName || !parentKey) continue

			const jsonFile = `${fileName}.json`
			const englishFilePath = path.join(localePaths[target], englishLocale, jsonFile)

			if (!existsSync(englishFilePath)) continue

			const englishContent = await fs.readFile(englishFilePath, "utf-8")
			const englishJson = commentJson.parse(englishContent, null, true) // preserve comments and formatting
			const parentValue = getI18nNestedKey(englishJson, parentKey)

			if (parentValue === undefined) continue

			if (typeof parentValue === "string") {
				expandedPaths.push(`${fileName}.${parentKey}`)
			} else if (typeof parentValue === "object" && parentValue !== null) {
				const leafKeys = collectLeafStringKeys(parentValue, parentKey)
				for (const leafKey of leafKeys) {
					expandedPaths.push(`${fileName}.${leafKey}`)
				}
			}
		}
	}

	return expandedPaths
}

/**
 * Collects all leaf string keys from an object
 */
function collectLeafStringKeys(obj: any, prefix: string = ""): string[] {
	const keys: string[] = []

	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			const value = obj[key]
			const currentPath = prefix ? `${prefix}.${key}` : key

			if (typeof value === "string") {
				keys.push(currentPath)
			} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				const nestedKeys = collectLeafStringKeys(value, currentPath)
				keys.push(...nestedKeys)
			}
		}
	}

	return keys
}

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

	/**
	 * Processes input paths and applies current file context if needed
	 */
	private processInputPaths(paths: string[], useCurrentFile: boolean): string[] {
		if (!useCurrentFile || !process.env.VSCODE_OPEN_FILES) {
			return [...paths]
		}

		const openFiles = JSON.parse(process.env.VSCODE_OPEN_FILES)
		const i18nFiles = openFiles.filter((file: string) => file.includes("/i18n/locales/") && file.endsWith(".json"))

		if (i18nFiles.length === 0) {
			return [...paths]
		}

		const fileName = path.basename(i18nFiles[0], ".json")
		return paths.map((p: string) => {
			if (!p.includes(".") && !p.includes(":")) {
				return `${fileName}.${p}`
			}
			return p
		})
	}

	/**
	 * Creates translation tasks for all keys and locales
	 */
	private async createTranslationTasks(
		keysByFile: Record<string, string[]>,
		englishLocale: string,
		localesToTranslate: string[],
		target: "core" | "webview",
		context: Context,
		model: string,
		chunkSize: number,
	): Promise<{
		tasks: Promise<void>[]
		fileOps: FileWriteOperation[]
		results: string[]
		totalCount: number
		successCountRef: { value: number }
	}> {
		const allResults: string[] = []
		const fileWriteOperations: FileWriteOperation[] = []
		const translationTasks: Promise<void>[] = []
		const successCountRef = { value: 0 }
		const completedCountRef = { value: 0 }
		const limit = pLimit(chunkSize)

		// Calculate total keys to translate
		const totalKeysCount =
			Object.entries(keysByFile).reduce((acc, [_, keys]) => acc + keys.length, 0) * localesToTranslate.length

		for (const [jsonFile, keysInFile] of Object.entries(keysByFile)) {
			const englishFilePath = path.join(
				context.LOCALE_PATHS[target as keyof typeof context.LOCALE_PATHS],
				englishLocale,
				jsonFile,
			)

			if (!existsSync(englishFilePath)) {
				await this.handleMissingFile(englishFilePath, target, englishLocale, context, allResults)
				continue
			}

			const { englishJson, validKeys, invalidResults } = await this.validateKeys(
				englishFilePath,
				keysInFile,
				jsonFile,
			)

			allResults.push(...invalidResults)

			if (validKeys.length === 0) continue

			await this.processLocalesForFile(
				validKeys,
				englishJson,
				englishLocale,
				localesToTranslate,
				jsonFile,
				target,
				context,
				model,
				limit,
				fileWriteOperations,
				translationTasks,
				allResults,
				totalKeysCount,
				successCountRef,
				completedCountRef,
			)
		}

		return {
			tasks: translationTasks,
			fileOps: fileWriteOperations,
			results: allResults,
			totalCount: totalKeysCount,
			successCountRef,
		}
	}

	/**
	 * Handles a missing file by suggesting alternatives
	 */
	private async handleMissingFile(
		filePath: string,
		target: "core" | "webview",
		englishLocale: string,
		context: Context,
		results: string[],
	): Promise<void> {
		try {
			const availableFiles = await getI18nNamespaces(target, englishLocale, context.LOCALE_PATHS)
			const suggestion = availableFiles.length > 0 ? `\nAvailable files: ${availableFiles.join(", ")}` : ""
			results.push(`❌ File not found: ${filePath}${suggestion}`)
		} catch {
			results.push(`❌ File not found: ${filePath}`)
		}
	}

	/**
	 * Validates keys against the English source file
	 */
	private async validateKeys(
		englishFilePath: string,
		keysInFile: string[],
		jsonFile: string,
	): Promise<{
		englishJson: Record<string, any>
		validKeys: string[]
		invalidResults: string[]
	}> {
		const englishContent = await fs.readFile(englishFilePath, "utf-8")
		const englishJson = commentJson.parse(englishContent, null, true) // preserve comments and formatting
		const validKeys: string[] = []
		const invalidResults: string[] = []

		for (const keyInFile of keysInFile) {
			const valueToTranslate = getI18nNestedKey(englishJson, keyInFile)

			if (valueToTranslate === undefined) {
				invalidResults.push(`❌ Key "${keyInFile}" not found in ${jsonFile}`)
				continue
			}

			if (typeof valueToTranslate !== "string") {
				invalidResults.push(`❌ Value at key "${keyInFile}" in ${jsonFile} is not a string`)
				continue
			}

			validKeys.push(keyInFile)
		}

		return { englishJson, validKeys, invalidResults }
	}

	/**
	 * Processes all locales for a specific file
	 */
	private async processLocalesForFile(
		validKeys: string[],
		englishJson: Record<string, any>,
		englishLocale: string,
		localesToTranslate: string[],
		jsonFile: string,
		target: "core" | "webview",
		context: Context,
		model: string,
		limit: any,
		fileWriteOperations: FileWriteOperation[],
		translationTasks: Promise<void>[],
		allResults: string[],
		totalKeysCount: number,
		successCountRef: { value: number },
		completedCountRef: { value: number },
	): Promise<void> {
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
			let sourceIndentation: IndentationSettings | undefined = undefined

			// First, try to get indentation from the English file
			const englishFilePath = path.join(
				context.LOCALE_PATHS[target as keyof typeof context.LOCALE_PATHS],
				englishLocale,
				jsonFile,
			)

			if (existsSync(englishFilePath)) {
				try {
					const englishContent = await fs.readFile(englishFilePath, "utf-8")
					sourceIndentation = detectIndentation(englishContent)
					console.error(
						`📏 Detected indentation from English file for ${jsonFile}: char='${sourceIndentation.char === "\t" ? "\\t" : " "}', size=${sourceIndentation.size}`,
					)
				} catch (error) {
					console.error(`⚠️ Error reading English file for indentation detection: ${error}`)
				}
			}

			// Then, read the target file if it exists
			if (existsSync(targetFilePath)) {
				const targetContent = await fs.readFile(targetFilePath, "utf-8")
				targetJson = commentJson.parse(targetContent, null, true) // preserve comments and formatting
			}

			// Store the file operation for later
			const fileOp: FileWriteOperation = {
				targetFilePath,
				targetJson,
				locale,
				jsonFile,
				sourceIndentation,
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
							getLocaleForTranslation(locale),
							context.OPENROUTER_API_KEY,
							model,
						)

						// Set the translated value in the target JSON
						setI18nNestedKey(fileOp.targetJson, keyInFile, translatedValue)

						allResults.push(`✅ Translated key "${keyInFile}" in ${locale}`)
						successCountRef.value++

						// Update progress
						completedCountRef.value++
						const progress = Math.round((completedCountRef.value / totalKeysCount) * 100)
						console.error(
							`⏳ Progress: ${completedCountRef.value}/${totalKeysCount} (${progress}%) - Completed: ${taskId}`,
						)
					} catch (error) {
						allResults.push(
							`❌ Failed to translate key "${keyInFile}" in ${locale}: ${error instanceof Error ? error.message : String(error)}`,
						)

						// Update progress even for failures
						completedCountRef.value++
						const progress = Math.round((completedCountRef.value / totalKeysCount) * 100)
						console.error(
							`⏳ Progress: ${completedCountRef.value}/${totalKeysCount} (${progress}%) - Failed: ${taskId}`,
						)
					}
				})

				translationTasks.push(task)
			}
		}
	}

	/**
	 * Writes all translated files with proper indentation
	 */
	private async writeTranslatedFiles(
		fileWriteOperations: FileWriteOperation[],
		englishLocale: string,
		target: "core" | "webview",
		context: Context,
	): Promise<void> {
		// Default indentation for new files
		const defaultIndent: IndentationSettings = { char: " ", size: 2 }

		// Write all files after translations are complete
		console.error(`💾 Writing translated files...`)

		for (const fileOp of fileWriteOperations) {
			await this.writeTranslatedFile(fileOp, defaultIndent, englishLocale, target, context)
		}
	}

	/**
	 * Detects indentation from English files
	 */
	private async detectEnglishIndentation(
		fileWriteOperations: FileWriteOperation[],
		target: "core" | "webview",
		localePaths: { core: string; webview: string },
		englishLocale: string,
	): Promise<IndentationSettings> {
		// Default fallback
		const defaultIndent: IndentationSettings = { char: " ", size: 2 }

		// Try to get indentation from English files
		for (const jsonFile of [...new Set(fileWriteOperations.map((op) => op.jsonFile))]) {
			const englishFilePath = path.join(localePaths[target], englishLocale, jsonFile)

			if (existsSync(englishFilePath)) {
				try {
					const englishContent = await fs.readFile(englishFilePath, "utf-8")
					const detected = detectIndentation(englishContent)
					console.error(
						`📏 Detected indentation for ${jsonFile}: char='${detected.char === "\t" ? "\\t" : " "}', size=${detected.size}`,
					)
					return {
						char: detected.char,
						size: detected.size,
					}
				} catch (error) {
					console.error(`⚠️ Error reading English file for indentation detection: ${error}`)
				}
			}
		}

		return defaultIndent
	}

	/**
	 * Writes a single translated file
	 */
	private async writeTranslatedFile(
		fileOp: FileWriteOperation,
		defaultIndent: IndentationSettings,
		englishLocale: string,
		target: "core" | "webview",
		context: Context,
	): Promise<void> {
		const { targetFilePath, targetJson, locale, jsonFile, sourceIndentation } = fileOp

		// For existing files, detect and use their own indentation
		// For new files, use the source indentation if available, otherwise use the default
		let indentSettings = defaultIndent

		if (existsSync(targetFilePath)) {
			try {
				const existingContent = await fs.readFile(targetFilePath, "utf-8")
				const indentation = detectIndentation(existingContent)
				// Only use the file's own indentation if we could detect it
				if (indentation.size > 0) {
					indentSettings = {
						char: indentation.char,
						size: indentation.size,
					}
					console.error(
						`📏 Using existing indentation for ${locale}/${jsonFile}: char='${indentation.char === "\t" ? "\\t" : " "}', size=${indentation.size}`,
					)
				}
			} catch (error) {
				console.error(`⚠️ Error reading existing file for indentation detection: ${error}`)
			}
		} else if (sourceIndentation) {
			// For new files, use the source indentation if available
			indentSettings = sourceIndentation
			console.error(
				`📏 Using source indentation for new file ${locale}/${jsonFile}: char='${sourceIndentation.char === "\t" ? "\\t" : " "}', size=${sourceIndentation.size}`,
			)
		} else {
			console.error(
				`📏 Using default indentation for new file ${locale}/${jsonFile}: char='${defaultIndent.char === "\t" ? "\\t" : " "}', size=${defaultIndent.size}`,
			)
		}

		// Create the indent string based on the detected settings
		const indent = indentSettings.char.repeat(indentSettings.size)

		// For non-English locales, reorder the keys to match the English structure
		if (locale !== englishLocale) {
			await this.writeWithEnglishOrdering(
				targetFilePath,
				targetJson,
				locale,
				jsonFile,
				indent,
				target,
				context,
				englishLocale,
			)
		} else {
			// Use detected indentation but preserve formatting
			const jsonString = commentJson.stringify(targetJson, null, indent)
			await fs.writeFile(targetFilePath, jsonString, "utf-8")
			console.error(`💾 Saved translations to ${locale}/${jsonFile}`)
		}
	}

	/**
	 * Writes a file with keys ordered to match English structure
	 */
	private async writeWithEnglishOrdering(
		targetFilePath: string,
		targetJson: Record<string, any>,
		locale: string,
		jsonFile: string,
		indent: string,
		target: "core" | "webview",
		context: Context,
		englishLocale: string,
	): Promise<void> {
		// Get the corresponding English file to use as ordering reference
		const englishFilePath = path.join(
			context.LOCALE_PATHS[target as keyof typeof context.LOCALE_PATHS],
			englishLocale,
			jsonFile,
		)

		if (existsSync(englishFilePath)) {
			try {
				const englishContent = await fs.readFile(englishFilePath, "utf-8")
				const englishJson = commentJson.parse(englishContent, null, true) // preserve comments and formatting
				console.error(`📏 Reading English file for ordering reference: ${englishLocale}/${jsonFile}`)

				// Reorder the JSON object to match the English structure
				const orderedJson = reorderJsonToMatchSource(targetJson, englishJson)

				// Use detected indentation but preserve formatting
				const jsonString = commentJson.stringify(orderedJson, null, indent)
				await fs.writeFile(targetFilePath, jsonString, "utf-8")
				console.error(`💾 Saved and reordered translations to ${locale}/${jsonFile}`)
			} catch (error) {
				console.error(`⚠️ Error reordering JSON: ${error}`)

				// Use detected indentation but preserve formatting
				const jsonString = commentJson.stringify(targetJson, null, indent)
				await fs.writeFile(targetFilePath, jsonString, "utf-8")
				console.error(`💾 Saved translations to ${locale}/${jsonFile} without reordering`)
			}
		} else {
			// Use detected indentation but preserve formatting
			const jsonString = commentJson.stringify(targetJson, null, indent)
			await fs.writeFile(targetFilePath, jsonString, "utf-8")
			console.error(`💾 Saved translations to ${locale}/${jsonFile}`)
		}
	}

	/**
	 * Parses key paths and groups them by file
	 */
	private parseKeyPaths(keyPaths: string[]): {
		keysByFile: Record<string, string[]>
		invalidResults: string[]
	} {
		const keysByFile: Record<string, string[]> = {}
		const invalidResults: string[] = []

		for (const keyPath of keyPaths) {
			if (!keyPath || typeof keyPath !== "string") {
				invalidResults.push(`❌ Invalid key path: ${keyPath}`)
				continue
			}

			const parts = keyPath.split(".")
			if (parts.length < 2) {
				invalidResults.push(`❌ Invalid key format: ${keyPath}`)
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

		return { keysByFile, invalidResults }
	}

	async execute(args: any, context: Context): Promise<McpToolCallResponse> {
		const {
			target,
			paths,
			useCurrentFile = false,
			model = context.DEFAULT_MODEL,
			targetLocales = [],
			chunkSize = 5,
		} = args

		if (!Array.isArray(paths) || paths.length === 0) {
			return {
				content: [
					{
						type: "text",
						text: "Error: No translation keys provided. Please specify 'paths' as an array of strings in the format 'filename:keyPath'.",
					},
				],
				isError: true,
			}
		}

		try {
			// Get available locales
			const locales = await getI18nLocales(target, context.LOCALE_PATHS)
			const englishLocale = locales.find((locale) => locale.toLowerCase().startsWith("en"))

			if (!englishLocale) {
				return {
					content: [{ type: "text", text: "Error: English locale not found" }],
					isError: true,
				}
			}

			// Process input paths
			const processedPaths = this.processInputPaths(paths, useCurrentFile)

			// Expand parent keys to leaf keys
			const keyPaths = await expandParentKeys(processedPaths, target, context.LOCALE_PATHS, englishLocale)

			// Determine which locales to translate to
			const localesToTranslate =
				targetLocales.length > 0
					? locales.filter((locale) => targetLocales.includes(locale) && locale !== englishLocale)
					: locales.filter((locale) => locale !== englishLocale)

			if (localesToTranslate.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No target locales to translate to" }],
					isError: true,
				}
			}

			// Parse and group key paths by file
			const { keysByFile, invalidResults } = this.parseKeyPaths(keyPaths)

			// Create translation tasks
			const {
				tasks: translationTasks,
				fileOps: fileWriteOperations,
				results: taskResults,
				totalCount: totalKeysCount,
				successCountRef,
			} = await this.createTranslationTasks(
				keysByFile,
				englishLocale,
				localesToTranslate,
				target,
				context,
				model,
				chunkSize,
			)

			// Combine all results
			const allResults = [...invalidResults, ...taskResults]

			// Wait for all translation tasks to complete
			console.error(`🚀 Starting ${translationTasks.length} parallel translation tasks...`)
			await Promise.all(translationTasks)
			console.error(`✅ All translation tasks completed`)

			// Write all translated files
			await this.writeTranslatedFiles(fileWriteOperations, englishLocale, target, context)

			// Calculate success rate
			const successRate = totalKeysCount > 0 ? Math.round((successCountRef.value / totalKeysCount) * 100) : 0

			return {
				content: [
					{
						type: "text",
						text: `Translation results:\n\n${allResults.join("\n")}\n\nSuccessfully translated ${successCountRef.value} of ${totalKeysCount} keys (${successRate}%).\n\nThe translations have been updated.`,
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
