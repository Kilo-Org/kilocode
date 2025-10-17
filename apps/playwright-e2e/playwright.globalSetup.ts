// kilocode_change - new file
import { downloadAndUnzipVSCode } from "@vscode/test-electron/out/download.js"
import * as path from "path"
import * as fs from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default async () => {
	const workspaceRoot = path.resolve(__dirname, "../..")
	const vscodeTestDir = path.join(workspaceRoot, ".docker-cache", "vscode")

	await fs.promises.mkdir(vscodeTestDir, { recursive: true })

	console.log(`Using VS Code cache directory: ${vscodeTestDir}`)
	console.log("Downloading VS Code stable...")
	const vscodePath = await downloadAndUnzipVSCode({ version: "stable", cachePath: vscodeTestDir })

	// Store the VS Code executable path for tests to use
	process.env.VSCODE_EXECUTABLE_PATH = vscodePath
	console.log(`VS Code executable path: ${vscodePath}`)

	// console.log("Downloading VS Code insiders...")
	// await downloadAndUnzipVSCode({ version: "insiders", cachePath: vscodeTestDir })

	console.log("VS Code downloads completed!")
}
