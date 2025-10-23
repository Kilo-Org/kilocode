/**
 * API client for managed codebase indexing
 *
 * This module provides pure functions for communicating with the Kilo Code
 * backend API for managed indexing operations (upsert, search, delete, manifest).
 */

import axios from "axios"
import { getKiloBaseUriFromToken } from "../../../shared/kilocode/token"
import { ManagedCodeChunk, SearchRequest, SearchResult, ServerManifest } from "./types"
import { logger } from "../../../utils/logging"

/**
 * Upserts code chunks to the server
 *
 * @param chunks Array of chunks to upsert
 * @param kilocodeToken Authentication token
 * @throws Error if the request fails
 */
export async function upsertChunks(chunks: ManagedCodeChunk[], kilocodeToken: string): Promise<void> {
	if (chunks.length === 0) {
		return
	}

	console.log("upsertChunks", chunks)

	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const response = await axios({
			method: "PUT",
			url: `${baseUrl}/api/codebase-indexing/upsert`,
			data: chunks,
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
			url: `${baseUrl}/api/codebase-indexing/search`,
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
			url: `${baseUrl}/api/codebase-indexing/delete`,
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
			url: `${baseUrl}/api/codebase-indexing/manifest`,
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

/**
 * Deletes all chunks for a specific file on a specific branch
 *
 * This is a convenience wrapper around deleteFiles for single file operations.
 *
 * @param filePath File path to delete
 * @param gitBranch Git branch to delete from
 * @param organizationId Organization ID
 * @param projectId Project ID
 * @param kilocodeToken Authentication token
 */
export async function deleteFile(
	filePath: string,
	gitBranch: string,
	organizationId: string,
	projectId: string,
	kilocodeToken: string,
): Promise<void> {
	return deleteFiles([filePath], gitBranch, organizationId, projectId, kilocodeToken)
}

/**
 * Deletes all chunks for a specific branch
 *
 * @param organizationId Organization ID
 * @param projectId Project ID
 * @param gitBranch Git branch to delete
 * @param kilocodeToken Authentication token
 * @throws Error if the request fails
 */
export async function deleteBranchIndex(
	organizationId: string,
	projectId: string,
	gitBranch: string,
	kilocodeToken: string,
): Promise<void> {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const response = await axios({
			method: "DELETE",
			url: `${baseUrl}/api/codebase-indexing/branch`,
			data: {
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
			throw new Error(`Failed to delete branch index: ${response.statusText}`)
		}

		logger.info(`Successfully deleted branch index for ${gitBranch}`)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error(`Failed to delete branch index: ${errorMessage}`)
		throw error
	}
}

/**
 * Deletes all chunks for a project (all branches)
 *
 * @param organizationId Organization ID
 * @param projectId Project ID
 * @param kilocodeToken Authentication token
 * @throws Error if the request fails
 */
export async function deleteProjectIndex(
	organizationId: string,
	projectId: string,
	kilocodeToken: string,
): Promise<void> {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const response = await axios({
			method: "DELETE",
			url: `${baseUrl}/api/codebase-indexing/project`,
			data: {
				organizationId,
				projectId,
			},
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
		})

		if (response.status !== 200) {
			throw new Error(`Failed to delete project index: ${response.statusText}`)
		}

		logger.info(`Successfully deleted project index`)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error(`Failed to delete project index: ${errorMessage}`)
		throw error
	}
}
