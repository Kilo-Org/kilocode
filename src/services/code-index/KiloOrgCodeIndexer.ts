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
	filePath: string
	codeChunk: string
	startLine: number
	endLine: number
}

interface IndexCodeFromCodeBlocksOptions {
	kilocodeToken: string
	organizationId: string
	blocks: CodeBlock[]
	cwd: string
}

export async function indexFromCodeBlocks({
	blocks,
	cwd,
	kilocodeToken,
	organizationId,
}: IndexCodeFromCodeBlocksOptions): Promise<void> {
	const kiloOrgBlocks: KiloOrgCodeBlock[] = blocks.map((block, index) => {
		const normalizedAbsolutePath = generateNormalizedAbsolutePath(block.file_path, cwd)

		// Use segmentHash for unique ID generation to handle multiple segments from same line
		const pointId = uuidv5(block.segmentHash, `kilocode-org-${organizationId}`)

		return {
			id: pointId,
			organizationId,
			filePath: generateRelativeFilePath(normalizedAbsolutePath, cwd),
			codeChunk: block.content,
			startLine: block.start_line,
			endLine: block.end_line,
			segmentHash: block.segmentHash,
		}
	})

	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)
	const headers: Record<string, string> = {
		Authorization: `Bearer ${kilocodeToken}`,
		"Content-Type": "application/json",
	}

	const res = await axios({
		method: "PUT",
		url: `${baseUrl}/api/codebase-indexing/upsert`,
		data: kiloOrgBlocks,
		headers,
	})

	if (res.status !== 200) {
		logger.error(`Failed to index code blocks: ${res.statusText}`)
	}
}

export async function indexBlocks(blocks: KiloOrgCodeBlock[]): Promise<void> {}
