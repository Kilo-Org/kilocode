/**
 * upsertPoints(points: Point[])
 * deletePointsByFilePath(path: string)
 * search(query: string, directory: string)
 *
 *
 * {
 *   query: string
 *   directory: string
 * }
 *
 * Example
 *
 * POST /organizations/:id/code/search {
 *   query: 'Code that looks like EventEmitter from node.js',
 *   directory: '/src/util',
 *   project_id: 'kilocode-backend'
 * } => Array<{
 *   id: uuid_v5,
 *   filePath: string
 *   codeChunk: string
 *   startLine: number
 *   endLine: number
 * }>
 */

import { v5 as uuidv5 } from "uuid"
import { CodeBlock } from "./interfaces"
import { generateNormalizedAbsolutePath, generateRelativeFilePath } from "./shared/get-relative-path"
import axios from "axios"
import { getKiloBaseUriFromToken } from "../../shared/kilocode/token"
import { X_KILOCODE_ORGANIZATIONID, X_KILOCODE_TESTER } from "../../shared/kilocode/headers"
import { logger } from "../../utils/logging"

interface KiloOrgCodeBlock {
	id: string
	organizationId: string
	projectId: string
	filePath: string
	codeChunk: string
	startLine: number
	endLine: number
}

interface IndexCodeFromCodeBlocksOptions {
	kilocodeToken: string
	organizationId: string
	projectId: string
	blocks: CodeBlock[]
	cwd: string
}

export async function indexFromCodeBlocks({
	blocks,
	cwd,
	kilocodeToken,
	organizationId,
	projectId,
}: IndexCodeFromCodeBlocksOptions): Promise<void> {
	console.log(
		`[indexFromCodeBlocks] Starting indexing for ${blocks.length} blocks, orgId=${organizationId}, projectId=${projectId}`,
	)

	const kiloOrgBlocks: KiloOrgCodeBlock[] = blocks.map((block, index) => {
		const normalizedAbsolutePath = generateNormalizedAbsolutePath(block.file_path, cwd)

		// Use segmentHash for unique ID generation to handle multiple segments from same line
		const pointId = uuidv5(block.segmentHash, organizationId)

		return {
			id: pointId,
			organizationId,
			projectId,
			filePath: generateRelativeFilePath(normalizedAbsolutePath, cwd),
			codeChunk: block.content,
			startLine: block.start_line,
			endLine: block.end_line,
			segmentHash: block.segmentHash,
		}
	})

	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)
	console.log(
		`[indexFromCodeBlocks] Sending ${kiloOrgBlocks.length} blocks to ${baseUrl}/api/codebase-indexing/upsert`,
	)

	const headers: Record<string, string> = {
		Authorization: `Bearer ${kilocodeToken}`,
		"Content-Type": "application/json",
	}

	try {
		const res = await axios({
			method: "PUT",
			url: `${baseUrl}/api/codebase-indexing/upsert`,
			data: kiloOrgBlocks,
			headers,
		})

		if (res.status !== 200) {
			logger.error(`Failed to index code blocks: ${res.statusText}`)
			console.error(`[indexFromCodeBlocks] Failed with status ${res.status}: ${res.statusText}`)
		} else {
			console.log(`[indexFromCodeBlocks] Successfully indexed ${kiloOrgBlocks.length} blocks`)
		}
	} catch (error) {
		console.error(`[indexFromCodeBlocks] Error:`, error)
		logger.error(`Failed to index code blocks: ${error instanceof Error ? error.message : String(error)}`)
		throw error
	}
}

interface SearchCodeOptions {
	kilocodeToken: string
	organizationId: string
	projectId: string
	query: string
	path?: string
}

interface KiloOrgSearchResult {
	id: string
	filePath: string
	codeChunk: string
	startLine: number
	endLine: number
	score: number
}

/**
 * Searches code blocks in the Kilo organization index
 */
export async function searchCode({
	kilocodeToken,
	organizationId,
	projectId,
	query,
	path: directoryPath,
}: SearchCodeOptions): Promise<KiloOrgSearchResult[]> {
	console.log(
		`[searchCode] Searching for query="${query}", orgId=${organizationId}, projectId=${projectId}, path=${directoryPath || "all"}`,
	)

	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)
	const headers: Record<string, string> = {
		Authorization: `Bearer ${kilocodeToken}`,
		"Content-Type": "application/json",
	}

	try {
		// organizationId
		// query
		// path
		// projectId
		const requestBody: SearchCodeOptions = {
			query,
			projectId,
			kilocodeToken,
			organizationId,
			path: directoryPath ?? "/",
		}

		const res = await axios({
			method: "POST",
			url: `${baseUrl}/api/codebase-indexing/search`,
			data: requestBody,
			headers,
		})

		if (res.status !== 200) {
			logger.error(`Failed to search code: ${res.statusText}`)
			console.error(`[searchCode] Failed with status ${res.status}: ${res.statusText}`)
			return []
		}

		const results: KiloOrgSearchResult[] = res.data || []
		console.log(`[searchCode] Found ${results.length} results`)
		return results
	} catch (error) {
		console.error(`[searchCode] Error:`, error)
		logger.error(`Failed to search code: ${error instanceof Error ? error.message : String(error)}`)
		throw error
	}
}

export async function indexBlocks(blocks: KiloOrgCodeBlock[]): Promise<void> {}
