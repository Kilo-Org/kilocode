import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

/**
 * Attempt to open a URL in the user's default browser
 * @param url The URL to open
 * @returns true if browser opened successfully, false otherwise
 */
export async function openBrowser(url: string): Promise<boolean> {
	try {
		const platform = process.platform
		let command: string

		switch (platform) {
			case "darwin": // macOS
				command = `open "${url}"`
				break
			case "win32": // Windows
				command = `start "" "${url}"`
				break
			default: // Linux and others
				command = `xdg-open "${url}"`
				break
		}

		await execAsync(command)
		return true
	} catch (_error) {
		// Browser opening failed - user will need to open manually
		return false
	}
}
