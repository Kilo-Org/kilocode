import * as fs from "fs"
import * as path from "path"
import {
	buildDataUrl,
	ensureClipboardDir,
	execFileAsync,
	generateClipboardFilename,
	parseXclipTargets,
} from "./clipboard-shared.js"
import type { ClipboardImageResult, SaveClipboardResult } from "./clipboard-shared.js"

export function getXclipNotInstalledMessage(): string {
	return `Clipboard paste requires xclip. Install with:
  - Debian/Ubuntu: sudo apt install xclip
  - Fedora: sudo dnf install xclip
  - Arch: sudo pacman -S xclip`
}

export async function hasClipboardImageLinux(): Promise<boolean> {
	const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"])
	return parseXclipTargets(stdout).hasImage
}

export async function readClipboardImageLinux(): Promise<ClipboardImageResult> {
	try {
		const { stdout: targets } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"])
		const parsed = parseXclipTargets(targets)

		if (!parsed.hasImage || !parsed.mimeType) {
			return {
				success: false,
				error: "No image found in clipboard.",
			}
		}

		const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", parsed.mimeType, "-o"], {
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

		const format = parsed.mimeType.split("/")[1] || "png"

		return {
			success: true,
			dataUrl: buildDataUrl(imageBuffer, format),
		}
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		if (err.code === "ENOENT") {
			return {
				success: false,
				error: getXclipNotInstalledMessage(),
			}
		}
		throw error
	}
}

export async function saveClipboardImageLinux(): Promise<SaveClipboardResult> {
	try {
		const { stdout: targets } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"])
		const parsed = parseXclipTargets(targets)

		if (!parsed.hasImage || !parsed.mimeType) {
			return {
				success: false,
				error: "No image found in clipboard.",
			}
		}

		const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", parsed.mimeType, "-o"], {
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

		const format = parsed.mimeType.split("/")[1] || "png"

		const clipboardDir = await ensureClipboardDir()
		const filename = generateClipboardFilename(format)
		const filePath = path.join(clipboardDir, filename)

		await fs.promises.writeFile(filePath, imageBuffer)

		return {
			success: true,
			filePath,
		}
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		if (err.code === "ENOENT") {
			return {
				success: false,
				error: getXclipNotInstalledMessage(),
			}
		}
		throw error
	}
}
