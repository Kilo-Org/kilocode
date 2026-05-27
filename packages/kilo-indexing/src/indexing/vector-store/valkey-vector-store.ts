import { createHash } from "node:crypto"
import { Batch, GlideClient, GlideFt, ClosingError, RequestError } from "@valkey/valkey-glide"
import type { Field, FtCreateOptions, GlideString } from "@valkey/valkey-glide"
import type { IVectorStore, VectorStoreSearchResult } from "../interfaces/vector-store"
import type { PointStruct } from "../interfaces/vector-store"
import type { EmbeddingProfile } from "../embedding-profile"
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE } from "../constants"
import { Log } from "../../util/log"

const log = Log.create({ service: "valkey-store" })

const KEY = {
  complete: "indexing_complete",
  provider: "embedding_provider",
  model: "embedding_model_id",
  dimension: "embedding_dimension",
}

/**
 * Valkey implementation of the vector store interface using ValkeySearch commands.
 * Uses the @valkey/valkey-glide client library with its GlideFt module for
 * ValkeySearch operations (FT.CREATE, FT.SEARCH, FT.DROPINDEX, FT.INFO).
 */
export class ValkeyVectorStore implements IVectorStore {
  private client: GlideClient | null = null
  private connectingPromise: Promise<GlideClient> | null = null
  private readonly collectionName: string
  private readonly metadataKey: string
  private readonly vectorSize: number
  private readonly profile: EmbeddingProfile
  private readonly valkeyUrl: string
  private readonly valkeyPassword?: string

  constructor(workspacePath: string, url: string, vectorSize: number, password?: string, profile?: EmbeddingProfile) {
    this.valkeyUrl = this.normalizeUrl(url)
    this.valkeyPassword = password
    this.vectorSize = vectorSize
    this.profile =
      profile ??
      ({
        provider: "openai",
        modelId: "",
        dimension: vectorSize,
      } as EmbeddingProfile)

    const hash = createHash("sha256").update(workspacePath).digest("hex")
    this.collectionName = `ws-${hash.substring(0, 16)}`
    this.metadataKey = `${this.collectionName}:__metadata__`
  }

  async initialize(): Promise<boolean> {
    await this.ensureConnected()

    const info = await this.getIndexInfo()

    if (info === null) {
      await this.createIndex()
      return true
    }

    const existingDimension = this.parseDimensionFromInfo(info)
    if (existingDimension !== this.vectorSize) {
      log.warn("Index dimension mismatch, recreating", {
        collection: this.collectionName,
        existingDimension,
        expectedDimension: this.vectorSize,
      })
      await this.dropIndex()
      await this.createIndex()
      return true
    }

    const numDocs = this.parseNumDocsFromInfo(info)
    if (numDocs === 0) {
      return false
    }

    const storedProfile = await this.getStoredProfile()
    if (!storedProfile) {
      log.info("No stored embedding profile found, recreating index", {
        collection: this.collectionName,
      })
      await this.dropIndex()
      await this.createIndex()
      return true
    }

    if (
      storedProfile.provider !== this.profile.provider ||
      storedProfile.modelId !== this.profile.modelId ||
      storedProfile.dimension !== this.profile.dimension
    ) {
      log.info("Embedding profile mismatch, recreating index", {
        collection: this.collectionName,
        stored: storedProfile,
        current: this.profile,
      })
      await this.dropIndex()
      await this.createIndex()
      return true
    }

    return false
  }

  private parseDimensionFromInfo(info: Record<string, any>): number {
    const fields = info.fields
    if (!Array.isArray(fields)) {
      return 0
    }

    for (const field of fields) {
      if (field && typeof field === "object") {
        if (field.type === "VECTOR" && field.vector_params) {
          const dimension = field.vector_params.dimension
          if (typeof dimension === "number") {
            return dimension
          }
        }
      }
    }

    return 0
  }

  private parseNumDocsFromInfo(info: Record<string, any>): number {
    const numDocs = info.num_docs
    if (typeof numDocs === "number") {
      return numDocs
    }
    return 0
  }

  private async setMetadata(complete: boolean): Promise<void> {
    const client = await this.ensureConnected()
    const fields: Record<string, string> = {
      type: "metadata",
      [KEY.complete]: String(complete),
      [KEY.provider]: this.profile.provider,
      [KEY.model]: this.profile.modelId,
      [KEY.dimension]: String(this.profile.dimension),
    }
    await client.hset(this.metadataKey, fields)
  }

  private async getMetadata(): Promise<Record<string, string> | null> {
    return this.getMetadataHash()
  }

  private async getMetadataHash(): Promise<Record<string, string> | null> {
    const client = await this.ensureConnected()
    const hashData = await client.hgetall(this.metadataKey)
    if (!hashData || hashData.length === 0) {
      return null
    }
    const result: Record<string, string> = {}
    for (const entry of hashData) {
      result[String(entry.field)] = String(entry.value)
    }
    return result
  }

  private async getStoredProfile(): Promise<EmbeddingProfile | null> {
    const metadata = await this.getMetadataHash()
    if (!metadata) {
      return null
    }

    const provider = metadata[KEY.provider]
    const modelId = metadata[KEY.model]
    const dimensionStr = metadata[KEY.dimension]

    if (!provider || modelId === undefined) {
      return null
    }

    const dimension = Number(dimensionStr)
    if (!Number.isFinite(dimension) || dimension <= 0) {
      return null
    }

    return {
      provider: provider as EmbeddingProfile["provider"],
      modelId,
      dimension,
    }
  }

  async upsertPoints(points: PointStruct[]): Promise<void> {
    if (points.length === 0) {
      return
    }

    const client = await this.ensureConnected()
    const BATCH_CHUNK_SIZE = 1000

    try {
      for (let i = 0; i < points.length; i += BATCH_CHUNK_SIZE) {
        const chunk = points.slice(i, i + BATCH_CHUNK_SIZE)
        const batch = new Batch(false) // non-atomic pipeline

        for (const point of chunk) {
          const key = `${this.collectionName}:${point.id}`
          const fields: Record<string, GlideString> = {
            vector: this.encodeVector(point.vector),
            filePath: point.payload.filePath,
            codeChunk: point.payload.codeChunk,
            startLine: String(point.payload.startLine),
            endLine: String(point.payload.endLine),
            type: "point",
            ...this.splitPathSegments(point.payload.filePath),
          }
          batch.hset(key, fields)
        }

        await client.exec(batch, true)
      }
    } catch (error) {
      log.error("Failed to upsert points", {
        collection: this.collectionName,
        batchSize: points.length,
        error: error instanceof Error ? error.message : String(error),
      })
      this.handleClientError(error)
      throw error
    }
  }

  async search(
    queryVector: number[],
    directoryPrefix?: string,
    minScore?: number,
    maxResults?: number,
  ): Promise<VectorStoreSearchResult[]> {
    if (queryVector.length !== this.vectorSize) {
      throw new Error(
        `Vector dimension mismatch: query vector has ${queryVector.length} dimensions, but index expects ${this.vectorSize}`,
      )
    }

    const exists = await this.collectionExists()
    if (!exists) {
      return []
    }

    const actualMinScore = minScore ?? DEFAULT_SEARCH_MIN_SCORE
    const actualMaxResults = maxResults ?? DEFAULT_MAX_SEARCH_RESULTS

    try {
      const client = await this.ensureConnected()
      const filter = this.buildDirectoryFilter(directoryPrefix ?? "")
      const vectorBlob = this.encodeVector(queryVector)
      const query = `${filter}=>[KNN ${actualMaxResults} @vector $BLOB AS score]`

      const [_count, documents] = await GlideFt.search(client, this.collectionName, query, {
        params: [{ key: "BLOB", value: vectorBlob }],
        returnFields: [
          { fieldIdentifier: "filePath" },
          { fieldIdentifier: "codeChunk" },
          { fieldIdentifier: "startLine" },
          { fieldIdentifier: "endLine" },
          { fieldIdentifier: "score" },
        ],
        dialect: 2,
        limit: { offset: 0, count: actualMaxResults },
      })

      const results: VectorStoreSearchResult[] = []

      if (!documents || !Array.isArray(documents)) {
        return []
      }

      for (const doc of documents) {
        const docKey = String(doc.key)
        const fields = doc.value

        const prefix = `${this.collectionName}:`
        const id = docKey.startsWith(prefix) ? docKey.slice(prefix.length) : docKey

        const fieldMap: Record<string, string> = {}
        if (Array.isArray(fields)) {
          for (const field of fields) {
            fieldMap[String(field.key)] = String(field.value)
          }
        }

        // Cosine distance → similarity score
        const distance = parseFloat(fieldMap["score"] ?? "1")
        const score = 1 - distance

        if (score < actualMinScore) {
          continue
        }

        results.push({
          id,
          score,
          payload: {
            filePath: fieldMap["filePath"] ?? "",
            codeChunk: fieldMap["codeChunk"] ?? "",
            startLine: parseInt(fieldMap["startLine"] ?? "0", 10),
            endLine: parseInt(fieldMap["endLine"] ?? "0", 10),
          },
        })
      }

      return results.slice(0, actualMaxResults)
    } catch (error) {
      log.error("Search failed", {
        collection: this.collectionName,
        directoryPrefix: directoryPrefix ?? "",
        error: error instanceof Error ? error.message : String(error),
      })
      this.handleClientError(error)
      throw error
    }
  }

  async deletePointsByFilePath(filePath: string): Promise<void> {
    await this.deletePointsByMultipleFilePaths([filePath])
  }

  async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) {
      return
    }

    const exists = await this.collectionExists()
    if (!exists) {
      return
    }

    try {
      const client = await this.ensureConnected()
      const keysToDelete: string[] = []
      const DELETE_BATCH_SIZE = 1000
      const SEARCH_LIMIT = 10000

      for (const filePath of filePaths) {
        const sanitizedPath = this.sanitizeTagValue(filePath)
        const query = `@filePath:{${sanitizedPath}}`

        const [, documents] = await GlideFt.search(client, this.collectionName, query, {
          limit: { offset: 0, count: SEARCH_LIMIT },
          nocontent: true,
        })

        if (!documents || documents.length === 0) {
          continue
        }

        if (documents.length === SEARCH_LIMIT) {
          log.warn("deletePointsByMultipleFilePaths hit search limit, some points may not be deleted", {
            collection: this.collectionName,
            filePath,
            limit: SEARCH_LIMIT,
          })
        }

        for (const doc of documents) {
          keysToDelete.push(String(doc.key))
        }

        // Delete in batches to avoid unbounded accumulation
        if (keysToDelete.length >= DELETE_BATCH_SIZE) {
          await client.del(keysToDelete)
          keysToDelete.length = 0
        }
      }

      if (keysToDelete.length > 0) {
        await client.del(keysToDelete)
      }
    } catch (error) {
      const samplePaths = filePaths.slice(0, 3)
      log.error("Failed to delete points by file paths", {
        collection: this.collectionName,
        fileCount: filePaths.length,
        samplePaths,
        error: error instanceof Error ? error.message : String(error),
      })
      this.handleClientError(error)
      throw error
    }
  }

  async clearCollection(): Promise<void> {
    const exists = await this.collectionExists()
    if (!exists) {
      return
    }

    try {
      const client = await this.ensureConnected()
      const pattern = `${this.collectionName}:*`
      let cursor = "0"
      const MAX_SCAN_ITERATIONS = 100_000
      let iterations = 0

      do {
        if (++iterations > MAX_SCAN_ITERATIONS) {
          log.warn("clearCollection exceeded max iterations, aborting", {
            collection: this.collectionName,
            iterations: MAX_SCAN_ITERATIONS,
          })
          break
        }
        const [nextCursor, keys] = await client.scan(cursor, { match: pattern, count: 100 })
        cursor = String(nextCursor)

        if (keys.length > 0) {
          // Preserve the metadata key so hasIndexedData() still works after clear
          const keysToDelete = (keys as string[]).filter((key) => key !== this.metadataKey)
          if (keysToDelete.length > 0) {
            await client.del(keysToDelete)
          }
        }
      } while (cursor !== "0")
    } catch (error) {
      log.error("Failed to clear collection", {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      })
      this.handleClientError(error)
      throw error
    }
  }

  async deleteCollection(): Promise<void> {
    const exists = await this.collectionExists()
    if (!exists) {
      return
    }

    await this.dropIndex()

    // Metadata key may survive scanAndDelete if written between scan pages
    const client = await this.ensureConnected()
    await client.del([this.metadataKey])
  }

  async collectionExists(): Promise<boolean> {
    const client = await this.ensureConnected()
    try {
      await GlideFt.info(client, this.collectionName)
      return true
    } catch (error) {
      if (error instanceof RequestError) {
        return false
      }
      throw error
    }
  }

  async hasIndexedData(): Promise<boolean> {
    try {
      const exists = await this.collectionExists()
      if (!exists) {
        return false
      }

      const info = await this.getIndexInfo()
      if (!info) {
        return false
      }
      const numDocs = this.parseNumDocsFromInfo(info)
      if (numDocs < 1) {
        return false
      }

      const metadata = await this.getMetadata()
      if (!metadata) {
        return false
      }

      return metadata[KEY.complete] === "true"
    } catch (error) {
      log.error("hasIndexedData check failed", {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  async markIndexingComplete(): Promise<void> {
    try {
      await this.setMetadata(true)
    } catch (error) {
      log.error("Failed to mark indexing complete", {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async markIndexingIncomplete(): Promise<void> {
    try {
      await this.setMetadata(false)
    } catch (error) {
      log.error("Failed to mark indexing incomplete", {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Creates or returns the GlideClient singleton.
   * GLIDE multiplexes over a single connection and reconnects automatically.
   * Uses a connection promise as a mutex to prevent concurrent callers from
   * creating multiple clients.
   */
  protected async ensureConnected(): Promise<GlideClient> {
    if (this.client) {
      return this.client
    }

    if (this.connectingPromise) {
      return this.connectingPromise
    }

    this.connectingPromise = this.createConnection()
    try {
      this.client = await this.connectingPromise
      return this.client
    } catch (error) {
      this.client = null
      throw error
    } finally {
      this.connectingPromise = null
    }
  }

  private async createConnection(): Promise<GlideClient> {
    const url = new URL(this.valkeyUrl)
    const host = url.hostname
    const port = url.port ? parseInt(url.port, 10) : 6379
    const useTLS = url.protocol === "rediss:"

    return GlideClient.createClient({
      addresses: [{ host, port }],
      useTLS,
      credentials: this.valkeyPassword ? { password: this.valkeyPassword } : undefined,
      clientName: "kilo-valkey-store",
      requestTimeout: 5000,
    })
  }

  async dispose(): Promise<void> {
    if (this.connectingPromise) {
      try { await this.connectingPromise } catch { /* ignore */ }
    }
    if (this.client) {
      this.client.close()
      this.client = null
    }
    this.connectingPromise = null
  }

  protected handleClientError(error: unknown): void {
    if (error instanceof ClosingError) {
      this.client = null
    }
  }

  async getIndexInfo(): Promise<Record<string, any> | null> {
    const client = await this.ensureConnected()
    try {
      const info = await GlideFt.info(client, this.collectionName)
      return info as Record<string, any>
    } catch (error) {
      if (error instanceof RequestError) {
        return null
      }
      throw error
    }
  }

  async createIndex(): Promise<void> {
    const exists = await this.collectionExists()
    if (exists) {
      throw new Error(`Index ${this.collectionName} already exists`)
    }

    const client = await this.ensureConnected()

    const schema: Field[] = [
      {
        type: "VECTOR",
        name: "vector",
        attributes: {
          algorithm: "HNSW",
          type: "FLOAT32",
          dimensions: this.vectorSize,
          distanceMetric: "COSINE",
        },
      },
      { type: "TAG", name: "seg0" },
      { type: "TAG", name: "seg1" },
      { type: "TAG", name: "seg2" },
      { type: "TAG", name: "seg3" },
      { type: "TAG", name: "seg4" },
      // Use null-byte separator to prevent default comma tokenization of file paths
      { type: "TAG", name: "filePath", separator: "\x00" },
      { type: "TAG", name: "type" },
    ]

    const options: FtCreateOptions = {
      dataType: "HASH",
      prefixes: [`${this.collectionName}:`],
    }

    await GlideFt.create(client, this.collectionName, schema, options)
  }

  /**
   * Drops the ValkeySearch index and removes all orphaned hash keys.
   * GlideFt.dropindex() removes the index definition but does NOT delete associated
   * hash keys, so we use scanAndDelete() to clean up orphaned data.
   */
  async dropIndex(): Promise<void> {
    const exists = await this.collectionExists()
    if (!exists) {
      return
    }

    const client = await this.ensureConnected()
    await GlideFt.dropindex(client, this.collectionName)
    await this.scanAndDelete(`${this.collectionName}:`)
  }

  async scanAndDelete(prefix: string): Promise<void> {
    const client = await this.ensureConnected()
    const pattern = `${prefix}*`
    let cursor = "0"
    const MAX_SCAN_ITERATIONS = 100_000
    let iterations = 0

    do {
      if (++iterations > MAX_SCAN_ITERATIONS) {
        log.warn("scanAndDelete exceeded max iterations, aborting", {
          collection: this.collectionName,
          prefix,
          iterations: MAX_SCAN_ITERATIONS,
        })
        break
      }
      const [nextCursor, keys] = await client.scan(cursor, { match: pattern, count: 100 })
      cursor = String(nextCursor)

      if (keys.length > 0) {
        await client.del(keys as string[])
      }
    } while (cursor !== "0")
  }

  normalizeUrl(url: string): string {
    const trimmed = url.trim()
    if (trimmed.startsWith("redis://") || trimmed.startsWith("rediss://")) {
      return trimmed
    }
    return `redis://${trimmed}`
  }

  encodeVector(vector: number[]): Buffer {
    const buffer = Buffer.alloc(vector.length * 4)
    for (let i = 0; i < vector.length; i++) {
      buffer.writeFloatLE(vector[i], i * 4)
    }
    return buffer
  }

  decodeVector(buffer: Buffer): number[] {
    const count = buffer.length / 4
    const result: number[] = Array.from({ length: count })
    for (let i = 0; i < count; i++) {
      result[i] = buffer.readFloatLE(i * 4)
    }
    return result
  }

  splitPathSegments(filePath: string): Record<string, string> {
    const segments = filePath.split("/").filter(Boolean)
    const result: Record<string, string> = {}
    const maxSegments = Math.min(segments.length, 5)
    for (let i = 0; i < maxSegments; i++) {
      result[`seg${i}`] = segments[i]
    }
    return result
  }

  sanitizeTagValue(segment: string): string {
    if (segment.includes("=>")) {
      throw new Error(`Invalid path segment: contains '=>' which is a reserved FT.SEARCH delimiter`)
    }
    // Escape all ValkeySearch TAG metacharacters: {}|\*?()@!~[],."- and backslash
    return segment.replace(/[{}|\\*?()@!~[\],."'-]/g, "\\$&")
  }

  buildDirectoryFilter(directoryPrefix: string): string {
    const MAX_PATH_SEGMENTS = 5
    let normalized = directoryPrefix.replace(/\\/g, "/")
    if (normalized.startsWith("./")) {
      normalized = normalized.slice(2)
    }

    if (normalized === "" || normalized === ".") {
      return "(@type:{point})"
    }

    const segments = normalized.split("/").filter(Boolean)
    if (segments.length > MAX_PATH_SEGMENTS) {
      log.warn("Directory prefix exceeds max segment depth, filtering on first 5 segments only", {
        directoryPrefix,
        segmentCount: segments.length,
        maxSegments: MAX_PATH_SEGMENTS,
      })
    }
    const segmentFilters = segments
      .slice(0, MAX_PATH_SEGMENTS)
      .map((seg, i) => `@seg${i}:{${this.sanitizeTagValue(seg)}}`)
      .join(" ")

    return `(@type:{point} ${segmentFilters})`
  }

  getCollectionName(): string {
    return this.collectionName
  }

  getMetadataKey(): string {
    return this.metadataKey
  }

  getValkeyUrl(): string {
    return this.valkeyUrl
  }

  getProfile(): EmbeddingProfile {
    return this.profile
  }

  getVectorSize(): number {
    return this.vectorSize
  }
}
