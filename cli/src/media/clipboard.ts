import * as fs from "fs"
import * as path from "path"
import { logs } from "../services/logs.js"
import {
	buildDataUrl,
	detectImageFormat,
	generateClipboardFilename,
	getClipboardDir,
	parseClipboardInfo,
	MAX_CLIPBOARD_IMAGE_AGE_MS,
	getUnsupportedClipboardPlatformMessage,
	type ClipboardImageResult,
	type ClipboardInfoResult,
	type SaveClipboardResult,
} from "./clipboard-shared.js"
import { hasClipboardImageMacOS, saveClipboardImageMacOS } from "./clipboard-macos.js"

export {
	buildDataUrl,
	detectImageFormat,
	generateClipboardFilename,
	getClipboardDir,
	getUnsupportedClipboardPlatformMessage,
	parseClipboardInfo,
	type ClipboardImageResult,
	type ClipboardInfoResult,
	type SaveClipboardResult,
}

export async function isClipboardSupported(): Promise<boolean> {
	return process.platform === "darwin"
}

export async function clipboardHasImage(): Promise<boolean> {
	try {
		if (process.platform === "darwin") {
			return await hasClipboardImageMacOS()
		}
		return false
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		logs.debug("clipboardHasImage failed, treating as no image", "clipboard", {
			error: err?.message ?? String(error),
			code: err?.code,
		})
		return false
	}
}

export async function saveClipboardImage(): Promise<SaveClipboardResult> {
	if (process.platform !== "darwin") {
		return {
			success: false,
			error: getUnsupportedClipboardPlatformMessage(),
		}
	}

	try {
		return await saveClipboardImageMacOS()
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

export async function cleanupOldClipboardImages(): Promise<void> {
	const clipboardDir = getClipboardDir()

	try {
		const files = await fs.promises.readdir(clipboardDir)
		const now = Date.now()

		for (const file of files) {
			if (!file.startsWith("clipboard-")) continue

			const filePath = path.join(clipboardDir, file)
			try {
				const stats = await fs.promises.stat(filePath)
				if (now - stats.mtimeMs > MAX_CLIPBOARD_IMAGE_AGE_MS) {
					await fs.promises.unlink(filePath)
				}
			} catch (error) {
				const err = error as NodeJS.ErrnoException
				logs.debug("Failed to delete stale clipboard image", "clipboard", {
					filePath,
					error: err?.message ?? String(error),
					code: err?.code,
				})
			}
		}
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		logs.debug("Skipping clipboard cleanup; directory not accessible", "clipboard", {
			dir: clipboardDir,
			error: err?.message ?? String(error),
			code: err?.code,
		})
	}
}
