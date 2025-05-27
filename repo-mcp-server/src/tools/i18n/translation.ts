import axios from "axios"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"

import { getI18nLocales, getI18nNamespaces } from "../../utils/locale-utils.js"
import { getI18nNestedKey } from "../../utils/json-utils.js"

export async function findI18nUntranslatedStrings(
	target: "core" | "webview",
	localePaths: { core: string; webview: string },
): Promise<Map<string, Map<string, Map<string, string>>>> {
	const locales = await getI18nLocales(target, localePaths)
	const englishLocale = locales.find((locale) => locale.toLowerCase().startsWith("en"))

	if (!englishLocale) {
		throw new Error("English locale not found")
	}

	const jsonFiles = await getI18nNamespaces(target, englishLocale, localePaths)
	const untranslatedStrings = new Map<string, Map<string, Map<string, string>>>()

	for (const locale of locales) {
		if (locale !== englishLocale) {
			untranslatedStrings.set(locale, new Map())
		}
	}

	for (const file of jsonFiles) {
		const englishFilePath = path.join(localePaths[target], englishLocale, file)
		const englishContent = await fs.readFile(englishFilePath, "utf-8")
		const englishJson = JSON.parse(englishContent)

		for (const locale of locales) {
			if (locale === englishLocale) continue

			const localeFilePath = path.join(localePaths[target], locale, file)
			const localeFileMap = untranslatedStrings.get(locale) || new Map()

			if (!existsSync(localeFilePath)) {
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
					console.error(`Error parsing JSON file ${localeFilePath}: ${String(error)}`)
					continue
				}

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
	}

	return untranslatedStrings
}

function findI18nUntranslatedKeys(obj: any, prefix: string, englishObj: any, localeObj: any): Record<string, string> {
	const untranslated: Record<string, string> = {}

	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			const value = obj[key]
			const currentPath = prefix ? `${prefix}.${key}` : key

			if (typeof value === "string") {
				const localeValue = getI18nNestedKey(localeObj, currentPath)

				if (localeValue === undefined || localeValue === value) {
					untranslated[currentPath] = value
				}
			} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				const nestedUntranslated = findI18nUntranslatedKeys(value, currentPath, englishObj, localeObj)
				Object.assign(untranslated, nestedUntranslated)
			}
		}
	}

	return untranslated
}

export async function translateI18nText(
	text: string,
	targetLanguage: string,
	apiKey: string,
	model: string = "anthropic/claude-3.7-sonnet",
): Promise<string> {
	if (!text.trim()) {
		return text
	}

	if (!apiKey) {
		throw new Error("OpenRouter API key is required for translations")
	}

	const message = `${getTranslationRules()}

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

	if (response.data?.choices?.[0]?.message?.content) {
		return response.data.choices[0].message.content.trim()
	}

	throw new Error("Invalid response from translation API")
}

function getTranslationRules(): string {
	return `You are an expert translator. Your task is to translate the provided source text to the target language while following these rules:

1. Maintain the original meaning, tone, and intent of the text.
2. Respect any placeholders like {{variable}} or %{variable} and keep them unchanged.
3. Preserve any HTML tags, markdown formatting, or special syntax.
4. Ensure the translation is culturally appropriate for the target language.
5. For UI strings, keep the translation concise but clear.
6. Respond ONLY with the translated text, nothing else.`
}
