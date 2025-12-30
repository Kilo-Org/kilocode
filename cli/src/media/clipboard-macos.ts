import * as fs from "fs"
import * as path from "path"
import { logs } from "../services/logs.js"
import {
	buildDataUrl,
	ensureClipboardDir,
	execFileAsync,
	generateClipboardFilename,
	parseClipboardInfo,
	type ClipboardImageResult,
	type SaveClipboardResult,
} from "./clipboard-shared.js"

export async function hasClipboardImageMacOS(): Promise<boolean> {
	const { stdout } = await execFileAsync("osascript", ["-e", "clipboard info"])
	return parseClipboardInfo(stdout).hasImage
}

export async function readClipboardImageMacOS(): Promise<ClipboardImageResult> {
	const { stdout: info } = await execFileAsync("osascript", ["-e", "clipboard info"])
	const parsed = parseClipboardInfo(info)

	if (!parsed.hasImage || !parsed.format) {
		return {
			success: false,
			error: "No image found in clipboard.",
		}
	}

	const formatToClass: Record<string, string> = {
		png: "PNGf",
		jpeg: "JPEG",
		tiff: "TIFF",
		gif: "GIFf",
	}

	const appleClass = formatToClass[parsed.format]
	if (!appleClass) {
		return {
			success: false,
			error: `Unsupported image format: ${parsed.format}`,
		}
	}

	const script = `set imageData to the clipboard as «class ${appleClass}»
return imageData`

	const { stdout } = await execFileAsync("osascript", ["-e", script], {
		encoding: "buffer",
		maxBuffer: 50 * 1024 * 1024,
	})

	const imageBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)

	if (imageBuffer.length === 0) {
		return {
			success: false,
			error: "Failed to read image data from clipboard.",
		}
	}

	const mimeFormat = parsed.format === "tiff" ? "tiff" : parsed.format

	return {
		success: true,
		dataUrl: buildDataUrl(imageBuffer, mimeFormat),
	}
}

export async function saveClipboardImageMacOS(): Promise<SaveClipboardResult> {
	const { stdout: info } = await execFileAsync("osascript", ["-e", "clipboard info"])
	const parsed = parseClipboardInfo(info)

	if (!parsed.hasImage || !parsed.format) {
		return {
			success: false,
			error: "No image found in clipboard.",
		}
	}

	const formatToClass: Record<string, string> = {
		png: "PNGf",
		jpeg: "JPEG",
		tiff: "TIFF",
		gif: "GIFf",
	}

	const appleClass = formatToClass[parsed.format]
	if (!appleClass) {
		return {
			success: false,
			error: `Unsupported image format: ${parsed.format}`,
		}
	}

	const clipboardDir = await ensureClipboardDir()

	const filename = generateClipboardFilename(parsed.format)
	const filePath = path.join(clipboardDir, filename)

	// Escape backslashes and quotes for AppleScript string interpolation
	const escapedPath = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')

	const script = `
set imageData to the clipboard as «class ${appleClass}»
set filePath to POSIX file "${escapedPath}"
set fileRef to open for access filePath with write permission
write imageData to fileRef
close access fileRef
return "${escapedPath}"
`

	try {
		await execFileAsync("osascript", ["-e", script], {
			maxBuffer: 50 * 1024 * 1024,
		})

		const stats = await fs.promises.stat(filePath)
		if (stats.size === 0) {
			await fs.promises.unlink(filePath)
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
		try {
			await fs.promises.unlink(filePath)
		} catch (cleanupError) {
			const err = cleanupError as NodeJS.ErrnoException
			logs.debug("Failed to remove partial clipboard file after error", "clipboard", {
				filePath,
				error: err?.message ?? String(cleanupError),
				code: err?.code,
			})
		}
		throw error
	}
}
