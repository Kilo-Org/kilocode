import * as fs from "fs"
import * as path from "path"
import { logs } from "../services/logs.js"
import {
	buildDataUrl,
	ensureClipboardDir,
	generateClipboardFilename,
	type ClipboardImageResult,
	type SaveClipboardResult,
} from "./clipboard-shared.js"
import { exec as execCallback } from "child_process"
import { promisify } from "util"

const exec = promisify(execCallback)

/**
 * Check if clipboard contains an image on Windows
 */
export async function hasClipboardImageWindows(): Promise<boolean> {
	try {
		const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::ContainsImage()
`
		const { stdout } = await exec(
			`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
			{
				timeout: 5000,
			},
		)

		return stdout.trim().toLowerCase() === "true"
	} catch (error) {
		logs.debug("Error checking clipboard for image", "clipboard", {
			error: error instanceof Error ? error.message : String(error),
		})
		return false
	}
}

/**
 * Read clipboard image as data URL on Windows
 */
export async function readClipboardImageWindows(): Promise<ClipboardImageResult> {
	try {
		// Create a temporary file path
		const tempDir = await ensureClipboardDir()
		const tempFile = path.join(tempDir, `temp-${Date.now()}.png`)
		const escapedPath = tempFile.replace(/\\/g, "\\\\")

		const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
    $img.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
    $img.Dispose()
    Write-Output 'success'
} else {
    Write-Output 'no_image'
}
`

		const { stdout } = await exec(
			`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
			{
				timeout: 10000,
			},
		)

		if (stdout.trim() !== "success") {
			return {
				success: false,
				error: "No image found in clipboard.",
			}
		}

		// Read the file and convert to data URL
		const imageBuffer = await fs.promises.readFile(tempFile)

		// Clean up temp file
		await fs.promises.unlink(tempFile).catch(() => {})

		if (imageBuffer.length === 0) {
			return {
				success: false,
				error: "Failed to read image data from clipboard.",
			}
		}

		return {
			success: true,
			dataUrl: buildDataUrl(imageBuffer, "png"),
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Save clipboard image to file on Windows
 */
export async function saveClipboardImageWindows(): Promise<SaveClipboardResult> {
	try {
		const clipboardDir = await ensureClipboardDir()
		const filename = generateClipboardFilename("png")
		const filePath = path.join(clipboardDir, filename)
		const escapedPath = filePath.replace(/\\/g, "\\\\")

		const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
    $img.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
    $img.Dispose()
    Write-Output 'success'
} else {
    Write-Output 'no_image'
}
`

		const { stdout } = await exec(
			`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
			{
				timeout: 10000,
			},
		)

		if (stdout.trim() !== "success") {
			return {
				success: false,
				error: "No image found in clipboard.",
			}
		}

		// Verify file exists and has content
		const stats = await fs.promises.stat(filePath)
		if (stats.size === 0) {
			await fs.promises.unlink(filePath).catch(() => {})
			return {
				success: false,
				error: "Failed to write image data to file.",
			}
		}

		return {
			success: true,
			filePath,
		}
	} catch (error) {
		// Clean up on error
		try {
			const clipboardDir = await ensureClipboardDir()
			const files = await fs.promises.readdir(clipboardDir)
			for (const file of files) {
				if (file.startsWith("clipboard-") && file.endsWith(".png")) {
					const filePath = path.join(clipboardDir, file)
					const stats = await fs.promises.stat(filePath)
					if (stats.size === 0) {
						await fs.promises.unlink(filePath).catch(() => {})
					}
				}
			}
		} catch {
			// Ignore cleanup errors
		}

		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
