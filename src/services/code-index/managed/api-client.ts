// kilocode_change - new file
/**
 * API client for managed codebase indexing
 *
 * This module provides pure functions for communicating with the Kilo Code
 * backend API for managed indexing operations (upsert, search, delete, manifest).
 */

import { ManagedCodeChunk, SearchRequest, SearchResult, ServerManifest } from "./types"
import { logger } from "../../../utils/logging"
import { getKiloBaseUriFromToken } from "../../../../packages/types/src/kilocode/kilocode"
import { fetchWithRetries } from "../../../shared/http"

/**
 * Upserts code chunks to the server using the new envelope format
 *
 * @param chunks Array of chunks to upsert (must all be from same org/project/branch)
 * @param kilocodeToken Authentication token
 * @param signal Optional AbortSignal to cancel the request
 * @throws Error if the request fails or chunks are from different contexts
 */
export async function upsertChunks(
	chunks: ManagedCodeChunk[],
	kilocodeToken: string,
	signal?: AbortSignal,
): Promise<void> {
	if (chunks.length === 0) {
		return
	}

	// Validate all chunks are from same context
	const firstChunk = chunks[0]
	const allSameContext = chunks.every(
		(c) =>
			c.organizationId === firstChunk.organizationId &&
			c.projectId === firstChunk.projectId &&
			c.gitBranch === firstChunk.gitBranch &&
			c.isBaseBranch === firstChunk.isBaseBranch,
	)

	if (!allSameContext) {
		throw new Error("All chunks must be from the same organization, project, and branch")
	}

	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	// Transform to new envelope format
	const requestBody = {
		organizationId: firstChunk.organizationId,
		projectId: firstChunk.projectId,
		gitBranch: firstChunk.gitBranch,
		isBaseBranch: firstChunk.isBaseBranch,
		chunks: chunks.map((chunk) => ({
			id: chunk.id,
			codeChunk: chunk.codeChunk,
			filePath: chunk.filePath,
			startLine: chunk.startLine,
			endLine: chunk.endLine,
			chunkHash: chunk.chunkHash,
		})),
	}

	try {
		const response = await fetchWithRetries({
			url: `${baseUrl}/api/code-indexing/upsert`,
			method: "PUT",
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
			signal,
		})

		if (!response.ok) {
			throw new Error(`Failed to upsert chunks: ${response.statusText}`)
		}

		logger.info(`Successfully upserted ${chunks.length} chunks`)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error(`Failed to upsert chunks: ${errorMessage}`)
		throw error
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
 * Deletes chunks for specific files on a specific branch
 *
 * @param filePaths Array of file paths to delete
 * @param gitBranch Git branch to delete from
 * @param organizationId Organization ID
 * @param projectId Project ID
 * @param kilocodeToken Authentication token
 * @param signal Optional AbortSignal to cancel the request
 * @throws Error if the request fails
 */
export async function deleteFiles(
	filePaths: string[],
	gitBranch: string,
	organizationId: string,
	projectId: string,
	kilocodeToken: string,
	signal?: AbortSignal,
): Promise<void> {
	if (filePaths.length === 0) {
		return
	}

	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const response = await fetchWithRetries({
			url: `${baseUrl}/api/code-indexing/delete`,
			method: "PUT",
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				organizationId,
				projectId,
				gitBranch,
				filePaths,
			}),
			signal,
		})

		if (!response.ok) {
			throw new Error(`Failed to delete files: ${response.statusText}`)
		}

		logger.info(`Successfully deleted ${filePaths.length} files from branch ${gitBranch}`)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error(`Failed to delete files: ${errorMessage}`)
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
	organizationId: string
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
		formData.append("organizationId", organizationId)
		formData.append("projectId", projectId)
		formData.append("filePath", filePath)
		formData.append("fileHash", fileHash)
		formData.append("gitBranch", gitBranch)
		formData.append("isBaseBranch", String(isBaseBranch))

		const response = await fetchWithRetries({
			url: `${baseUrl}/api/code-indexing/upsert-by-file`,
			method: "PUT",
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
	organizationId: string,
	projectId: string,
	gitBranch: string,
	kilocodeToken: string,
	signal?: AbortSignal,
): Promise<ServerManifest> {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const params = new URLSearchParams({
			organizationId,
			projectId,
			gitBranch,
		})

		const response = await fetchWithRetries({
			url: `${baseUrl}/api/code-indexing/manifest?${params.toString()}`,
			method: "GET",
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
