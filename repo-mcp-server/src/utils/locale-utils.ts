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

// Function to get the locale code in a format suitable for translation
export function getLocaleForTranslation(locale: string): string {
	// Just return the locale code itself, which is what most translation APIs expect
	// This avoids maintaining a map of locale codes to language names
	return locale
}
