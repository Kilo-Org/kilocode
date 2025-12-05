import fs from "fs/promises"
import path from "path"
import { logs } from "../services/logs.js"

export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024 // 8MB

export const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff"] as const
export type SupportedImageExtension = (typeof SUPPORTED_IMAGE_EXTENSIONS)[number]

export function isImagePath(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase()
	return SUPPORTED_IMAGE_EXTENSIONS.includes(ext as SupportedImageExtension)
}

export function getMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase()
	switch (ext) {
		case ".png":
			return "image/png"
		case ".jpeg":
		case ".jpg":
			return "image/jpeg"
		case ".webp":
			return "image/webp"
		case ".gif":
			return "image/gif"
		case ".tiff":
			return "image/tiff"
		default:
			throw new Error(`Unsupported image type: ${ext}`)
	}
}

export async function readImageAsDataUrl(imagePath: string, basePath?: string): Promise<string> {
	// Resolve the path
	const resolvedPath = path.isAbsolute(imagePath) ? imagePath : path.resolve(basePath || process.cwd(), imagePath)

	// Verify it's a supported image type
	if (!isImagePath(resolvedPath)) {
		throw new Error(`Not a supported image type: ${imagePath}`)
	}

	// Check if file exists
	try {
		await fs.access(resolvedPath)
	} catch {
		throw new Error(`Image file not found: ${resolvedPath}`)
	}

	// Enforce size limit before reading
	const stats = await fs.stat(resolvedPath)
	if (stats.size > MAX_IMAGE_SIZE_BYTES) {
		const maxMb = (MAX_IMAGE_SIZE_BYTES / (1024 * 1024)).toFixed(1)
		const actualMb = (stats.size / (1024 * 1024)).toFixed(1)
		throw new Error(`Image file is too large (${actualMb} MB). Max allowed is ${maxMb} MB.`)
	}

	// Read file and convert to base64
	const buffer = await fs.readFile(resolvedPath)
	const base64 = buffer.toString("base64")
	const mimeType = getMimeType(resolvedPath)
	const dataUrl = `data:${mimeType};base64,${base64}`

	logs.debug(`Read image as data URL: ${path.basename(imagePath)}`, "images", {
		path: resolvedPath,
		size: buffer.length,
		mimeType,
	})

	return dataUrl
}

export interface ProcessedImageMentions {
	text: string
	images: string[]
	errors: Array<{ path: string; error: string }>
}

export async function processImagePaths(imagePaths: string[], basePath?: string): Promise<ProcessedImageMentions> {
	const images: string[] = []
	const errors: Array<{ path: string; error: string }> = []

	for (const imagePath of imagePaths) {
		try {
			const dataUrl = await readImageAsDataUrl(imagePath, basePath)
			images.push(dataUrl)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			errors.push({ path: imagePath, error: errorMessage })
			logs.warn(`Failed to load image: ${imagePath}`, "images", { error: errorMessage })
		}
	}

	return {
		text: "", // Will be set by the caller
		images,
		errors,
	}
}
