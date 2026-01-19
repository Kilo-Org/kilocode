/**
 * Utility functions for image handling in the CLI.
 * Provides conversion between file paths and data URLs.
 */

import { processImagePaths } from "./images.js"
import { logs } from "../services/logs.js"

/**
 * Check if a string is a data URL (starts with "data:")
 */
export function isDataUrl(str: string): boolean {
	return str.startsWith("data:")
}

/**
 * Convert image paths to data URLs if needed.
 * If images are already data URLs, they are passed through unchanged.
 * If images are file paths, they are read and converted to data URLs.
 *
 * @param images Array of image paths or data URLs
 * @param logContext Optional context string for error logging
 * @returns Array of data URLs (or undefined if no valid images)
 */
export async function convertImagesToDataUrls(
	images: string[] | undefined,
	logContext: string = "image-utils",
): Promise<string[] | undefined> {
	if (!images || images.length === 0) {
		return undefined
	}

	// Separate data URLs from file paths
	const dataUrls: string[] = []
	const filePaths: string[] = []

	for (const image of images) {
		if (isDataUrl(image)) {
			dataUrls.push(image)
		} else {
			filePaths.push(image)
		}
	}

	// If all images are already data URLs, return them directly
	if (filePaths.length === 0) {
		return dataUrls.length > 0 ? dataUrls : undefined
	}

	// Convert file paths to data URLs
	const result = await processImagePaths(filePaths)

	if (result.errors.length > 0) {
		for (const error of result.errors) {
			logs.error(`Failed to load image "${error.path}": ${error.error}`, logContext)
		}
	}

	// Combine existing data URLs with newly converted ones
	const allDataUrls = [...dataUrls, ...result.images]
	return allDataUrls.length > 0 ? allDataUrls : undefined
}
