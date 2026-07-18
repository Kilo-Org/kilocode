import { beforeEach, describe, expect, mock, test } from "bun:test"

const clients: MockHttpClient[] = []

type Req = Record<string, unknown>

function ok(data: unknown = {}) {
  return { code: 0, data }
}

function field(name: string, type: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    type,
    primaryKey: false,
    params: [],
    ...extra,
  }
}

function compatibleCollection(vectorSize = 3) {
  return ok({
    fields: [
      field("id", "VarChar", { primaryKey: true }),
      field("vector", "FloatVector", { params: [{ key: "dim", value: String(vectorSize) }] }),
      field("type", "VarChar"),
      field("filePath", "VarChar"),
      field("fileHash", "VarChar"),
      field("codeChunk", "VarChar"),
      field("startLine", "Int64"),
      field("endLine", "Int64"),
      field("path0", "VarChar"),
      field("path1", "VarChar"),
      field("path2", "VarChar"),
      field("path3", "VarChar"),
      field("path4", "VarChar"),
      field("index_schema", "Int64"),
      field("indexing_complete", "Bool"),
      field("embedding_provider", "VarChar"),
      field("embedding_model_id", "VarChar"),
      field("embedding_dimension", "Int64"),
    ],
  })
}

class MockHttpClient {
  hasCollection = mock(async () => ok({ has: false }))
  describeCollection = mock(async () => compatibleCollection())
  loadCollection = mock(async () => ok())
  flushCollection = mock(async () => ok())
  createCollection = mock(async () => ok())
  dropCollection = mock(async () => ok())
  upsert = mock(async () => ok())
  search = mock(async () => ok([]))
  delete = mock(async () => ok())
  get = mock(async () => ok([]))
  query = mock(async () => ok([]))

  constructor(public readonly config: Record<string, unknown>) {
    clients.push(this)
  }
}

mock.module("@zilliz/milvus2-sdk-node", () => ({
  HttpClient: MockHttpClient,
}))

import { MilvusVectorStore } from "../../../../src/indexing/vector-store/milvus-vector-store"

const workspacePath = "/workspace/project"
const profile = { provider: "openai" as const, modelId: "text-embedding-3-small", dimension: 3 }

function req(fn: { mock: { calls: unknown[][] } }, index = 0): Req {
  return fn.mock.calls[index]![0] as Req
}

describe("MilvusVectorStore", () => {
  beforeEach(() => {
    clients.length = 0
  })

  test("uses default connection settings and a Milvus-compatible collection name", () => {
    const store = new MilvusVectorStore(workspacePath, undefined, 3)
    const client = clients[0]!

    expect(client.config.endpoint).toBe("http://localhost:19530")
    expect(client.config.database).toBeUndefined()
    expect((store as { collectionName: string }).collectionName).toMatch(/^ws_[0-9a-f]{16}$/)
  })

  test("preserves explicit HTTPS endpoints and auto-detects Zilliz serverless databases", () => {
    new MilvusVectorStore(
      workspacePath,
      "https://in03-abcdef1234567890.serverless.gcp-us-west1.cloud.zilliz.com/",
      3,
      "token",
      undefined,
      profile,
    )
    const client = clients[0]!

    expect(client.config.endpoint).toBe("https://in03-abcdef1234567890.serverless.gcp-us-west1.cloud.zilliz.com")
    expect(client.config.database).toBe("db_abcdef1234567890")
  })

  test("creates and loads a collection with explicit schema and cosine AUTOINDEX", async () => {
    const store = new MilvusVectorStore(workspacePath, "localhost:19530", 3, undefined, undefined, profile)
    const client = clients[0]!

    const created = await store.initialize()

    expect(created).toBe(true)
    expect(client.createCollection).toHaveBeenCalledTimes(1)
    const request = req(client.createCollection)
    expect(request.collectionName).toMatch(/^ws_[0-9a-f]{16}$/)
    const schema = request.schema as { fields: Req[] }
    expect(schema.fields.find((item) => item.fieldName === "id")).toMatchObject({
      dataType: "VarChar",
      isPrimary: true,
    })
    expect(schema.fields.find((item) => item.fieldName === "vector")).toMatchObject({
      dataType: "FloatVector",
      elementTypeParams: { dim: 3 },
    })
    expect(request.indexParams).toEqual([
      {
        fieldName: "vector",
        indexName: "vector_idx",
        metricType: "COSINE",
        params: { index_type: "AUTOINDEX" },
      },
    ])
    expect(client.loadCollection).toHaveBeenCalledTimes(1)
  })

  test("recreates an incompatible populated collection", async () => {
    const store = new MilvusVectorStore(workspacePath, "localhost:19530", 3, undefined, undefined, profile)
    const client = clients[0]!
    client.hasCollection.mockResolvedValue(ok({ has: true }))
    client.get.mockResolvedValue(
      ok([
        {
          index_schema: 1,
          indexing_complete: true,
          embedding_provider: "openai",
          embedding_model_id: "text-embedding-ada-002",
          embedding_dimension: 1536,
        },
      ]),
    )
    client.query.mockResolvedValue(ok([{ id: "point" }]))

    const created = await store.initialize()

    expect(created).toBe(true)
    expect(client.dropCollection).toHaveBeenCalledTimes(1)
    expect(client.createCollection).toHaveBeenCalledTimes(1)
  })

  test("upserts valid points with path segment fields", async () => {
    const store = new MilvusVectorStore(workspacePath, "localhost:19530", 3, undefined, undefined, profile)
    const client = clients[0]!

    await store.upsertPoints([
      {
        id: "11111111-1111-4111-8111-111111111111",
        vector: [1, 0, 0],
        payload: {
          filePath: "src/index.ts",
          fileHash: "hash",
          codeChunk: "export const x = 1",
          startLine: 1,
          endLine: 1,
        },
      },
    ])

    const request = req(client.upsert)
    expect((request.data as Req[])[0]).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      type: "point",
      filePath: "src/index.ts",
      path0: "src",
      path1: "index.ts",
      index_schema: 1,
      embedding_dimension: 3,
    })
  })

  test("searches with directory filters and returns scores above the threshold", async () => {
    const store = new MilvusVectorStore(workspacePath, "localhost:19530", 3, undefined, undefined, profile)
    const client = clients[0]!
    client.search.mockResolvedValue(
      ok([
        {
          id: "11111111-1111-4111-8111-111111111111",
          score: 0.91,
          filePath: "src/index.ts",
          fileHash: "hash",
          codeChunk: "export const x = 1",
          startLine: 1,
          endLine: 1,
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          score: 0.2,
          filePath: "src/low.ts",
          fileHash: "hash",
          codeChunk: "low",
          startLine: 1,
          endLine: 1,
        },
      ]),
    )

    const results = await store.search([1, 0, 0], "src", 0.4, 5)

    expect(results).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        score: 0.91,
        payload: {
          filePath: "src/index.ts",
          fileHash: "hash",
          codeChunk: "export const x = 1",
          startLine: 1,
          endLine: 1,
        },
      },
    ])
    const request = req(client.search)
    expect(request.filter).toBe('type != "metadata" AND path0 == "src"')
    expect(request.limit).toBe(5)
    expect(request.annsField).toBe("vector")
    expect(request.searchParams).toEqual({ metric_type: "COSINE", params: {} })
  })

  test("deletes normalized file paths with escaped string literals", async () => {
    const store = new MilvusVectorStore(workspacePath, "localhost:19530", 3, undefined, undefined, profile)
    const client = clients[0]!
    client.hasCollection.mockResolvedValue(ok({ has: true }))

    await store.deletePointsByMultipleFilePaths(["/workspace/project/src/index.ts", 'docs/quote"file.ts'])

    const request = req(client.delete)
    expect(request.filter).toBe('filePath in ["src/index.ts", "docs/quote\\"file.ts"]')
    expect(client.flushCollection).toHaveBeenCalledTimes(1)
  })

  test("stores completion metadata, flushes it, and requires indexed data rows", async () => {
    const store = new MilvusVectorStore(workspacePath, "localhost:19530", 3, undefined, undefined, profile)
    const client = clients[0]!
    client.hasCollection.mockResolvedValue(ok({ has: true }))
    client.query.mockResolvedValue(ok([{ id: "point" }]))
    client.get.mockResolvedValue(
      ok([
        {
          index_schema: 1,
          indexing_complete: true,
          embedding_provider: "openai",
          embedding_model_id: "text-embedding-3-small",
          embedding_dimension: 3,
        },
      ]),
    )

    await store.markIndexingComplete()
    const metadata = (req(client.upsert).data as Req[])[0]
    expect(metadata).toMatchObject({
      type: "metadata",
      indexing_complete: true,
      embedding_provider: "openai",
      embedding_model_id: "text-embedding-3-small",
      embedding_dimension: 3,
    })
    expect(client.flushCollection).toHaveBeenCalledTimes(1)

    await expect(store.hasIndexedData()).resolves.toBe(true)
  })
})
