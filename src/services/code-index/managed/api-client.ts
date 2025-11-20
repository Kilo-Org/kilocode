// kilocode_change - new file
/**
 * API client for managed codebase indexing
 *
 * This module provides pure functions for communicating with the Kilo Code
 * backend API for managed indexing operations (upsert, search, delete, manifest).
 */

import axios from "axios"
import { ManagedCodeChunk, SearchRequest, SearchResult, ServerManifest } from "./types"
import { logger } from "../../../utils/logging"
import { getKiloBaseUriFromToken } from "../../../../packages/types/src/kilocode/kilocode"

/**
 * Upserts code chunks to the server using the new envelope format
 *
 * @param chunks Array of chunks to upsert (must all be from same org/project/branch)
 * @param kilocodeToken Authentication token
 * @throws Error if the request fails or chunks are from different contexts
 */
export async function upsertChunks(chunks: ManagedCodeChunk[], kilocodeToken: string): Promise<void> {
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
		const response = await axios({
			method: "PUT",
			url: `${baseUrl}/api/code-indexing/upsert`,
			data: requestBody,
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
		})

		if (response.status !== 200) {
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
 * @returns Array of search results sorted by relevance
 * @throws Error if the request fails
 */
export async function searchCode(request: SearchRequest, kilocodeToken: string): Promise<SearchResult[]> {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const response = await axios({
			method: "POST",
			url: `${baseUrl}/api/code-indexing/search`,
			data: request,
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
		})

		if (response.status !== 200) {
			throw new Error(`Search failed: ${response.statusText}`)
		}

		const results: SearchResult[] = response.data || []
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
 * @throws Error if the request fails
 */
export async function deleteFiles(
	filePaths: string[],
	gitBranch: string,
	organizationId: string,
	projectId: string,
	kilocodeToken: string,
): Promise<void> {
	if (filePaths.length === 0) {
		return
	}

	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const response = await axios({
			method: "PUT",
			url: `${baseUrl}/api/code-indexing/delete`,
			data: {
				organizationId,
				projectId,
				gitBranch,
				filePaths,
			},
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
		})

		if (response.status !== 200) {
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
 * Gets the server manifest for a specific branch
 *
 * The manifest contains metadata about all indexed files on the branch,
 * allowing clients to determine what needs to be indexed.
 *
 * @param organizationId Organization ID
 * @param projectId Project ID
 * @param gitBranch Git branch name
 * @param kilocodeToken Authentication token
 * @returns Server manifest with file metadata
 * @throws Error if the request fails
 */
export async function getServerManifest(
	organizationId: string,
	projectId: string,
	gitBranch: string,
	kilocodeToken: string,
): Promise<ServerManifest> {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const response = await axios({
			method: "GET",
			url: `${baseUrl}/api/code-indexing/manifest`,
			params: {
				organizationId,
				projectId,
				gitBranch,
			},
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
		})

		if (response.status !== 200) {
			throw new Error(`Failed to get manifest: ${response.statusText}`)
		}

		const manifest: ServerManifest = response.data
		logger.info(`Retrieved manifest for ${gitBranch}: ${manifest.totalFiles} files, ${manifest.totalChunks} chunks`)
		return manifest
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error(`Failed to get manifest: ${errorMessage}`)
		throw error
	}
}
