import { existsSync } from "fs"
import { extname } from "node:path"
import { SUPPORTED_IMAGE_EXTENSIONS, SupportedImageExtension } from "../media/images.js"

export interface AttachmentValidationResult {
	valid: boolean
	error?: string
}

/**
 * Validates that --attach requires --auto or --json-io flag.
 * Attachments can be used in autonomous mode or json-io mode (for Agent Manager).
 */
export function validateAttachRequiresAuto(options: {
	attach?: string[]
	auto?: boolean
	jsonIo?: boolean
}): AttachmentValidationResult {
	const attachments = options.attach || []
	if (attachments.length > 0) {
		if (!options.auto && !options.jsonIo) {
			return {
				valid: false,
				error: "Error: --attach option requires --auto or --json-io flag",
			}
		}
	}
	return { valid: true }
}

/**
 * Commander.js accumulator function for --attach flag.
 * Allows multiple --attach flags to accumulate into an array.
 */
export function accumulateAttachments(value: string, previous: string[]): string[] {
	return previous.concat([value])
}

export interface AttachmentsValidationResult {
	valid: boolean
	errors: string[]
}

/**
 * Validates that an attachment file exists
 */
export function validateAttachmentExists(attachPath: string): AttachmentValidationResult {
	if (!existsSync(attachPath)) {
		return {
			valid: false,
			error: `Error: Attachment file not found: ${attachPath}`,
		}
	}
	return { valid: true }
}

/**
 * Validates that an attachment has a supported format
 */
export function validateAttachmentFormat(attachPath: string): AttachmentValidationResult {
	const ext = extname(attachPath).toLowerCase()
	if (!SUPPORTED_IMAGE_EXTENSIONS.includes(ext as SupportedImageExtension)) {
		return {
			valid: false,
			error: `Error: Unsupported attachment format "${ext}". Currently supported: ${SUPPORTED_IMAGE_EXTENSIONS.join(", ")}. Other file types can be read using @path mentions or the read_file tool.`,
		}
	}
	return { valid: true }
}

/**
 * Validates all attachments for existence and format
 */
export function validateAttachments(attachments: string[]): AttachmentsValidationResult {
	const errors: string[] = []

	if (attachments.length === 0) {
		return { valid: true, errors: [] }
	}

	// Validate each attachment
	for (const attachPath of attachments) {
		// Check existence
		const existsResult = validateAttachmentExists(attachPath)
		if (!existsResult.valid && existsResult.error) {
			errors.push(existsResult.error)
			continue
		}

		// Check format
		const formatResult = validateAttachmentFormat(attachPath)
		if (!formatResult.valid && formatResult.error) {
			errors.push(formatResult.error)
		}
	}

	return { valid: errors.length === 0, errors }
}
