import * as vscode from "vscode"
import fs from "fs/promises"
import * as path from "path"
import { extractTextFromFile } from "./extract-text"

/**
 * Gets the MIME type for a file based on its extension
 */
function getMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase()
	switch (ext) {
		case ".png":
			return "image/png"
		case ".jpg":
		case ".jpeg":
			return "image/jpeg"
		case ".webp":
			return "image/webp"
		default:
			return "application/octet-stream"
	}
}

/**
 * Supports processing of images and other file types
 */
export async function selectFiles(): Promise<{ images: string[]; files: string[] }> {
	const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] // supported by anthropic and openrouter
	const OTHER_FILE_EXTENSIONS = ["xml", "json", "txt", "log", "md", "docx", "ipynb", "pdf"]

	const options: vscode.OpenDialogOptions = {
		canSelectMany: true,
		openLabel: "Upload Images & Files",
		filters: {
			"All Files": [...IMAGE_EXTENSIONS, ...OTHER_FILE_EXTENSIONS],
			Images: IMAGE_EXTENSIONS,
			Documents: OTHER_FILE_EXTENSIONS,
		},
	}

	const fileUris = await vscode.window.showOpenDialog(options)

	if (!fileUris || fileUris.length === 0) {
		return { images: [], files: [] }
	}

	const images: string[] = []
	const files: string[] = []

	for (const uri of fileUris) {
		const filePath = uri.fsPath
		const fileExtension = path.extname(filePath).toLowerCase().substring(1)
		const isImage = IMAGE_EXTENSIONS.includes(fileExtension)

		if (isImage) {
			try {
				const buffer = await fs.readFile(filePath)
				const stats = await fs.stat(filePath)

				if (stats.size > 20 * 1024 * 1024) {
					vscode.window.showErrorMessage(
						`Image too large: ${path.basename(filePath)} was skipped (size exceeds 20mb).`,
					)
					continue
				}

				const base64 = buffer.toString("base64")
				const mimeType = getMimeType(filePath)
				images.push(`data:${mimeType};base64,${base64}`)
			} catch (error) {
				console.error(`Error processing image ${filePath}:`, error)
				vscode.window.showErrorMessage(`Error processing image: ${path.basename(filePath)}`)
			}
		} else {
			try {
				const stats = await fs.stat(filePath)
				if (stats.size > 20 * 1024 * 1024) {
					// 20MB limit
					vscode.window.showErrorMessage(
						`File too large: ${path.basename(filePath)} was skipped (size exceeds 20MB).`,
					)
					continue
				}
				files.push(filePath)
			} catch (error) {
				console.error(`Error processing file ${filePath}:`, error)
				vscode.window.showErrorMessage(`Error processing file: ${path.basename(filePath)}`)
			}
		}
	}

	return { images, files }
}

/**
 * Helper function used to load file(s) and format them into a string
 */
export async function processFilesIntoText(files: string[]): Promise<string> {
	const fileContentsPromises = files.map(async (filePath) => {
		// Normalize path separators to forward slashes
		const normalizedPath = filePath.split(path.sep).join("/")
		try {
			const content = await extractTextFromFile(filePath)
			return `<file_content path="${normalizedPath}">\n${content}\n</file_content>`
		} catch (error) {
			console.error(`Error processing file ${filePath}:`, error)
			const errorMessage = error instanceof Error ? error.message : String(error)
			return `<file_content path="${normalizedPath}">\nError fetching content: ${errorMessage}\n</file_content>`
		}
	})

	const fileContents = await Promise.all(fileContentsPromises)

	const validFileContents = fileContents.filter((content) => content !== null).join("\n\n")

	if (validFileContents) {
		return `Files attached by the user:\n\n${validFileContents}`
	}

	// returns empty string if no files were loaded properly, basically it shows
	// the user text saying that the file wasn't able to be read
	return ""
}
