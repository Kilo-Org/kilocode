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
