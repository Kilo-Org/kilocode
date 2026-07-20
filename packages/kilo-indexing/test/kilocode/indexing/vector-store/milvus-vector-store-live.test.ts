import { describe, expect, test } from "bun:test"
import { randomUUID } from "crypto"
import os from "os"
import path from "path"
import { MilvusVectorStore } from "../../../../src/indexing/vector-store/milvus-vector-store"

const address = process.env.MILVUS_TEST_ADDRESS ?? process.env.MILVUS_ADDRESS
const token = process.env.MILVUS_TEST_TOKEN ?? process.env.MILVUS_TOKEN
const database = process.env.MILVUS_TEST_DATABASE ?? process.env.MILVUS_DATABASE
const liveTest = address ? test : test.skip

async function cleanup(store: MilvusVectorStore): Promise<void> {
  await store.deleteCollection()
  expect(await store.collectionExists()).toBe(false)
}

describe("MilvusVectorStore live backend", () => {
  liveTest(
    "indexes, searches, filters, and deletes points",
    async () => {
      const workspace = path.join(os.tmpdir(), `kilo-milvus-${randomUUID()}`)
      const store = new MilvusVectorStore(workspace, address, 2, token, database, {
        provider: "openai",
        modelId: "test-embedding",
        dimension: 2,
      })

      try {
        await cleanup(store)
        expect(await store.initialize()).toBe(true)
        await store.upsertPoints([
          {
            id: "11111111-1111-4111-8111-111111111111",
            vector: [1, 0],
            payload: {
              filePath: "src/alpha.ts",
              fileHash: "alpha",
              codeChunk: "export const alpha = 1",
              startLine: 1,
              endLine: 1,
            },
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            vector: [0, 1],
            payload: {
              filePath: "docs/beta.md",
              fileHash: "beta",
              codeChunk: "# beta",
              startLine: 1,
              endLine: 1,
            },
          },
        ])
        await store.markIndexingComplete()

        expect(await store.hasIndexedData()).toBe(true)

        const all = await store.search([1, 0], undefined, 0, 2)
        expect(all[0]?.payload?.filePath).toBe("src/alpha.ts")
        expect(all[0]?.score).toBeGreaterThanOrEqual(all[1]?.score ?? 0)

        const docs = await store.search([0, 1], "docs", 0, 2)
        expect(docs.map((item) => item.payload?.filePath)).toEqual(["docs/beta.md"])

        await store.deletePointsByFilePath("src/alpha.ts")
        const afterDelete = await store.search([1, 0], undefined, 0, 5)
        expect(afterDelete.map((item) => item.payload?.filePath)).not.toContain("src/alpha.ts")
      } finally {
        await cleanup(store)
      }
    },
    180_000,
  )

  liveTest(
    "recreates a populated collection on embedding profile changes in one initialize call",
    async () => {
      const workspace = path.join(os.tmpdir(), `kilo-milvus-profile-${randomUUID()}`)
      const storeA = new MilvusVectorStore(workspace, address, 2, token, database, {
        provider: "openai",
        modelId: "test-embedding-a",
        dimension: 2,
      })
      const storeB = new MilvusVectorStore(workspace, address, 2, token, database, {
        provider: "openai",
        modelId: "test-embedding-b",
        dimension: 2,
      })

      try {
        await cleanup(storeA)
        expect(await storeA.initialize()).toBe(true)
        await storeA.upsertPoints([
          {
            id: "33333333-3333-4333-8333-333333333333",
            vector: [1, 0],
            payload: {
              filePath: "src/profile-a.ts",
              fileHash: "profile-a",
              codeChunk: "export const profileA = true",
              startLine: 1,
              endLine: 1,
            },
          },
        ])
        await storeA.markIndexingComplete()
        expect(await storeA.hasIndexedData()).toBe(true)

        expect(await storeB.initialize()).toBe(true)
        expect(await storeB.hasIndexedData()).toBe(false)

        await storeB.upsertPoints([
          {
            id: "44444444-4444-4444-8444-444444444444",
            vector: [0, 1],
            payload: {
              filePath: "src/profile-b.ts",
              fileHash: "profile-b",
              codeChunk: "export const profileB = true",
              startLine: 1,
              endLine: 1,
            },
          },
        ])
        await storeB.markIndexingComplete()

        const newRows = await storeB.search([0, 1], undefined, 0, 5)
        expect(newRows[0]?.payload?.filePath).toBe("src/profile-b.ts")
        const oldRows = await storeB.search([1, 0], undefined, 0, 5)
        expect(oldRows.map((item) => item.payload?.filePath)).not.toContain("src/profile-a.ts")
      } finally {
        await cleanup(storeB)
      }
    },
    180_000,
  )
})
