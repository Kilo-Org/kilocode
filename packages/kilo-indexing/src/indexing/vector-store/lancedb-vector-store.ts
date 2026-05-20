import { createHash } from "crypto"
import * as path from "path"
import type { Connection, Table, VectorQuery } from "@lancedb/lancedb"
import type { IVectorStore } from "../interfaces/vector-store"
import type { Payload, VectorStoreSearchResult } from "../interfaces"
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE } from "../constants"
import fs from "fs"
import { Log } from "../../util/log"
import type { EmbeddingProfile } from "../embedding-profile"
import { loadLanceDB } from "./lancedb-loader"

const log = Log.create({ service: "lancedb-store" })

const KEY = {
  size: "vector_size",
  complete: "indexing_complete",
  provider: "embedding_provider",
  model: "embedding_model_id",
  dimension: "embedding_dimension",
}

/**
 * Local implementation of the vector store using LanceDB
 */
export class LanceDBVectorStore implements IVectorStore {
  private readonly vectorSize: number
  private readonly dbPath: string
  private readonly workspacePath: string
  private readonly profile: EmbeddingProfile
  private db: Connection | null = null
  private table: Table | null = null
  private readonly vectorTableName = "vector"
  private readonly metadataTableName = "metadata"
  private lancedbModule: any = null

  constructor(workspacePath: string, vectorSize: number, dbDirectory: string, profile?: EmbeddingProfile) {
    this.vectorSize = vectorSize
    this.workspacePath = workspacePath
    this.profile =
      profile ??
      ({
        provider: "openai",
        modelId: "",
        dimension: vectorSize,
      } as EmbeddingProfile)
    const basename = path.basename(workspacePath)
    // Generate database directory name from workspace path
    const hash = createHash("sha256").update(workspacePath).digest("hex")
    const dbName = `${basename}-${hash.substring(0, 16)}`
    // Set up database path
    this.dbPath = path.join(dbDirectory, dbName)
  }

  /**
   * Dynamically loads the LanceDB module.
   * @returns The LanceDB module.
   */
  private async loadLanceDBModule(): Promise<any> {
    if (this.lancedbModule) {
      return this.lancedbModule
    }

    try {
      this.lancedbModule = await loadLanceDB()
      return this.lancedbModule
    } catch (error: unknown) {
      log.error("Failed to load LanceDB module", { error })
      throw new Error(`Failed to load LanceDB module: ${(error as Error).message}`)
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
        key: KEY.size,
        value: this.vectorSize,
      },
      {
        key: KEY.provider,
        value: this.profile.provider,
      },
      {
        key: KEY.model,
        value: this.profile.modelId,
      },
      {
        key: KEY.dimension,
        value: this.profile.dimension,
      },
      {
        key: KEY.complete,
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
      const value = await this._getMetadataValue(db, KEY.size)
      if (value === undefined) return null
      const dim = this._parseNumber(value)
      return dim ?? null
    } catch (error) {
      log.warn("Failed to read metadata table", { error })
      return null
    }
  }

  private isValidMetadataKey(key: string): boolean {
    return Object.values(KEY).includes(key as (typeof KEY)[keyof typeof KEY])
  }

  private _parseNumber(value: unknown): number | undefined {
    const dim = Number(value)
    if (!Number.isFinite(dim) || dim <= 0) return undefined
    return dim
  }

  private async _getMetadataValue(db: Connection, key: string): Promise<unknown | undefined> {
    if (!this.isValidMetadataKey(key)) {
      throw new Error(`Invalid metadata key: ${key}`)
    }
    const metadataTable = await db.openTable(this.metadataTableName)
    const rows = await metadataTable.query().where(`key = '${key}'`).toArray()
    return rows.length > 0 ? rows[0].value : undefined
  }

  private async _getStoredEmbeddingProfile(db: Connection): Promise<EmbeddingProfile | undefined> {
    try {
      const provider = await this._getMetadataValue(db, KEY.provider)
      const modelId = await this._getMetadataValue(db, KEY.model)
      const dimension = await this._getMetadataValue(db, KEY.dimension)
      if (typeof provider !== "string" || typeof modelId !== "string") return undefined
      const dim = this._parseNumber(dimension)
      if (!dim) return undefined
      return {
        provider: provider as EmbeddingProfile["provider"],
        modelId,
        dimension: dim,
      }
    } catch (error) {
      log.warn("Failed to read embedding profile metadata", { error })
      return undefined
    }
  }

  private _isEmbeddingProfileMatch(profile: EmbeddingProfile): boolean {
    return (
      profile.provider === this.profile.provider &&
      profile.modelId === this.profile.modelId &&
      profile.dimension === this.profile.dimension
    )
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
        log.info("LanceDB store initialized", {
          workspacePath: this.workspacePath,
          dbPath: this.dbPath,
          created: true,
          vectorSize: this.vectorSize,
        })
        return true
      }

      this.table = await db.openTable(this.vectorTableName)

      const storedVectorSize = metadataTableExists ? await this._getStoredVectorSize(db) : null
      const pointCount = await this.table.countRows()

      if (storedVectorSize === null || storedVectorSize !== this.vectorSize) {
        needsRecreation = true
      }

      if (!needsRecreation && pointCount > 0) {
        const storedProfile = metadataTableExists ? await this._getStoredEmbeddingProfile(db) : undefined
        if (!storedProfile || !this._isEmbeddingProfileMatch(storedProfile)) {
          needsRecreation = true
        }
      }

      if (needsRecreation) {
        await this._dropTableIfExists(db, this.vectorTableName)
        await this._dropTableIfExists(db, this.metadataTableName)
        await this._createVectorTable(db)
        await this._createMetadataTable(db)
        this.optimizeTable()

        log.info("LanceDB store reinitialized for embedding profile change", {
          workspacePath: this.workspacePath,
          dbPath: this.dbPath,
          created: true,
          vectorSize: this.vectorSize,
        })

        return true
      }
      this.optimizeTable()
      log.info("LanceDB store initialized", {
        workspacePath: this.workspacePath,
        dbPath: this.dbPath,
        created: false,
        vectorSize: this.vectorSize,
      })
      return false
    } catch (error) {
      log.error("Failed to initialize LanceDB store", { error })
      throw new Error(`Failed to initialize LanceDB store: ${(error as Error).message}`, { cause: error })
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
        const bad = existingIds.find((id) => !this.isValidId(id))
        if (bad) {
          throw new Error(`Invalid point id format: ${bad}`)
        }
        const escapedIds = existingIds.map((id) => `'${this.escapeSqlString(id)}'`).join(", ")
        const idFilter = `id IN (${escapedIds})`
        await table.delete(idFilter)
      }

      // Insert new data
      await table.add(lanceData)
    } catch (error) {
      log.error("Failed to upsert points", { error })
      throw error
    }
  }

  // Temporary till lancedb implements parameter support
  // https://github.com/lance-format/lance/issues/2160
  private escapeSqlString(value: string): string {
    return value.replace(/'/g, "''")
  }

  private isValidId(id: string): boolean {
    // ASSUMPTION: Point IDs are uuidv5 values produced by scanner and file watcher.
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
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
      log.error("Failed to search points", { error })
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
      log.error("Failed to delete points by file paths", { error })
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
        log.error("Failed to clear collection and metadata", { error: clearError })
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
        log.warn("Failed to clear metadata table", { error: metadataError })
      }

      // Run optimization to clean up disk space after clearing
      await this.optimizeTable()
    } catch (error) {
      log.error("Failed to clear collection", { error })
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
      log.error("Failed to optimize table", { error })
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
        log.info("LanceDB has no indexed data", {
          workspacePath: this.workspacePath,
          reason: "points_zero",
        })
        return false
      }
      const metadataTable = await db.openTable(this.metadataTableName)
      const metadataResults = await metadataTable.query().where(`key = '${KEY.complete}'`).toArray()
      const indexed = metadataResults.length > 0 ? metadataResults[0].value : false
      log.info("LanceDB indexing metadata evaluated", {
        workspacePath: this.workspacePath,
        pointCount,
        indexed,
      })
      return indexed
    } catch (error) {
      log.warn("Failed to check if collection has data", { error })
      return false
    }
  }

  private async _upsertMetadata(metadataTable: Table, key: string, value: unknown): Promise<void> {
    if (!this.isValidMetadataKey(key)) {
      throw new Error(`Invalid metadata key: ${key}`)
    }
    await metadataTable.delete(`key = '${key}'`)
    await metadataTable.add([{ key, value }])
  }

  private async _persistEmbeddingProfile(metadataTable: Table): Promise<void> {
    await this._upsertMetadata(metadataTable, KEY.provider, this.profile.provider)
    await this._upsertMetadata(metadataTable, KEY.model, this.profile.modelId)
    await this._upsertMetadata(metadataTable, KEY.dimension, this.profile.dimension)
    await this._upsertMetadata(metadataTable, KEY.size, this.vectorSize)
  }

  /**
   * Marks the indexing process as complete by storing metadata
   * Should be called after a successful full workspace scan or incremental scan
   */
  async markIndexingComplete(): Promise<void> {
    try {
      const db = await this.getDb()
      const metadataTable = await db.openTable(this.metadataTableName)
      await this._persistEmbeddingProfile(metadataTable)
      await this._upsertMetadata(metadataTable, KEY.complete, true)
      log.info("Marked indexing as complete")
    } catch (error) {
      log.error("Failed to mark indexing as complete", { error })
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
      await this._persistEmbeddingProfile(metadataTable)
      await this._upsertMetadata(metadataTable, KEY.complete, false)
      log.info("Marked indexing as incomplete (in progress)")
    } catch (error) {
      log.error("Failed to mark indexing as incomplete", { error })
      throw error
    }
  }
}
