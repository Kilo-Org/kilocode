// kilocode_change - new file
import * as vscode from "vscode"
import * as path from "path"
import * as os from "os"
import JSON5 from "json5"
import { promises as fs } from "fs"

function productDirName(): string {
	const name = vscode.env.appName || ""
	const n = name.toLowerCase()

	if (n.includes("insiders")) return "Code - Insiders"
	if (n.includes("visual studio code")) return "Code"
	if (n.includes("vscodium")) return "VSCodium"
	if (n.includes("cursor")) return "Cursor"
	if (n.includes("windsurf")) return "Windsurf"
	if (n.includes("oss")) return "Code - OSS"

	return "Code"
}

export function getUserDataBaseDir(): string {
	const portable = process.env.VSCODE_PORTABLE
	if (portable) return path.join(portable, "user-data")

	const home = os.homedir()
	const product = productDirName()

	if (process.platform === "win32") {
		const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming")
		return path.join(appdata, product)
	}

	if (process.platform === "darwin") {
		return path.join(home, "Library", "Application Support", product)
	}

	const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
	return path.join(xdg, product)
}

export async function readJSON5File(filePath: string): Promise<unknown | null> {
	try {
		const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
		return JSON5.parse(Buffer.from(buf).toString("utf8"))
	} catch {
		return null
	}
}

export function canReadLocalFiles(): boolean {
	return !vscode.env.remoteName && vscode.env.uiKind === vscode.UIKind.Desktop
}

export async function readUserConfigFile(filename: string): Promise<Array<Record<string, unknown>>> {
	if (!canReadLocalFiles()) return []

	const candidates = await getConfigFileCandidates(filename)
	for (const filePath of candidates) {
		const rules = await readJSON5File(filePath)
		if (Array.isArray(rules)) return rules as Array<Record<string, unknown>>
	}
	return []
}

async function getConfigFileCandidates(filename: string): Promise<string[]> {
	if (!vscode.env.remoteName && (process.env.CODE_SERVER === "true" || process.env.VSCODE_PROXY_URI)) {
		const base = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "code-server")
		const user = path.join(base, "User")
		return await enumerateProfileFiles(user, filename)
	}

	const baseDir = getUserDataBaseDir()
	const userDir = path.join(baseDir, "User")
	return await enumerateProfileFiles(userDir, filename)
}

async function enumerateProfileFiles(userDir: string, filename: string): Promise<string[]> {
	const candidates: string[] = []
	candidates.push(path.join(userDir, filename))

	try {
		const profilesDir = path.join(userDir, "profiles")
		const entries = await fs.readdir(profilesDir, { withFileTypes: true })
		for (const e of entries) {
			if (e.isDirectory()) {
				candidates.push(path.join(profilesDir, e.name, filename))
			}
		}
	} catch {
		// No profiles directory
	}

	const existing: string[] = []
	for (const p of candidates) {
		try {
			const st = await fs.stat(p)
			if (st.isFile()) existing.push(p)
		} catch {
			/* ignore */
		}
	}
	if (existing.length > 1) {
		const stats = await Promise.all(existing.map(async (p) => ({ path: p, stat: await fs.stat(p) })))
		stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
		return stats.map((s) => s.path)
	}
	return existing
}
