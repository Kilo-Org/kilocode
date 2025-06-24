import { downloadAndUnzipVSCode } from "@vscode/test-electron/out/download"

export default async () => {
	// console.log("Downloading VS Code insiders...")
	// await downloadAndUnzipVSCode("insiders")

	console.log("Downloading VS Code stable...")
	await downloadAndUnzipVSCode("stable")

	console.log("VS Code downloads completed!")
}
