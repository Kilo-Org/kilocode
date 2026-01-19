/**
 * TempImageManager - Manages temporary image files for Agent Manager.
 *
 * Handles saving base64 data URL images to temp files and cleaning them up.
 * Images are saved to a temp directory and cleaned up when the extension deactivates.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { randomUUID } from "node:crypto"
import type * as vscode from "vscode"

/** Directory name for temporary image files */
const TEMP_IMAGES_DIR = "kilo-code-agent-manager-images"

/**
 * Message format for sending responses to the CLI via stdin.
 * Used for user messages, approval responses, and other interactions.
 */
export interface StdinAskResponseMessage {
	type: "askResponse"
	askResponse: "messageResponse" | "yesButtonClicked" | "noButtonClicked"
	text: string
	images?: string[]
}

/**
 * Manages temporary image files for Agent Manager sessions.
 * Provides methods to save images to temp files and clean them up.
 */
export class TempImageManager {
	constructor(private readonly outputChannel: vscode.OutputChannel) {}

	/**
	 * Get the temp directory path for storing images.
	 */
	public getTempDir(): string {
		return path.join(os.tmpdir(), TEMP_IMAGES_DIR)
	}

	/**
	 * Save base64 data URL images to temp files and return file paths.
	 * Images are saved to a temp directory and cleaned up when the extension deactivates.
	 *
	 * @param dataUrls Array of base64 data URL strings (e.g., "data:image/png;base64,...")
	 * @returns Array of file paths to the saved images
	 */
	public async saveImagesToTempFiles(dataUrls: string[]): Promise<string[]> {
		if (!dataUrls || dataUrls.length === 0) {
			return []
		}

		const tempDir = this.getTempDir()

		// Ensure temp directory exists
		await fs.promises.mkdir(tempDir, { recursive: true })

		const savedPaths: string[] = []

		for (const dataUrl of dataUrls) {
			try {
				// Parse data URL: data:image/png;base64,<data>
				const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
				if (!match) {
					this.outputChannel.appendLine(`[TempImageManager] Invalid image data URL format`)
					continue
				}

				const [, format, base64Data] = match
				const ext = format === "jpeg" ? "jpg" : format
				const filename = `clipboard-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
				const filepath = path.join(tempDir, filename)

				// Write the image file
				const buffer = Buffer.from(base64Data, "base64")
				await fs.promises.writeFile(filepath, buffer)

				savedPaths.push(filepath)
				this.outputChannel.appendLine(`[TempImageManager] Saved image to temp file: ${filepath}`)
			} catch (error) {
				this.outputChannel.appendLine(`[TempImageManager] Failed to save image: ${error}`)
			}
		}

		return savedPaths
	}

	/**
	 * Build a StdinAskResponseMessage with optional image support.
	 * Handles saving images to temp files and attaching paths to the message.
	 *
	 * @param content The text content of the message
	 * @param images Optional array of base64 data URL images
	 * @returns A StdinAskResponseMessage ready to be sent to the CLI
	 */
	public async buildAskResponseMessage(content: string, images?: string[]): Promise<StdinAskResponseMessage> {
		const message: StdinAskResponseMessage = {
			type: "askResponse",
			askResponse: "messageResponse",
			text: content,
		}

		if (images && images.length > 0) {
			const imagePaths = await this.saveImagesToTempFiles(images)
			if (imagePaths.length > 0) {
				message.images = imagePaths
			}
		}

		return message
	}

	/**
	 * Clean up temporary image files created during the session.
	 * Should be called when the extension deactivates.
	 */
	public async cleanup(): Promise<void> {
		const tempDir = this.getTempDir()
		try {
			await fs.promises.rm(tempDir, { recursive: true, force: true })
			this.outputChannel.appendLine(`[TempImageManager] Cleaned up temp images directory`)
		} catch (error) {
			// Log the error but don't throw - cleanup failures shouldn't crash the extension
			this.outputChannel.appendLine(
				`[TempImageManager] Failed to clean up temp images directory: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
}
