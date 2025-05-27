import path from "node:path"
import fs from "node:fs/promises"

export async function getI18nLocales(
	target: "core" | "webview",
	localePaths: { core: string; webview: string },
): Promise<string[]> {
	const basePath = localePaths[target]
	const entries = await fs.readdir(basePath, { withFileTypes: true })
	return entries.filter((entry) => entry.isDirectory()).map((dir) => dir.name)
}

export async function getI18nNamespaces(
	target: "core" | "webview",
	locale: string,
	localePaths: { core: string; webview: string },
): Promise<string[]> {
	const localePath = path.join(localePaths[target], locale)
	const entries = await fs.readdir(localePath)
	return entries.filter((file) => file.endsWith(".json"))
}

export function getLanguageFromLocale(locale: string): string {
	if (locale.toLowerCase().startsWith("zh-")) {
		return "Chinese"
	}

	const languageMap: Record<string, string> = {
		en: "English",
		es: "Spanish",
		fr: "French",
		de: "German",
		it: "Italian",
		ja: "Japanese",
		ko: "Korean",
		pt: "Portuguese",
		ru: "Russian",
		ar: "Arabic",
		hi: "Hindi",
		nl: "Dutch",
		tr: "Turkish",
		pl: "Polish",
		vi: "Vietnamese",
		ca: "Catalan",
		sv: "Swedish",
		fi: "Finnish",
		no: "Norwegian",
		da: "Danish",
		cs: "Czech",
		hu: "Hungarian",
		ro: "Romanian",
		uk: "Ukrainian",
		el: "Greek",
		he: "Hebrew",
		th: "Thai",
		id: "Indonesian",
		ms: "Malay",
		fa: "Persian",
	}

	const baseCode = locale.split("-")[0].toLowerCase()
	return languageMap[baseCode] || baseCode
}
