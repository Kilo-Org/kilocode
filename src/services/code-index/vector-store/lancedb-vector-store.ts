// kilocode_change - new file

import { createHash } from "crypto"
import * as path from "path"
import { Connection, Table, VectorQuery } from "@lancedb/lancedb"
import { IVectorStore } from "../interfaces/vector-store"
import { Payload, VectorStoreSearchResult } from "../interfaces"
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE } from "../constants"
import { t } from "../../../i18n"
import { LanceDBManager } from "../../../utils/lancedb-manager"
const fs = require("fs")

/**
 * Local implementation of the vector store using LanceDB
 */
export class LanceDBVectorStore implements IVectorStore {
	private readonly vectorSize: number
	private readonly dbPath: string
	private readonly workspacePath: string
	private db: Connection | null = null
	private table: Table | null = null
	private readonly vectorTableName = "vector"
	private readonly metadataTableName = "metadata"
	private lancedbManager: LanceDBManager
	private lancedbModule: any = null

	constructor(workspacePath: string, vectorSize: number, dbDirectory: string, lancedbManager: LanceDBManager) {
		this.vectorSize = vectorSize
		this.workspacePath = workspacePath
		const basename = path.basename(workspacePath)
		// Generate database directory name from workspace path
		const hash = createHash("sha256").update(workspacePath).digest("hex")
		const dbName = `${basename}-${hash.substring(0, 16)}`
		// Set up database path
		this.dbPath = path.join(dbDirectory, dbName)
		this.lancedbManager = lancedbManager
	}

	/**
	 * Dynamically loads the LanceDB module.
	 * @returns The LanceDB module.
	 */
	private async loadLanceDBModule(): Promise<any> {
		if (this.lancedbModule) {
			return this.lancedbModule
		}

		// Ensure LanceDB dependencies are available
		await this.lancedbManager.ensureLanceDBAvailable()

		const nodeModulesPath = this.lancedbManager.getNodeModulesPath()

		// Add the custom node_modules path to the module search paths
		// This should be done before requiring the module
		if (!module.paths.includes(nodeModulesPath)) {
			module.paths.unshift(nodeModulesPath)
		}

		try {
			// Dynamically import LanceDB
			this.lancedbModule = require("@lancedb/lancedb")
			return this.lancedbModule
		} catch (error: unknown) {
			console.error("Failed to load LanceDB module:", error)
			throw new Error(t("embeddings:vectorStore.lancedbLoadFailed", { errorMessage: (error as Error).message }))
		}
	}

	/**
	 * Gets or connects to the LanceDB database.
	 * @returns The LanceDB connection.
	 */
	private async getDb(): Promise<Connection> {
		if (this.db) {
			return this.db
		}

		const lancedb = await this.loadLanceDBModule()

		// Create parent directory if needed
		if (!fs.existsSync(this.dbPath)) {
			fs.mkdirSync(this.dbPath, { recursive: true })
		}

		this.db = await lancedb.connect(this.dbPath)
		return this.db as Connection
	}

	/**
	 * Gets or opens the vector table.
	 * @returns The LanceDB table.
	 */
	private async getTable(): Promise<Table> {
		if (this.table) {
			return this.table
		}

		const db = await this.getDb()

		try {
			// Try to open existing table
			const table = await db.openTable(this.vectorTableName)
			this.table = table
			return table
		} catch (error) {
			// Table doesn't exist, will be created in initialize()
			throw new Error(`Table ${this.vectorTableName} does not exist`)
		}
	}

	/**
	 * Creates sample data for the vector table schema.
	 * @returns An array containing sample data.
	 */
	private _createSampleData() {
		return [
			{
				id: "sample",
				vector: new Array(this.vectorSize).fill(0),
				filePath: "sample",
				codeChunk: "sample",
				startLine: 0,
				endLine: 0,
			},
		]
	}

	/**
	 * Creates metadata for the vector size.
	 * @returns An array containing metadata.
	 */
	private _createMetadataData() {
		return [
			{
				key: "vector_size",
				value: this.vectorSize,
			},
			{
				key: "indexing_complete",
				value: false,
			},
		]
	}

	/**
	 * Creates the vector table and deletes the sample data.
	 * @param db The LanceDB connection.
	 */
	private async _createVectorTable(db: Connection): Promise<void> {
		this.table = await db.createTable(this.vectorTableName, this._createSampleData())
		if (this.table) {
			await this.table.delete("id = 'sample'")
		}
	}

	/**
	 * Creates the metadata table.
	 * @param db The LanceDB connection.
	 */
	private async _createMetadataTable(db: Connection): Promise<void> {
		await db.createTable(this.metadataTableName, this._createMetadataData())
	}

	/**
	 * Drops a table if it exists.
	 * @param db The LanceDB connection.
	 * @param tableName The name of the table to drop.
	 */
	private async _dropTableIfExists(db: Connection, tableName: string): Promise<void> {
		const tableNames = await db.tableNames()
		if (tableNames.includes(tableName)) {
			await db.dropTable(tableName)
		}
	}

	/**
	 * Retrieves the stored vector size from the metadata table.
	 * @param db The LanceDB connection.
	 * @returns The stored vector size, or null if not found.
	 */
	private async _getStoredVectorSize(db: Connection): Promise<number | null> {
		try {
			const metadataTable = await db.openTable(this.metadataTableName)
			const metadataResults = await metadataTable.query().where("key = 'vector_size'").toArray()
			return metadataResults.length > 0 ? metadataResults[0].value : null
		} catch (error) {
			console.warn("Failed to read metadata table:", error)
			return null
		}
	}

	async initialize(): Promise<boolean> {
		try {
			await this.closeConnect()
			const db = await this.getDb()

			const tableNames = await db.tableNames()
			const vectorTableExists = tableNames.includes(this.vectorTableName)
			const metadataTableExists = tableNames.includes(this.metadataTableName)

			let needsRecreation = false

			if (!vectorTableExists) {
				await this._createVectorTable(db)
				await this._createMetadataTable(db)
				return true
			}

			this.table = await db.openTable(this.vectorTableName)

			const storedVectorSize = metadataTableExists ? await this._getStoredVectorSize(db) : null

			if (storedVectorSize === null || storedVectorSize !== this.vectorSize) {
				needsRecreation = true
			}

			if (needsRecreation) {
				await this._dropTableIfExists(db, this.vectorTableName)
				await this._dropTableIfExists(db, this.metadataTableName)
				await this._createVectorTable(db)
				await this._createMetadataTable(db)
				this.optimizeTable()

				return true
			}
			this.optimizeTable()
			return false
		} catch (error) {
			console.error(`[LocalVectorStore] Failed to initialize:`, error)
			throw new Error(t("embeddings:vectorStore.lancedbStoreInitFailed", { errorMessage: error.message }))
		}
	}

	async upsertPoints(
		points: Array<{
			id: string
			vector: number[]
			payload: Record<string, any>
		}>,
	): Promise<void> {
		if (points.length === 0) {
			return
		}

		const table = await this.getTable()
		const valids = points.filter((point) => this.isPayloadValid(point.payload))

		if (valids.length === 0) {
			return
		}

		try {
			// Convert points to LanceDB format
			const lanceData = valids.map((point) => ({
				id: point.id,
				vector: point.vector,
				filePath: point.payload.filePath,
				codeChunk: point.payload.codeChunk,
				startLine: point.payload.startLine,
				endLine: point.payload.endLine,
			}))

			// Delete existing points with same IDs first
			const existingIds = lanceData.map((d) => d.id)
			if (existingIds.length > 0) {
				const escapedIds = existingIds.map((id) => `'${this.escapeSqlString(id)}'`).join(", ")
				const idFilter = `id IN (${escapedIds})`
				await table.delete(idFilter)
			}

			// Insert new data
			await table.add(lanceData)
		} catch (error) {
			console.error("Failed to upsert points:", error)
			throw error
		}
	}

	// Temporary till lancedb implements parameter support
	// https://github.com/lance-format/lance/issues/2160
	private escapeSqlString(value: string): string {
		return value.replace(/'/g, "''")
	}

	private escapeSqlLikePattern(pattern: string): string {
		let escaped = this.escapeSqlString(pattern)
		escaped = escaped.replace(/\\/g, "\\\\")
		escaped = escaped.replace(/%/g, "\\%").replace(/_/g, "\\_")

		return escaped
	}

	private isPayloadValid(payload: Record<string, unknown> | null | undefined): payload is Payload {
		if (!payload) {
			return false
		}
		const validKeys = ["filePath", "codeChunk", "startLine", "endLine"]
		const hasValidKeys = validKeys.every((key) => key in payload)
		return hasValidKeys
	}

	async search(
		queryVector: number[],
		directoryPrefix?: string,
		minScore?: number,
		maxResults?: number,
	): Promise<VectorStoreSearchResult[]> {
		try {
			const table = await this.getTable()
			const actualMinScore = minScore ?? DEFAULT_SEARCH_MIN_SCORE
			const actualMaxResults = maxResults ?? DEFAULT_MAX_SEARCH_RESULTS

			// Build filter condition
			let filter = ""
			if (directoryPrefix) {
				const escapedPrefix = this.escapeSqlLikePattern(directoryPrefix)
				filter = `\`filePath\` LIKE '${escapedPrefix}%'`
			}

			// Perform vector search with distance range filtering
			let searchQuery = (await table.search(queryVector)) as VectorQuery
			if (filter !== "") {
				searchQuery = searchQuery.where(filter)
			}
			searchQuery = searchQuery
				.distanceType("cosine")
				.distanceRange(0, 1 - actualMinScore)
				.limit(actualMaxResults)

			const list = await searchQuery.toArray()
			const results = list.map((result: any) => ({
				id: result.id,
				score: 1 - result._distance, // Convert distance to similarity score
				payload: {
					filePath: result.filePath,
					codeChunk: result.codeChunk,
					startLine: result.startLine,
					endLine: result.endLine,
				} as Payload,
			}))

			return results
		} catch (error) {
			console.error("Failed to search points:", error)
			throw error
		}
	}

	async deletePointsByFilePath(filePath: string): Promise<void> {
		return this.deletePointsByMultipleFilePaths([filePath])
	}

	async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
		if (filePaths.length === 0) {
			return
		}

		try {
			const table = await this.getTable()
			const workspaceRoot = this.workspacePath
			const normalizedPaths = filePaths.map((fp) =>
				path.normalize(path.isAbsolute(fp) ? path.relative(workspaceRoot, fp) : fp),
			)

			// Create filter condition for multiple file paths
			const escapedPaths = normalizedPaths.map((fp) => `'${this.escapeSqlString(fp)}'`).join(", ")
			const filterCondition = `\`filePath\` IN (${escapedPaths})`
			await table.delete(filterCondition)
		} catch (error) {
			console.error("Failed to delete points by file paths:", error)
			throw error
		}
	}

	async deleteCollection(): Promise<void> {
		await this.closeConnect()
		try {
			if (fs.existsSync(this.dbPath)) {
				fs.rmSync(this.dbPath, { recursive: true, force: true })
			}
		} catch (error) {
			// If file deletion fails, try to clear the collection and metadata table
			try {
				const db = await this.getDb()
				await this._dropTableIfExists(db, this.vectorTableName)
				await this._dropTableIfExists(db, this.metadataTableName)
			} catch (clearError) {
				console.error("Failed to clear collection and metadata:", clearError)
			}
			throw error
		}
	}

	async clearCollection(): Promise<void> {
		try {
			const table = await this.getTable()
			// Delete all records from the table
			await table.delete("true") // Delete all records

			// Also clear metadata table
			try {
				const db = await this.getDb()
				const tableNames = await db.tableNames()

				if (tableNames.includes(this.metadataTableName)) {
					const metadataTable = await db.openTable(this.metadataTableName)
					await metadataTable.delete("true")
				}
			} catch (metadataError) {
				console.warn("Failed to clear metadata table:", metadataError)
			}

			// Run optimization to clean up disk space after clearing
			await this.optimizeTable()
		} catch (error) {
			console.error("Failed to clear collection:", error)
			throw error
		}
	}

	async collectionExists(): Promise<boolean> {
		try {
			const db = await this.getDb()
			const tableNames = await db.tableNames()
			return tableNames.includes(this.vectorTableName)
		} catch (error) {
			return false
		}
	}

	private async closeConnect(): Promise<void> {
		if (this.table) {
			this.table = null
		}
		if (this.db) {
			await this.db.close()
			this.db = null
		}
	}

	/**
	 * Optimizes the table to reduce disk space usage and improve performance.
	 * This method performs compaction, pruning of old versions, and index optimization.
	 * Should be called periodically to prevent unbounded disk space growth.
	 */
	async optimizeTable(): Promise<void> {
		try {
			const table = await this.getTable()

			await table.optimize({
				cleanupOlderThan: new Date(),
				deleteUnverified: false,
			})
		} catch (error) {
			console.error("[LocalVectorStore] Failed to optimize table:", error)
		}
	}

	/**
	 * Checks if the collection exists and has indexed points
	 * @returns Promise resolving to boolean indicating if the collection exists and has points
	 */
	async hasIndexedData(): Promise<boolean> {
		try {
			const db = await this.getDb()
			const table = await this.getTable()
			const pointCount = await table.countRows()
			if (pointCount === 0) {
				return false
			}
			const metadataTable = await db.openTable(this.metadataTableName)
			const metadataResults = await metadataTable.query().where("key = 'indexing_complete'").toArray()
			return metadataResults.length > 0 ? metadataResults[0].value : false
		} catch (error) {
			console.warn("[LanceDbVectorStore] Failed to check if collection has data:", error)
			return false
		}
	}

	/**
	 * Marks the indexing process as complete by storing metadata
	 * Should be called after a successful full workspace scan or incremental scan
	 */
	async markIndexingComplete(): Promise<void> {
		try {
			const db = await this.getDb()
			const metadataTable = await db.openTable(this.metadataTableName)
			metadataTable.update({ values: { value: true }, where: "key = 'indexing_complete'" })
			console.log("[LanceDbVectorStore] Marked indexing as complete")
		} catch (error) {
			console.error("[LanceDbVectorStore] Failed to mark indexing as complete:", error)
			throw error
		}
	}

	/**
	 * Marks the indexing process as incomplete by storing metadata
	 * Should be called at the start of indexing to indicate work in progress
	 */
	async markIndexingIncomplete(): Promise<void> {
		try {
			const db = await this.getDb()
			const metadataTable = await db.openTable(this.metadataTableName)
			metadataTable.update({ values: { value: false }, where: "key = 'indexing_complete'" })
			console.log("[LanceDbVectorStore] Marked indexing as complete")
			console.log("[LanceDbVectorStore] Marked indexing as incomplete (in progress)")
		} catch (error) {
			console.error("[LanceDbVectorStore] Failed to mark indexing as incomplete:", error)
			throw error
		}
	}
}
