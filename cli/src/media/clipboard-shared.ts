import { execFile } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { promisify } from "util"

export const execFileAsync = promisify(execFile)

export const CLIPBOARD_DIR = "kilocode-clipboard"
export const MAX_CLIPBOARD_IMAGE_AGE_MS = 60 * 60 * 1000

export interface ClipboardImageResult {
	success: boolean
	dataUrl?: string
	error?: string
}

export interface ClipboardInfoResult {
	hasImage: boolean
	format: "png" | "jpeg" | "tiff" | "gif" | null
}

export interface SaveClipboardResult {
	success: boolean
	filePath?: string
	error?: string
}

export function parseClipboardInfo(output: string): ClipboardInfoResult {
	if (!output) {
		return { hasImage: false, format: null }
	}

	if (output.includes("PNGf") || output.includes("class PNGf")) {
		return { hasImage: true, format: "png" }
	}
	if (output.includes("JPEG") || output.includes("class JPEG")) {
		return { hasImage: true, format: "jpeg" }
	}
	if (output.includes("TIFF") || output.includes("TIFF picture")) {
		return { hasImage: true, format: "tiff" }
	}
	if (output.includes("GIFf") || output.includes("class GIFf")) {
		return { hasImage: true, format: "gif" }
	}

	return { hasImage: false, format: null }
}

export function detectImageFormat(buffer: Buffer): "png" | "jpeg" | "gif" | "webp" | null {
	if (buffer.length < 4) {
		return null
	}

	if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
		return "png"
	}

	if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
		return "jpeg"
	}

	if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
		return "gif"
	}

	if (
		buffer.length >= 12 &&
		buffer[0] === 0x52 &&
		buffer[1] === 0x49 &&
		buffer[2] === 0x46 &&
		buffer[3] === 0x46 &&
		buffer[8] === 0x57 &&
		buffer[9] === 0x45 &&
		buffer[10] === 0x42 &&
		buffer[11] === 0x50
	) {
		return "webp"
	}

	return null
}

export function buildDataUrl(data: Buffer, format: string): string {
	return `data:image/${format};base64,${data.toString("base64")}`
}

export function getUnsupportedClipboardPlatformMessage(): string {
	return `Clipboard image paste is only supported on macOS.

Alternative:
  - Use @path/to/image.png to attach images`
}

export function getClipboardDir(): string {
	return path.join(os.tmpdir(), CLIPBOARD_DIR)
}

export async function ensureClipboardDir(): Promise<string> {
	const clipboardDir = getClipboardDir()
	await fs.promises.mkdir(clipboardDir, { recursive: true })
	return clipboardDir
}

export function generateClipboardFilename(format: string): string {
	const timestamp = Date.now()
	const random = Math.random().toString(36).substring(2, 8)
	return `clipboard-${timestamp}-${random}.${format}`
}
