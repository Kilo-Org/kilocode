import axios from "axios"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"

import { getI18nLocales, getI18nNamespaces } from "../../utils/locale-utils.js"
import { getI18nNestedKey } from "../../utils/json-utils.js"

/**
 * Find all strings that need translation
 */
export async function findI18nUntranslatedStrings(
	target: "core" | "webview",
	localePaths: { core: string; webview: string },
): Promise<Map<string, Map<string, Map<string, string>>>> {
	// Get all locales
	const locales = await getI18nLocales(target, localePaths)

	// Find the English locale
	const englishLocale = locales.find((locale) => locale.toLowerCase().startsWith("en"))

	if (!englishLocale) {
		throw new Error("English locale not found")
	}

	// Get all JSON files for the English locale
	const jsonFiles = await getI18nNamespaces(target, englishLocale, localePaths)

	// Map to store untranslated strings by locale and file
	// Structure: Map<locale, Map<filePath, Map<key, englishText>>>
	const untranslatedStrings = new Map<string, Map<string, Map<string, string>>>()

	// Initialize the map for each non-English locale
	for (const locale of locales) {
		if (locale !== englishLocale) {
			untranslatedStrings.set(locale, new Map())
		}
	}

	// Process each JSON file
	for (const file of jsonFiles) {
		const englishFilePath = path.join(localePaths[target], englishLocale, file)

		try {
			const englishContent = await fs.readFile(englishFilePath, "utf-8")
			const englishJson = JSON.parse(englishContent)

			// Check each non-English locale for missing translations
			for (const locale of locales) {
				if (locale === englishLocale) continue

				const localeFilePath = path.join(localePaths[target], locale, file)
				const localeFileMap = untranslatedStrings.get(locale) || new Map()

				if (!existsSync(localeFilePath)) {
					// If the file doesn't exist, all keys are untranslated
					const allKeys = findI18nUntranslatedKeys(englishJson, "", englishJson, {})
					const keyMap = new Map<string, string>()

					for (const [key, value] of Object.entries(allKeys)) {
						keyMap.set(key, value as string)
					}

					localeFileMap.set(localeFilePath, keyMap)
					untranslatedStrings.set(locale, localeFileMap)
				} else {
					const localeContent = await fs.readFile(localeFilePath, "utf-8")
					let localeJson = {}

					try {
						localeJson = JSON.parse(localeContent)
					} catch (error) {
						console.error(
							`Error parsing JSON file ${localeFilePath}: ${error instanceof Error ? error.message : String(error)}`,
						)
						continue
					}

					// Find all untranslated strings in this file
					const untranslated = findI18nUntranslatedKeys(englishJson, "", englishJson, localeJson)

					if (Object.keys(untranslated).length > 0) {
						const keyMap = new Map<string, string>()

						for (const [key, value] of Object.entries(untranslated)) {
							keyMap.set(key, value as string)
						}

						localeFileMap.set(localeFilePath, keyMap)
						untranslatedStrings.set(locale, localeFileMap)
					}
				}
			}
		} catch (error) {
			console.error(
				`Error processing file ${englishFilePath}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	return untranslatedStrings
}

/**
 * Recursively find untranslated strings in an i18n object
 */
function findI18nUntranslatedKeys(obj: any, prefix: string, englishObj: any, localeObj: any): Record<string, string> {
	const untranslated: Record<string, string> = {}

	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			const value = obj[key]
			const currentPath = prefix ? `${prefix}.${key}` : key

			if (typeof value === "string") {
				// Check if the string is untranslated
				const localeValue = getI18nNestedKey(localeObj, currentPath)

				if (localeValue === undefined || localeValue === value) {
					untranslated[currentPath] = value
				}
			} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				// Recursively check nested objects
				const nestedUntranslated = findI18nUntranslatedKeys(value, currentPath, englishObj, localeObj)

				Object.assign(untranslated, nestedUntranslated)
			}
		}
	}

	return untranslated
}

/**
 * Translate text using OpenRouter API or mock translations for testing
 */
export async function translateI18nText(
	text: string,
	targetLanguage: string,
	apiKey: string,
	model: string = "anthropic/claude-3.7-sonnet",
): Promise<string> {
	// Skip empty strings
	if (!text.trim()) {
		return text
	}

	console.error(
		`🔤 Translating text to ${targetLanguage}: "${text.substring(0, 30)}${text.length > 30 ? "..." : ""}"`,
	)

	// Require API key for translations
	if (!apiKey || apiKey.trim() === "") {
		console.error("❌ ERROR: No API key provided for translation")
		throw new Error(
			"OpenRouter API key is required for translations. Please set OPENROUTER_API_KEY in .env.local file.",
		)
	}

	try {
		// Get translation instructions
		const instructions = getTranslationRules()

		const message = `${instructions}

Source text: ${text}

Target language: ${targetLanguage}

Translation:`

		const response = await axios.post(
			"https://openrouter.ai/api/v1/chat/completions",
			{
				model,
				messages: [
					{
						role: "user",
						content: message,
					},
				],
			},
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					"HTTP-Referer": "https://i18naid.tool",
					"X-Title": "i18naid-mcp",
				},
			},
		)

		if (response.data && response.data.choices && response.data.choices.length > 0) {
			const translatedText = response.data.choices[0].message.content.trim()
			console.error(
				`✅ Translation complete: "${translatedText.substring(0, 30)}${translatedText.length > 30 ? "..." : ""}"`,
			)
			return translatedText
		} else {
			throw new Error("Invalid response from translation API")
		}
	} catch (error) {
		if (axios.isAxiosError(error)) {
			const message = error.response?.data?.error?.message || error.message
			throw new Error(`Translation API error: ${message}`)
		}
		throw error
	}
}

/**
 * Get translation rules as a string
 */
function getTranslationRules(): string {
	const rules = `You are an expert translator. Your task is to translate the provided source text to the target language while following these rules:

1. Maintain the original meaning, tone, and intent of the text.
2. Respect any placeholders like {{variable}} or %{variable} and keep them unchanged.
3. Preserve any HTML tags, markdown formatting, or special syntax.
4. Ensure the translation is culturally appropriate for the target language.
5. For UI strings, keep the translation concise but clear.
6. Respond ONLY with the translated text, nothing else.`

	return rules
}
