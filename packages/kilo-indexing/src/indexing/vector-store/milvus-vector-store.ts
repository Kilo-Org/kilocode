import { HttpClient, type HttpBaseResponse } from "@zilliz/milvus2-sdk-node"
import { createHash } from "crypto"
import * as path from "path"
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE } from "../constants"
import type { EmbeddingProfile } from "../embedding-profile"
import type { Payload, VectorStoreSearchResult } from "../interfaces"
import type { IVectorStore, PointStruct } from "../interfaces/vector-store"
import { Log } from "../../util/log"

const log = Log.create({ service: "milvus-store" })

const SCHEMA = 1
const DEFAULT_ADDRESS = "localhost:19530"
const REQUEST_TIMEOUT_MS = 120_000
const FLUSH_RETRY_DELAY_MS = 11_000
const FLUSH_RETRIES = 2
const METADATA_ID = "f946a536-9af4-4f1f-9f95-7d6efb4647d5"
const VECTOR_FIELD = "vector"
const POINT_TYPE = "point"
const METADATA_TYPE = "metadata"
const PATH_SEGMENT_COUNT = 5

const KEY = {
  schema: "index_schema",
  complete: "indexing_complete",
  provider: "embedding_provider",
  model: "embedding_model_id",
  dimension: "embedding_dimension",
}

type MilvusRow = {
  id: string
  vector: number[]
  type: string
  filePath: string
  fileHash: string
  codeChunk: string
  startLine: number
  endLine: number
  path0: string
  path1: string
  path2: string
  path3: string
  path4: string
  [KEY.schema]: number
  [KEY.complete]: boolean
  [KEY.provider]: string
  [KEY.model]: string
  [KEY.dimension]: number
}

type Field = {
  name?: string
  fieldName?: string
  type?: string
  dataType?: string
  primaryKey?: boolean
  isPrimary?: boolean
  params?: Array<{ key?: string; value?: string | number }>
}

type Info = HttpBaseResponse<{
  fields?: Field[]
}>

type Query = HttpBaseResponse<Record<string, unknown>[]>

type SearchRow = Record<string, unknown> & {
  id?: string | number
  score?: number
  distance?: number
}

type Search = HttpBaseResponse<SearchRow[]>

type PathSegments = {
  path0: string
  path1: string
  path2: string
  path3: string
  path4: string
}

export class MilvusVectorStore implements IVectorStore {
  private readonly client: HttpClient
  private readonly address: string
  private readonly endpoint: string
  private readonly token?: string
  private readonly database?: string
  private readonly collectionName: string
  private readonly profile: EmbeddingProfile

  constructor(
    private readonly workspacePath: string,
    address: string | undefined,
    private readonly vectorSize: number,
    token?: string,
    database?: string,
    profile?: EmbeddingProfile,
  ) {
    this.address = this.parseAddress(address)
    this.token = token?.trim() || undefined
    this.endpoint = this.parseEndpoint(this.address, this.token)
    this.database = this.parseDatabase(database, this.endpoint)
    this.client = new HttpClient({
      endpoint: this.endpoint,
      token: this.token,
      database: this.database,
      timeout: REQUEST_TIMEOUT_MS,
    })
    this.profile =
      profile ??
      ({
        provider: "openai",
        modelId: "",
        dimension: vectorSize,
      } as EmbeddingProfile)

    const hash = createHash("sha256").update(workspacePath).digest("hex")
    this.collectionName = `ws_${hash.substring(0, 16)}`
  }

  private parseAddress(address: string | undefined): string {
    const trimmed = address?.trim()
    return trimmed || DEFAULT_ADDRESS
  }

  private parseEndpoint(address: string, token: string | undefined): string {
    if (/^https?:\/\//i.test(address)) return address.replace(/\/+$/, "")
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|$)/i.test(address)
    const protocol = token && !local ? "https" : "http"
    return `${protocol}://${address}`.replace(/\/+$/, "")
  }

  private parseDatabase(database: string | undefined, endpoint: string): string | undefined {
    const trimmed = database?.trim()
    if (trimmed) return trimmed
    const match = endpoint.match(/(?:^|\/\/)in\d+-([a-z0-9]+)\.serverless\./i)
    return match?.[1] ? `db_${match[1]}` : undefined
  }

  private collectionReq<T extends Record<string, unknown>>(req: T): T & { collectionName: string; dbName: string } {
    return {
      collectionName: this.collectionName,
      dbName: this.database ?? "default",
      ...req,
    }
  }

  private stringLiteral(value: string): string {
    return JSON.stringify(value)
  }

  private metadataId(): string {
    return METADATA_ID
  }

  private ensureSuccess(value: unknown, action: string): void {
    if (!value || typeof value !== "object") return
    const code = "code" in value ? Number((value as { code?: unknown }).code) : 0
    if (Number.isFinite(code) && code === 0) return
    const message = "message" in value ? String((value as { message?: unknown }).message) : ""
    throw new Error(`${action} failed${message ? `: ${message}` : ""}`)
  }

  private async collectionExistsInfo(): Promise<Info | null> {
    try {
      const exists = await this.client.hasCollection(this.collectionReq({}))
      this.ensureSuccess(exists, "Check Milvus collection")
      if (!exists.data?.has) return null
      const info = (await this.client.describeCollection(this.collectionReq({}))) as Info
      this.ensureSuccess(info, "Describe Milvus collection")
      return info
    } catch (error: unknown) {
      log.warn(`Warning during describeCollection for "${this.collectionName}"`, {
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  private field(info: Info, name: string): Field | undefined {
    return info.data?.fields?.find((field) => (field.name ?? field.fieldName) === name)
  }

  private fieldType(field: Field | undefined): string | undefined {
    return field?.type ?? field?.dataType
  }

  private hasFieldType(field: Field | undefined, type: string): boolean {
    return this.fieldType(field) === type
  }

  private fieldDim(field: Field | undefined): number | undefined {
    const param = field?.params?.find((item) => item.key === "dim")
    const dim = Number(param?.value)
    return Number.isFinite(dim) && dim > 0 ? dim : undefined
  }

  private isSchemaCompatible(info: Info): boolean {
    const id = this.field(info, "id")
    const vector = this.field(info, VECTOR_FIELD)
    if (!this.hasFieldType(id, "VarChar") || !id?.primaryKey) return false
    if (!this.hasFieldType(vector, "FloatVector")) return false
    if (this.fieldDim(vector) !== this.vectorSize) return false

    const varcharFields = ["type", "filePath", "fileHash", "codeChunk", KEY.provider, KEY.model]
    for (const name of varcharFields) {
      if (!this.hasFieldType(this.field(info, name), "VarChar")) return false
    }
    for (let i = 0; i < PATH_SEGMENT_COUNT; i++) {
      if (!this.hasFieldType(this.field(info, `path${i}`), "VarChar")) return false
    }
    for (const name of ["startLine", "endLine", KEY.schema, KEY.dimension]) {
      if (!this.hasFieldType(this.field(info, name), "Int64")) return false
    }
    return this.hasFieldType(this.field(info, KEY.complete), "Bool")
  }

  private parseDimension(value: unknown): number | undefined {
    const dim = Number(value)
    if (!Number.isFinite(dim) || dim <= 0) return undefined
    return dim
  }

  private parseProvider(value: string): EmbeddingProfile["provider"] | undefined {
    switch (value) {
      case "kilo":
      case "openai":
      case "ollama":
      case "openai-compatible":
      case "gemini":
      case "mistral":
      case "vercel-ai-gateway":
      case "bedrock":
      case "openrouter":
      case "voyage":
        return value
      default:
        return undefined
    }
  }

  private getStoredProfile(payload?: Record<string, unknown>): EmbeddingProfile | undefined {
    if (!payload) return undefined
    const provider = payload[KEY.provider]
    const modelId = payload[KEY.model]
    const dimension = payload[KEY.dimension]
    if (typeof provider !== "string" || typeof modelId !== "string") return undefined
    const parsed = this.parseProvider(provider)
    if (!parsed) return undefined
    const dim = this.parseDimension(dimension)
    if (!dim) return undefined
    return {
      provider: parsed,
      modelId,
      dimension: dim,
    }
  }

  private isProfileMatch(profile: EmbeddingProfile): boolean {
    return (
      profile.provider === this.profile.provider &&
      profile.modelId === this.profile.modelId &&
      profile.dimension === this.profile.dimension
    )
  }

  private async getMetadataPayload(): Promise<Record<string, unknown> | undefined> {
    try {
      const result = (await this.client.get(
        this.collectionReq({
          id: [this.metadataId()],
          outputFields: [KEY.schema, KEY.complete, KEY.provider, KEY.model, KEY.dimension],
        }),
      )) as Query
      const first = result.data[0]
      if (!first || typeof first !== "object") return undefined
      return first
    } catch (error) {
      log.warn("Failed to retrieve Milvus indexing metadata", { error })
      return undefined
    }
  }

  private async hasDataRows(): Promise<boolean> {
    const result = (await this.client.query(
      this.collectionReq({
        filter: `type == ${this.stringLiteral(POINT_TYPE)}`,
        outputFields: ["id"],
        limit: 1,
        consistencyLevel: "Session",
      }),
    )) as Query
    this.ensureSuccess(result, "Query Milvus rows")
    return result.data.length > 0
  }

  private async loadCollection(): Promise<void> {
    const result = await this.client.loadCollection(this.collectionReq({}))
    this.ensureSuccess(result, "Load Milvus collection")
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private isFlushRetryable(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /rate limit|retry later/i.test(message)
  }

  private async flushCollection(attempt = 0): Promise<void> {
    try {
      const result = await this.client.flushCollection(this.collectionReq({}))
      this.ensureSuccess(result, "Flush Milvus collection")
    } catch (error) {
      if (attempt < FLUSH_RETRIES && this.isFlushRetryable(error)) {
        await this.sleep(FLUSH_RETRY_DELAY_MS)
        return this.flushCollection(attempt + 1)
      }
      throw error
    }
  }

  private async createCollection(): Promise<void> {
    const fields = [
      { fieldName: "id", dataType: "VarChar", isPrimary: true, elementTypeParams: { max_length: 128 } },
      { fieldName: VECTOR_FIELD, dataType: "FloatVector", elementTypeParams: { dim: this.vectorSize } },
      { fieldName: "type", dataType: "VarChar", elementTypeParams: { max_length: 32 } },
      { fieldName: "filePath", dataType: "VarChar", elementTypeParams: { max_length: 65535 } },
      { fieldName: "fileHash", dataType: "VarChar", elementTypeParams: { max_length: 256 } },
      { fieldName: "codeChunk", dataType: "VarChar", elementTypeParams: { max_length: 65535 } },
      { fieldName: "startLine", dataType: "Int64" },
      { fieldName: "endLine", dataType: "Int64" },
      { fieldName: "path0", dataType: "VarChar", elementTypeParams: { max_length: 2048 } },
      { fieldName: "path1", dataType: "VarChar", elementTypeParams: { max_length: 2048 } },
      { fieldName: "path2", dataType: "VarChar", elementTypeParams: { max_length: 2048 } },
      { fieldName: "path3", dataType: "VarChar", elementTypeParams: { max_length: 2048 } },
      { fieldName: "path4", dataType: "VarChar", elementTypeParams: { max_length: 2048 } },
      { fieldName: KEY.schema, dataType: "Int64" },
      { fieldName: KEY.complete, dataType: "Bool" },
      { fieldName: KEY.provider, dataType: "VarChar", elementTypeParams: { max_length: 128 } },
      { fieldName: KEY.model, dataType: "VarChar", elementTypeParams: { max_length: 512 } },
      { fieldName: KEY.dimension, dataType: "Int64" },
    ]

    const result = await this.client.createCollection(
      this.collectionReq({
        schema: {
          autoID: false,
          enabledDynamicField: false,
          fields,
        },
        indexParams: [
          {
            fieldName: VECTOR_FIELD,
            indexName: `${VECTOR_FIELD}_idx`,
            metricType: "COSINE",
            params: { index_type: "AUTOINDEX" },
          },
        ],
        params: {
          consistencyLevel: "Session",
        },
      }),
    )
    this.ensureSuccess(result, "Create Milvus collection")
    await this.loadCollection()
  }

  private async recreateCollection(reason: string): Promise<boolean> {
    log.warn(`Collection ${this.collectionName} is incompatible (${reason}). Recreating collection.`)
    await this.client.dropCollection(this.collectionReq({}))
    await new Promise((resolve) => setTimeout(resolve, 100))
    await this.createCollection()
    return true
  }

  async openExisting(): Promise<void> {
    const info = await this.collectionExistsInfo()
    if (!info) throw new Error("Baseline Milvus collection does not exist")
    if (!this.isSchemaCompatible(info)) throw new Error("Baseline Milvus index schema does not match the worktree")
    await this.loadCollection()

    const payload = await this.getMetadataPayload()
    const profile = this.getStoredProfile(payload)
    if (!profile || !this.isProfileMatch(profile)) {
      throw new Error("Baseline Milvus embedding profile does not match the worktree")
    }
    if (payload?.[KEY.schema] !== SCHEMA) throw new Error("Baseline Milvus index schema does not match the worktree")
    if (payload?.[KEY.complete] !== true) throw new Error("Baseline Milvus index is not complete")
  }

  async initialize(): Promise<boolean> {
    try {
      const info = await this.collectionExistsInfo()
      if (!info) {
        await this.createCollection()
        log.info("Milvus collection ready", {
          collection: this.collectionName,
          created: true,
          vectorSize: this.vectorSize,
          address: this.address,
        })
        return true
      }

      if (!this.isSchemaCompatible(info)) return await this.recreateCollection("schema mismatch")

      await this.loadCollection()
      const payload = await this.getMetadataPayload()
      const profile = this.getStoredProfile(payload)
      const hasRows = await this.hasDataRows()
      const compatible = payload?.[KEY.schema] === SCHEMA && profile && this.isProfileMatch(profile)
      if ((payload || hasRows) && !compatible) {
        const from = profile
          ? `${profile.provider}:${profile.modelId}:${profile.dimension}`
          : "missing embedding metadata on populated collection"
        const to = `${this.profile.provider}:${this.profile.modelId}:${this.profile.dimension}`
        return await this.recreateCollection(`${from} -> ${to}`)
      }

      log.info("Milvus collection ready", {
        collection: this.collectionName,
        created: false,
        vectorSize: this.vectorSize,
        address: this.address,
      })
      return false
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error(`Failed to initialize Milvus collection "${this.collectionName}"`, { error: errorMessage })
      throw new Error(`Failed to connect to Milvus at ${this.address}: ${errorMessage}`, { cause: error })
    }
  }

  private isPayloadValid(payload: Record<string, unknown> | null | undefined): payload is Payload {
    if (!payload) return false
    const validKeys = ["filePath", "fileHash", "codeChunk", "startLine", "endLine"]
    return validKeys.every((key) => key in payload)
  }

  private pathSegments(filePath: string): PathSegments {
    const segments = filePath.split(/[\\/]+/).filter(Boolean)
    return {
      path0: segments[0] ?? "",
      path1: segments[1] ?? "",
      path2: segments[2] ?? "",
      path3: segments[3] ?? "",
      path4: segments[4] ?? "",
    }
  }

  private dataRow(point: PointStruct): MilvusRow | undefined {
    if (!this.isPayloadValid(point.payload)) return undefined
    return {
      id: point.id,
      vector: point.vector,
      type: POINT_TYPE,
      filePath: point.payload.filePath,
      fileHash: point.payload.fileHash ?? "",
      codeChunk: point.payload.codeChunk,
      startLine: point.payload.startLine,
      endLine: point.payload.endLine,
      ...this.pathSegments(point.payload.filePath),
      [KEY.schema]: SCHEMA,
      [KEY.complete]: false,
      [KEY.provider]: "",
      [KEY.model]: "",
      [KEY.dimension]: this.vectorSize,
    }
  }

  async upsertPoints(points: PointStruct[]): Promise<void> {
    if (points.length === 0) return
    const rows = points.flatMap((point) => {
      const row = this.dataRow(point)
      return row ? [row] : []
    })
    if (rows.length === 0) return

    try {
      const result = await this.client.upsert(this.collectionReq({ data: rows }))
      this.ensureSuccess(result, "Upsert Milvus rows")
    } catch (error) {
      log.error("Failed to upsert points", { error })
      throw error
    }
  }

  private directoryFilter(directoryPrefix: string | undefined): string | undefined {
    if (!directoryPrefix) return undefined
    const normalizedPrefix = path.posix.normalize(directoryPrefix.replace(/\\/g, "/"))
    if (normalizedPrefix === "." || normalizedPrefix === "./") return undefined
    const cleanedPrefix = path.posix.normalize(
      normalizedPrefix.startsWith("./") ? normalizedPrefix.slice(2) : normalizedPrefix,
    )
    const segments = cleanedPrefix.split("/").filter(Boolean)
    if (segments.length === 0) return undefined
    return segments
      .slice(0, PATH_SEGMENT_COUNT)
      .map((segment, index) => `path${index} == ${this.stringLiteral(segment)}`)
      .join(" AND ")
  }

  async search(
    queryVector: number[],
    directoryPrefix?: string,
    minScore?: number,
    maxResults?: number,
  ): Promise<VectorStoreSearchResult[]> {
    try {
      const filters = [`type != ${this.stringLiteral(METADATA_TYPE)}`]
      const dirFilter = this.directoryFilter(directoryPrefix)
      if (dirFilter) filters.push(dirFilter)
      const actualMinScore = minScore ?? DEFAULT_SEARCH_MIN_SCORE

      const result = (await this.client.search(
        this.collectionReq({
          data: [queryVector],
          annsField: VECTOR_FIELD,
          limit: maxResults ?? DEFAULT_MAX_SEARCH_RESULTS,
          filter: filters.join(" AND "),
          outputFields: ["filePath", "fileHash", "codeChunk", "startLine", "endLine"],
          consistencyLevel: "Session",
          searchParams: {
            metric_type: "COSINE",
            params: {},
          },
        }),
      )) as Search
      this.ensureSuccess(result, "Search Milvus rows")

      return result.data
        .map((row) => ({ row, score: Number(row.score ?? row.distance) }))
        .filter((item) => Number.isFinite(item.score) && item.score >= actualMinScore)
        .filter((item) => this.isPayloadValid(item.row))
        .map((item) => ({
          id: item.row.id ?? "",
          score: item.score,
          payload: {
            filePath: String(item.row.filePath),
            fileHash: String(item.row.fileHash ?? ""),
            codeChunk: String(item.row.codeChunk),
            startLine: Number(item.row.startLine),
            endLine: Number(item.row.endLine),
          },
        }))
    } catch (error) {
      log.error("Failed to search points", { error })
      throw error
    }
  }

  async deletePointsByFilePath(filePath: string): Promise<void> {
    return this.deletePointsByMultipleFilePaths([filePath])
  }

  async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return

    try {
      if (!(await this.collectionExists())) {
        log.warn(`Skipping deletion - collection "${this.collectionName}" does not exist`)
        return
      }

      const normalizedPaths = filePaths.map((filePath) =>
        path.normalize(path.isAbsolute(filePath) ? path.relative(this.workspacePath, filePath) : filePath),
      )
      const filter = `filePath in [${normalizedPaths.map((filePath) => this.stringLiteral(filePath)).join(", ")}]`
      const result = await this.client.delete(this.collectionReq({ filter }))
      this.ensureSuccess(result, "Delete Milvus rows")
      await this.flushCollection()
    } catch (error) {
      log.error("Failed to delete points by file paths", {
        error: error instanceof Error ? error.message : String(error),
        collection: this.collectionName,
        fileCount: filePaths.length,
        samplePaths: filePaths.slice(0, 3),
      })
      throw error
    }
  }

  async clearCollection(): Promise<void> {
    try {
      if (!(await this.collectionExists())) return
      const result = await this.client.delete(this.collectionReq({ filter: `id != ${this.stringLiteral("")}` }))
      this.ensureSuccess(result, "Clear Milvus rows")
      await this.flushCollection()
      await this.loadCollection()
    } catch (error) {
      log.error("Failed to clear collection", { error })
      throw error
    }
  }

  async deleteCollection(): Promise<void> {
    try {
      if (await this.collectionExists()) {
        const result = await this.client.dropCollection(this.collectionReq({}))
        this.ensureSuccess(result, "Drop Milvus collection")
      }
    } catch (error) {
      log.error(`Failed to delete collection ${this.collectionName}`, { error })
      throw error
    }
  }

  async collectionExists(): Promise<boolean> {
    try {
      const exists = await this.client.hasCollection(this.collectionReq({}))
      this.ensureSuccess(exists, "Check Milvus collection")
      return exists.data?.has ?? false
    } catch {
      return false
    }
  }

  async hasIndexedData(): Promise<boolean> {
    try {
      if (!(await this.collectionExists())) return false
      const hasRows = await this.hasDataRows()
      if (!hasRows) {
        log.info("Milvus has no indexed data", {
          collection: this.collectionName,
          reason: "points_zero",
        })
        return false
      }

      const payload = await this.getMetadataPayload()
      const indexed = payload?.[KEY.complete] === true
      log.info("Milvus indexing metadata evaluated", {
        collection: this.collectionName,
        indexed,
      })
      return indexed
    } catch (error) {
      log.error("Failed to check if collection has data", { error })
      throw error
    }
  }

  private metadataRow(complete: boolean): MilvusRow {
    return {
      id: this.metadataId(),
      vector: Array.from({ length: this.vectorSize }, () => 0),
      type: METADATA_TYPE,
      filePath: "",
      fileHash: "",
      codeChunk: "",
      startLine: 0,
      endLine: 0,
      path0: "",
      path1: "",
      path2: "",
      path3: "",
      path4: "",
      [KEY.schema]: SCHEMA,
      [KEY.complete]: complete,
      [KEY.provider]: this.profile.provider,
      [KEY.model]: this.profile.modelId,
      [KEY.dimension]: this.profile.dimension,
    }
  }

  private async markIndexing(complete: boolean): Promise<void> {
    const result = await this.client.upsert(this.collectionReq({ data: [this.metadataRow(complete)] }))
    this.ensureSuccess(result, "Upsert Milvus indexing metadata")
    if (complete) await this.flushCollection()
  }

  async markIndexingComplete(): Promise<void> {
    try {
      await this.markIndexing(true)
      log.info("Marked indexing as complete")
    } catch (error) {
      log.error("Failed to mark indexing as complete", { error })
      throw error
    }
  }

  async markIndexingIncomplete(): Promise<void> {
    try {
      await this.markIndexing(false)
      log.info("Marked indexing as incomplete (in progress)")
    } catch (error) {
      log.error("Failed to mark indexing as incomplete", { error })
      throw error
    }
  }

  async close(): Promise<void> {
    return
  }
}
