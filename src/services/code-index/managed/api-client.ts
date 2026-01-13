// kilocode_change - new file
/**
 * API client for managed codebase indexing
 *
 * This module provides pure functions for communicating with the Kilo Code
 * backend API for managed indexing operations (upsert, search, delete, manifest).
 */

import { SearchRequest, SearchResult, ServerManifest } from "./types"
import { logger } from "../../../utils/logging"
import { getKiloBaseUriFromToken } from "../../../../packages/types/src/kilocode/kilocode"
import { fetchWithRetries } from "../../../shared/http"

export async function isEnabled(kilocodeToken: string, organizationId: string | null): Promise<boolean> {
	try {
		const baseUrl = getKiloBaseUriFromToken(kilocodeToken)
		let url = `${baseUrl}/api/code-indexing/enabled`
		if (organizationId) {
			url += `?${new URLSearchParams({ organizationId }).toString()}`
		}
		const response = await fetchWithRetries({
			url,
			method: "GET",
			retries: 2,
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
		})

		if (!response.ok) {
			console.error(`Failed to check if managed indexing is enabled: ${response.statusText}`)
			return false
		}

		const result = await response.json()
		return result.enabled
	} catch (error) {
		console.error(`Failed to check if managed indexing is enabled: ${error}`)
		return false
	}
}

/**
 * Searches code in the managed index with branch preferences
 *
 * @param request Search request with preferences
 * @param kilocodeToken Authentication token
 * @param signal Optional AbortSignal to cancel the request
 * @returns Array of search results sorted by relevance
 * @throws Error if the request fails
 */
export async function searchCode(
	request: SearchRequest,
	kilocodeToken: string,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const response = await fetchWithRetries({
			url: `${baseUrl}/api/code-indexing/search`,
			method: "POST",
			retries: 2,
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(request),
			signal,
		})

		if (!response.ok) {
			throw new Error(`Search failed: ${response.statusText}`)
		}

		const results: SearchResult[] = (await response.json()) || []
		logger.info(`Search returned ${results.length} results`)
		return results
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error(`Search failed: ${errorMessage}`)
		throw error
	}
}

/**
 * Parameters for upserting a file to the server
 */
export interface UpsertFileParams {
	/** The file content as a Buffer */
	fileBuffer: Buffer
	/** Organization ID (must be a valid UUID) */
	organizationId: string | null
	/** Project ID */
	projectId: string
	/** Relative file path from workspace root */
	filePath: string
	/** Hash of the file content */
	fileHash: string
	/** Git branch name (defaults to 'main') */
	gitBranch?: string
	/** Whether this is from a base branch (defaults to true) */
	isBaseBranch?: boolean
	/** Authentication token */
	kilocodeToken: string
}

/**
 * Upserts a file to the server using multipart file upload
 *
 * @param params Parameters for the file upload
 * @param signal Optional AbortSignal to cancel the request
 * @throws Error if the request fails
 */
export async function upsertFile(params: UpsertFileParams, signal?: AbortSignal): Promise<void> {
	const {
		fileBuffer,
		organizationId,
		projectId,
		filePath,
		fileHash,
		gitBranch = "main",
		isBaseBranch = true,
		kilocodeToken,
	} = params

	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		// Create FormData for multipart upload
		const formData = new FormData()

		// Append the file with metadata
		const filename = filePath.split("/").pop() || "file"
		formData.append("file", new Blob([fileBuffer as any]), filename)
		if (organizationId) {
			formData.append("organizationId", organizationId)
		}
		formData.append("projectId", projectId)
		formData.append("filePath", filePath)
		formData.append("fileHash", fileHash)
		formData.append("gitBranch", gitBranch)
		formData.append("isBaseBranch", String(isBaseBranch))

		const response = await fetchWithRetries({
			url: `${baseUrl}/api/code-indexing/upsert-by-file`,
			method: "PUT",
			retries: 2,
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
			},
			body: formData,
			signal,
		})

		if (!response.ok) {
			throw new Error(`Failed to upsert file: ${response.statusText}`)
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error(`Failed to upsert file ${filePath}: ${errorMessage}`)
		throw error
	}
}

/**
 * Gets the server manifest for a specific branch
 *
 * The manifest contains metadata about all indexed files on the branch,
 * allowing clients to determine what needs to be indexed.
 *
 * @param organizationId Organization ID
 * @param projectId Project ID
 * @param gitBranch Git branch name
 * @param kilocodeToken Authentication token
 * @param signal Optional AbortSignal to cancel the request
 * @returns Server manifest with file metadata
 * @throws Error if the request fails
 */
export async function getServerManifest(
	organizationId: string | null,
	projectId: string,
	gitBranch: string,
	kilocodeToken: string,
	signal?: AbortSignal,
): Promise<ServerManifest> {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const params = new URLSearchParams({
			projectId,
			gitBranch,
		})

		if (organizationId) {
			params.append("organizationId", organizationId)
		}

		const response = await fetchWithRetries({
			url: `${baseUrl}/api/code-indexing/manifest?${params.toString()}`,
			method: "GET",
			retries: 2,
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
			signal,
		})

		if (!response.ok) {
			throw new Error(`Failed to get manifest: ${response.statusText}`)
		}

		const manifest: ServerManifest = await response.json()
		logger.info(`Retrieved manifest for ${gitBranch}: ${manifest.totalFiles} files, ${manifest.totalChunks} chunks`)
		return manifest
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error(`Failed to get manifest: ${errorMessage}`)
		throw error
	}
}

/**
 * Parameters for deleting files from the server
 */
export interface DeleteFilesParams {
	/** Organization ID (must be a valid UUID) */
	organizationId: string | null
	/** Project ID */
	projectId: string
	/** Git branch name (optional) */
	gitBranch?: string
	/** Array of file paths to delete (optional - if not provided, deletes all files for the branch) */
	filePaths?: string[]
	/** Authentication token */
	kilocodeToken: string
}

/**
 * Deletes files from the server index
 *
 * @param params Parameters for the file deletion
 * @param signal Optional AbortSignal to cancel the request
 * @throws Error if the request fails
 */
export async function deleteFiles(params: DeleteFilesParams, signal?: AbortSignal): Promise<void> {
	const { organizationId, projectId, gitBranch, filePaths, kilocodeToken } = params

	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const requestBody: any = {
			projectId,
		}

		if (organizationId) {
			requestBody.organizationId = organizationId
		}

		if (gitBranch) {
			requestBody.gitBranch = gitBranch
		}

		if (filePaths) {
			requestBody.filePaths = filePaths
		}

		const response = await fetchWithRetries({
			url: `${baseUrl}/api/code-indexing/delete`,
			method: "POST",
			retries: 2,
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
			signal,
		})

		if (!response.ok) {
			throw new Error(`Failed to delete files: ${response.statusText}`)
		}

		logger.info(`Successfully deleted ${filePaths?.length || "all"} files from index`)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error(`Failed to delete files: ${errorMessage}`)
		throw error
	}
}
