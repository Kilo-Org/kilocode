import { logs } from "../services/logs.js"
import { parseAtMentions, removeImageMentions } from "./atMentionParser.js"
import { readImageAsDataUrl } from "./images.js"

export interface ProcessedMessage {
	text: string
	images: string[]
	hasImages: boolean
	errors: string[]
}

const IMAGE_REFERENCE_REGEX = /\[Image #(\d+)\]/g

export function extractImageReferences(text: string): number[] {
	const refs: number[] = []
	let match
	IMAGE_REFERENCE_REGEX.lastIndex = 0
	while ((match = IMAGE_REFERENCE_REGEX.exec(text)) !== null) {
		const ref = match[1]
		if (ref !== undefined) {
			refs.push(parseInt(ref, 10))
		}
	}
	return refs
}

export function removeImageReferences(text: string): string {
	return text.replace(IMAGE_REFERENCE_REGEX, "")
}

async function loadImage(
	imagePath: string,
	onSuccess: (dataUrl: string) => void,
	onError: (error: string) => void,
	successLog: string,
	errorLog: { message: string; meta?: Record<string, unknown> },
): Promise<void> {
	try {
		const dataUrl = await readImageAsDataUrl(imagePath)
		onSuccess(dataUrl)
		logs.debug(successLog, "processMessageImages")
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error)
		onError(errorMsg)
		logs.warn(errorLog.message, "processMessageImages", { ...errorLog.meta, error: errorMsg })
	}
}

async function loadReferenceImages(
	refs: number[],
	imageReferences: Record<number, string>,
	images: string[],
	errors: string[],
): Promise<void> {
	logs.debug(`Found ${refs.length} image reference(s)`, "processMessageImages", { refs })

	for (const refNum of refs) {
		const filePath = imageReferences[refNum]
		if (!filePath) {
			errors.push(`Image #${refNum} not found`)
			logs.warn(`Image reference #${refNum} not found in references map`, "processMessageImages")
			continue
		}

		await loadImage(
			filePath,
			(dataUrl) => images.push(dataUrl),
			(errorMsg) => errors.push(`Failed to load Image #${refNum}: ${errorMsg}`),
			`Loaded image #${refNum}: ${filePath}`,
			{ message: `Failed to load image #${refNum}: ${filePath}` },
		)
	}
}

async function loadPathImages(imagePaths: string[], images: string[], errors: string[]): Promise<void> {
	logs.debug(`Found ${imagePaths.length} @path image mention(s)`, "processMessageImages", {
		paths: imagePaths,
	})

	for (const imagePath of imagePaths) {
		await loadImage(
			imagePath,
			(dataUrl) => images.push(dataUrl),
			(errorMsg) => errors.push(`Failed to load image "${imagePath}": ${errorMsg}`),
			`Loaded image: ${imagePath}`,
			{ message: `Failed to load image: ${imagePath}` },
		)
	}
}

async function handleReferenceImages(
	text: string,
	imageReferences: Record<number, string>,
	images: string[],
	errors: string[],
): Promise<string> {
	const refs = extractImageReferences(text)
	if (refs.length === 0) {
		return text
	}

	await loadReferenceImages(refs, imageReferences, images, errors)
	return removeImageReferences(text)
}

async function handlePathMentions(
	text: string,
	images: string[],
	errors: string[],
): Promise<{ cleanedText: string; hasImages: boolean }> {
	const parsed = parseAtMentions(text)
	if (parsed.imagePaths.length === 0) {
		return { cleanedText: text, hasImages: images.length > 0 }
	}

	await loadPathImages(parsed.imagePaths, images, errors)
	return { cleanedText: removeImageMentions(text), hasImages: images.length > 0 }
}

export async function processMessageImages(
	text: string,
	imageReferences?: Record<number, string>,
): Promise<ProcessedMessage> {
	const images: string[] = []
	const errors: string[] = []

	let cleanedText = text
	if (imageReferences) {
		cleanedText = await handleReferenceImages(cleanedText, imageReferences, images, errors)
	}

	const { cleanedText: finalText, hasImages } = await handlePathMentions(cleanedText, images, errors)

	return {
		text: finalText,
		images,
		hasImages,
		errors,
	}
}
