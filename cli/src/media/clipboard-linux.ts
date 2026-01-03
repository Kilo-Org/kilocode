import * as fs from "fs"
import * as path from "path"
import { logs } from "../services/logs.js"
import {
	buildDataUrl,
	ensureClipboardDir,
	execFileAsync,
	generateClipboardFilename,
	detectImageFormat,
	type ClipboardImageResult,
	type SaveClipboardResult,
} from "./clipboard-shared.js"

/**
 * Check if xclip or xsel is available
 */
async function getClipboardTool(): Promise<"xclip" | "xsel" | null> {
	try {
		await execFileAsync("which", ["xclip"])
		return "xclip"
	} catch {
		try {
			await execFileAsync("which", ["xsel"])
			return "xsel"
		} catch {
			return null
		}
	}
}

/**
 * Check if clipboard contains an image on Linux
 */
export async function hasClipboardImageLinux(): Promise<boolean> {
	const tool = await getClipboardTool()
	if (!tool) {
		logs.debug("No clipboard tool available (xclip or xsel)", "clipboard")
		return false
	}

	try {
		if (tool === "xclip") {
			const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"])
			return stdout.includes("image/png") || stdout.includes("image/jpeg") || stdout.includes("image/bmp")
		} else {
			// xsel doesn't support TARGETS query, try reading image directly
			try {
				await execFileAsync("xsel", ["--clipboard", "--output"], {
					maxBuffer: 1024,
					timeout: 1000,
				})
				// If we got here without error, there might be text but not an image
				// xsel doesn't have good image support
				return false
			} catch {
				return false
			}
		}
	} catch (error) {
		logs.debug("Error checking clipboard for image", "clipboard", {
			error: error instanceof Error ? error.message : String(error),
		})
		return false
	}
}

/**
 * Read clipboard image as data URL on Linux
 */
export async function readClipboardImageLinux(): Promise<ClipboardImageResult> {
	const tool = await getClipboardTool()
	if (!tool) {
		return {
			success: false,
			error: "No clipboard tool available. Please install xclip: sudo apt install xclip",
		}
	}

	if (tool !== "xclip") {
		return {
			success: false,
			error: "xsel does not support image clipboard. Please install xclip: sudo apt install xclip",
		}
	}

	try {
		// Try PNG first
		try {
			const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"], {
				encoding: "buffer",
				maxBuffer: 50 * 1024 * 1024,
			})

			const imageBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
			if (imageBuffer.length > 0) {
				return {
					success: true,
					dataUrl: buildDataUrl(imageBuffer, "png"),
				}
			}
		} catch {
			// PNG not available, try JPEG
		}

		// Try JPEG
		try {
			const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", "image/jpeg", "-o"], {
				encoding: "buffer",
				maxBuffer: 50 * 1024 * 1024,
			})

			const imageBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
			if (imageBuffer.length > 0) {
				return {
					success: true,
					dataUrl: buildDataUrl(imageBuffer, "jpeg"),
				}
			}
		} catch {
			// JPEG not available
		}

		return {
			success: false,
			error: "No image found in clipboard.",
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Save clipboard image to file on Linux
 */
export async function saveClipboardImageLinux(): Promise<SaveClipboardResult> {
	const tool = await getClipboardTool()
	if (!tool) {
		return {
			success: false,
			error: "No clipboard tool available. Please install xclip: sudo apt install xclip",
		}
	}

	if (tool !== "xclip") {
		return {
			success: false,
			error: "xsel does not support image clipboard. Please install xclip: sudo apt install xclip",
		}
	}

	const clipboardDir = await ensureClipboardDir()

	// Try PNG first, then JPEG
	const formats = [
		{ mime: "image/png", ext: "png" },
		{ mime: "image/jpeg", ext: "jpeg" },
		{ mime: "image/bmp", ext: "bmp" },
	]

	for (const format of formats) {
		try {
			const filename = generateClipboardFilename(format.ext)
			const filePath = path.join(clipboardDir, filename)

			const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", format.mime, "-o"], {
				encoding: "buffer",
				maxBuffer: 50 * 1024 * 1024,
			})

			const imageBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)

			if (imageBuffer.length === 0) {
				continue
			}

			// Verify it's actually an image by checking magic bytes
			const detectedFormat = detectImageFormat(imageBuffer)
			if (!detectedFormat) {
				continue
			}

			await fs.promises.writeFile(filePath, imageBuffer)

			const stats = await fs.promises.stat(filePath)
			if (stats.size === 0) {
				await fs.promises.unlink(filePath).catch(() => {})
				continue
			}

			return {
				success: true,
				filePath,
			}
		} catch {
			// This format not available, try next
			continue
		}
	}

	return {
		success: false,
		error: "No image found in clipboard.",
	}
}
