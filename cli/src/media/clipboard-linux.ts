import { exec } from "child_process"
import { logs } from "../services/logs.js"
import { promisify } from "util"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import { ensureClipboardDir, generateClipboardFilename, SaveClipboardResult } from "./clipboard-shared.js"

const execAsync = promisify(exec)

const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".tiff"]

export type LinuxClipboardTool = "wl-paste" | "xclip" | null

function getLinuxClipboardToolName(): "wl-paste" | "xclip" | null {
	const displayServer = process.env["XDG_SESSION_TYPE"]

	if (displayServer === "wayland") {
		return "wl-paste"
	}

	if (displayServer === "x11") {
		return "xclip"
	}

	return null
}

export async function isLinuxClipboardSupported(): Promise<boolean> {
	const toolName = getLinuxClipboardToolName()
	if (!toolName) {
		return false
	}

	try {
		await execAsync(`which ${toolName}`)
		return true
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		logs.warn(`Install ${toolName} to enable copy pasting from the clipboard to the terminal`, "clipboard-linux", {
			error: err?.message ?? String(error),
			code: err?.code,
		})
		return false
	}
}

export async function getLinuxClipboardTool(): Promise<LinuxClipboardTool> {
	const toolName = getLinuxClipboardToolName()
	if (!toolName) {
		return null
	}

	try {
		await execAsync(`which ${toolName}`)
		return toolName
	} catch (error) {
		logs.warn(`Install ${toolName} to enable image copy pasting`, "clipboard-linux", {
			error,
		})
		return null
	}
}

/**
 * Checks if the Linux clipboard currently contains any images.
 * This can be either a direct image (mime-type image/*) or a copied image file.
 *
 * @returns A promise that resolves to true if an image is found, false otherwise.
 */
export async function hasClipboardImageLinux() {
	// First, identify the clipboard tool available for the current session (Wayland or X11).
	const tool = await getLinuxClipboardTool()
	if (!tool) {
		return false
	}

	try {
		const mimeTypes = await readClipboardMimeTypes(tool)

		if (mimeTypes.includes("image/")) {
			return true
		}

		const content = await readClipboardGnomeSpecialContent(tool)
		if (!content.trim()) {
			return false
		}

		const lines = content.split(/\n/)
		if (lines.length < 2) {
			return false
		}

		// x-special/gnome-copied-files starts with the action (copy/cut)
		lines.shift()

		const imagePaths = parseImagePathsFromLines(lines)

		return imagePaths.length > 0
	} catch (_error) {
		// If an error occurs during detection, we assume no image is available.
		return false
	}
}

export async function saveClipboardImagesLinux(): Promise<SaveClipboardResult[]> {
	const tool = await getLinuxClipboardTool()
	if (!tool) {
		return [{ success: false, error: "No clipboard tool found" }]
	}

	try {
		const clipboardDir = await ensureClipboardDir()

		const imagePaths = await saveImages(tool)

		if (!imagePaths) {
			return [{ success: false, error: "No image found in clipboard" }]
		}

		const promises = imagePaths.map((imagePath) => saveOneClipboardImage(imagePath, clipboardDir))
		const results = await Promise.all(promises)
		const saved = results.filter((r): r is SaveClipboardResult => r !== null)

		if (saved.length === 0) {
			return [{ success: false, error: "No image found in clipboard" }]
		}

		return saved
	} catch (error) {
		return [
			{
				success: false,
				error: error instanceof Error ? error.message : String(error),
			},
		]
	}
}

async function saveOneClipboardImage(imagePath: string, clipboardDir: string): Promise<SaveClipboardResult | null> {
	try {
		await fs.promises.access(imagePath, fs.constants.R_OK)
	} catch (error) {
		logs.warn(`Could not access image path from clipboard: ${imagePath}`, "clipboard-linux", {
			error,
		})
		return null
	}

	const relativePath = path.relative(clipboardDir, imagePath)
	const isInternal = !relativePath.startsWith("..") && !path.isAbsolute(relativePath)

	if (isInternal) {
		return handleInternalClipboardImage(imagePath)
	} else {
		return handleExternalClipboardImage(imagePath, clipboardDir)
	}
}

async function handleInternalClipboardImage(imagePath: string): Promise<SaveClipboardResult> {
	return { success: true, filePath: imagePath }
}

async function handleExternalClipboardImage(imagePath: string, clipboardDir: string): Promise<SaveClipboardResult> {
	// Now we need to determine the correct file extension for the destination file.
	// We start with a default of 'png'.
	let extension = "png"

	// Check the extension of the source file.
	const ext = path.extname(imagePath).toLowerCase()

	// If the source file has a valid image extension, we use that extension (without the dot).
	if (ext && SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
		extension = ext.slice(1)
	}

	// Generate a unique filename for the new image using the determined extension.
	// This ensures we don't overwrite existing files.
	const filename = generateClipboardFilename(extension)

	// Construct the full destination path by joining the clipboard directory and the new filename.
	const filePath = path.join(clipboardDir, filename)

	try {
		// Attempt to copy the source file to the new destination.
		await fs.promises.copyFile(imagePath, filePath)

		// After copying, check the statistics of the new file to ensure it's not empty.
		const stats = await fs.promises.stat(filePath)

		if (stats.size === 0) {
			// If the copied file is empty (0 bytes), it's invalid.
			// Remove the empty file to clean up.
			await fs.promises.unlink(filePath)

			// Return a failure result indicating the image was empty.
			return { success: false, error: "Clipboard image is empty" }
		}

		// If the copy was successful and the file is not empty, return success with the new path.
		return { success: true, filePath }
	} catch (error) {
		// If any error occurs during the copy process (e.g., permission issues, disk full),
		// log the warning with details.
		logs.error(`Failed to copy image from ${imagePath} to ${filePath}`, "clipboard-linux", {
			error,
		})

		// Return a failure result indicating the copy operation failed.
		return { success: false, error: "Failed to copy image" }
	}
}

async function saveImages(tool: LinuxClipboardTool): Promise<string[] | null> {
	if (!tool) return null

	const mimeTypes = await readClipboardMimeTypes(tool)

	const paths: string[] = []
	if (mimeTypes.includes("image/")) {
		const filePath = await saveImageFromClipboardDirectly(tool)
		paths.push(filePath)

		return paths
	}

	try {
		const content = await readClipboardGnomeSpecialContent(tool)
		if (!content.trim()) {
			return paths
		}

		const lines = content.split(/\n/)
		if (lines.length < 2) {
			return paths
		}

		// x-special/gnome-copied-files starts with the action (copy/cut)
		lines.shift()

		const potentialPaths = parseImagePathsFromLines(lines)

		for (const potentialPath of potentialPaths) {
			try {
				await fs.promises.access(potentialPath, fs.constants.R_OK)
				paths.push(potentialPath)
			} catch (error) {
				logs.warn(`Could not access potential image path from clipboard: ${potentialPath}`, "clipboard-linux", {
					error,
				})
			}
		}
	} catch (error) {
		logs.error("Failed to read image paths from Linux clipboard", "clipboard-linux", {
			error,
		})
	}

	return paths
}

async function readClipboardGnomeSpecialContent(tool: LinuxClipboardTool): Promise<string> {
	return readClipboardContent(tool, "x-special/gnome-copied-files")
}

async function readClipboardContent(tool: LinuxClipboardTool, mimeType: string): Promise<string> {
	let content = ""
	if (tool === "wl-paste") {
		;({ stdout: content } = await execAsync(`wl-paste --type ${mimeType}`))
	} else if (tool === "xclip") {
		;({ stdout: content } = await execAsync(`xclip -selection clipboard -t ${mimeType} -o`))
	}
	return content
}

async function saveImageFromClipboardDirectly(tool: LinuxClipboardTool): Promise<string> {
	const clipboardDir = await ensureClipboardDir()
	const filename = generateClipboardFilename("png")
	const filePath = path.join(clipboardDir, filename)

	if (tool === "wl-paste") {
		await execAsync(`wl-paste --type image/png > "${filePath}"`)
	} else if (tool === "xclip") {
		await execAsync(`xclip -selection clipboard -t image/png -o > "${filePath}"`)
	}

	return filePath
}

async function readClipboardMimeTypes(tool: LinuxClipboardTool): Promise<string> {
	let mimeTypes = ""
	if (tool === "wl-paste") {
		;({ stdout: mimeTypes } = await execAsync("wl-paste --list-types"))
	} else if (tool === "xclip") {
		;({ stdout: mimeTypes } = await execAsync("xclip -selection clipboard -t TARGETS -o"))
	}
	return mimeTypes
}

function parseImagePathsFromLines(lines: string[]): string[] {
	return lines
		.map((line) => line.trim())
		.filter((line) => line.startsWith("file://"))
		.map((fileUri) => fileURLToPath(fileUri))
		.filter((filePath) => {
			const fileExt = path.extname(filePath).toLowerCase()
			return SUPPORTED_IMAGE_EXTENSIONS.includes(fileExt)
		})
}
