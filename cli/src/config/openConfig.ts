import { spawn } from "child_process"
import { platform } from "os"
import { ensureConfigDir, configExists, saveConfig, DEFAULT_CONFIG, getConfigPath } from "."

export default async function openConfigFile() {
	try {
		// Ensure config directory exists
		await ensureConfigDir()

		// Check if config file exists, if not create it with defaults
		const exists = await configExists()
		if (!exists) {
			console.log("Config file not found. Creating default configuration...")
			// Skip validation when creating default config since tokens may be empty
			await saveConfig(DEFAULT_CONFIG, true)
			console.log("Default configuration created.")
		}

		// Get the config file path
		const configPath = await getConfigPath()
		console.log(`Opening config file: ${configPath}`)

		// Determine the editor command based on platform and environment
		const editor = process.env.EDITOR || process.env.VISUAL
		let editorCommand: string
		let editorArgs: string[]

		if (editor) {
			// Use user's preferred editor from environment variable
			editorCommand = editor
			editorArgs = [configPath]
		} else {
			// Use platform-specific default
			const currentPlatform = platform()
			switch (currentPlatform) {
				case "darwin": // macOS
					editorCommand = "open"
					editorArgs = ["-t", configPath] // -t opens in default text editor
					break
				case "win32": // Windows
					editorCommand = "cmd"
					editorArgs = ["/c", "start", "", configPath]
					break
				default: // Linux and others
					editorCommand = "xdg-open"
					editorArgs = [configPath]
					break
			}
		}

		// Spawn the editor process
		const editorProcess = spawn(editorCommand, editorArgs, {
			stdio: "inherit",
		})

		editorProcess.on("error", (error) => {
			console.error(`Failed to open editor: ${error.message}`)
			console.error(`Tried to run: ${editorCommand} ${editorArgs.join(" ")}`)
			console.error(`\nYou can manually edit the config file at: ${configPath}`)
			process.exit(1)
		})

		editorProcess.on("exit", (code) => {
			if (code !== 0 && code !== null) {
				console.error(`Editor exited with code ${code}`)
				console.error(`Config file location: ${configPath}`)
			}
		})
	} catch (error) {
		console.error("Error managing config file:", error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
