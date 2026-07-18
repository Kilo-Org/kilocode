import { describe, expect, test } from "bun:test"
import { randomUUID } from "crypto"
import os from "os"
import path from "path"
import { MilvusVectorStore } from "../../../../src/indexing/vector-store/milvus-vector-store"

const address = process.env.MILVUS_TEST_ADDRESS ?? process.env.MILVUS_ADDRESS
const token = process.env.MILVUS_TEST_TOKEN ?? process.env.MILVUS_TOKEN
const database = process.env.MILVUS_TEST_DATABASE ?? process.env.MILVUS_DATABASE ?? process.env.ZILLIZ_DATABASE
const liveTest = address ? test : test.skip

async function cleanup(store: MilvusVectorStore): Promise<void> {
  try {
    await store.deleteCollection()
  } catch (error) {
    console.warn("Milvus live test cleanup failed", error)
  }
}

describe("MilvusVectorStore live backend", () => {
  liveTest("indexes, searches, filters, and deletes points", async () => {
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
  })
})
