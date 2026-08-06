import { describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import { mkdir, mkdtemp, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { CodeIndexConfigManager } from "../../../src/indexing/config-manager"
import type { IEmbedder, IVectorStore, VectorStoreSearchResult } from "../../../src/indexing/interfaces"
import { CodeIndexSearchService } from "../../../src/indexing/search-service"
import { CodeIndexStateManager } from "../../../src/indexing/state-manager"
import { WorktreeOverlay } from "../../../src/indexing/worktree-overlay"

const result = (filePath: string, score: number, codeChunk = filePath, fileHash?: string): VectorStoreSearchResult => ({
  id: `${filePath}:${score}`,
  score,
  payload: { filePath, fileHash, codeChunk, startLine: 1, endLine: 1 },
})

const store = (results: VectorStoreSearchResult[], limits: number[]): IVectorStore =>
  ({
    async search(_vector, _prefix, _score, limit) {
      limits.push(limit ?? results.length)
      return results.slice(0, limit)
    },
  }) as unknown as IVectorStore

const embedder = (calls: string[][]): IEmbedder => ({
  async createEmbeddings(texts) {
    calls.push(texts)
    return { embeddings: [[1, 2, 3]] }
  },
  async validateConfiguration() {
    return { valid: true }
  },
  get embedderInfo() {
    return { name: "openai" }
  },
})

const config = (fileExtensions?: string[]) =>
  new CodeIndexConfigManager({
    enabled: true,
    embedderProvider: "openai",
    openAiKey: "test",
    vectorStoreProvider: "lancedb",
    searchMaxResults: 2,
    fileExtensions,
  })

describe("CodeIndexSearchService worktree search", () => {
  test("filters stale results using one vector query", async () => {
    const limits: number[] = []
    const state = new CodeIndexStateManager()
    state.setSystemState("Indexed")
    const service = new CodeIndexSearchService(
      config([".php"]),
      state,
      embedder([]),
      store([result("src/old.ts", 0.99), result("src/first.php", 0.9), result("src/second.php", 0.8)], limits),
    )

    const results = await service.searchIndex("query")

    expect(limits).toEqual([2])
    expect(results.map((item) => item.payload?.filePath)).toEqual(["src/first.php"])
  })

  test("embeds once, hides baseline paths, and merges the current delta", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "search-worktree-"))
    const main = await mkdtemp(path.join(tmpdir(), "search-main-"))
    const content = "src/base.ts"
    const hash = createHash("sha256").update(content).digest("hex")
    await mkdir(path.join(root, "src"), { recursive: true })
    await mkdir(path.join(main, "src"), { recursive: true })
    await writeFile(path.join(root, "src/base.ts"), content)
    await writeFile(path.join(main, "src/base.ts"), content)
    const overlay = new WorktreeOverlay(
      root,
      main,
      new Map([
        ["src/changed.ts", "base"],
        ["src/base.ts", hash],
      ]),
    )
    overlay.reconcile({
      [path.join(root, "src/changed.ts")]: "changed",
      [path.join(root, "src/base.ts")]: hash,
    })

    const baseLimits: number[] = []
    const deltaLimits: number[] = []
    const calls: string[][] = []
    const state = new CodeIndexStateManager()
    state.setSystemState("Indexed")
    const service = new CodeIndexSearchService(
      config(),
      state,
      embedder(calls),
      store([result("src/changed.ts", 0.9, "worktree")], deltaLimits),
      {
        store: store([result("src/changed.ts", 0.99), result("src/base.ts", 0.8, "src/base.ts", hash)], baseLimits),
        overlay,
      },
    )

    const results = await service.searchIndex("query")

    expect(calls).toEqual([["query"]])
    expect(results.map((item) => item.payload?.codeChunk)).toEqual(["worktree", "src/base.ts"])
    expect(baseLimits).toEqual([2, 4])
    expect(deltaLimits).toEqual([2])
  })

  test("rejects live baseline results after the primary checkout changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "search-worktree-"))
    const main = await mkdtemp(path.join(tmpdir(), "search-main-"))
    const content = "export const value = 'worktree'"
    const hash = createHash("sha256").update(content).digest("hex")
    await writeFile(path.join(root, "file.ts"), content)
    await writeFile(path.join(main, "file.ts"), "export const value = 'primary-only'")

    const overlay = new WorktreeOverlay(root, main, new Map([["file.ts", hash]]))
    overlay.reconcile({ [path.join(root, "file.ts")]: hash })
    const state = new CodeIndexStateManager()
    state.setSystemState("Indexed")
    const service = new CodeIndexSearchService(config(), state, embedder([]), store([], []), {
      store: store(
        [
          result(
            "file.ts",
            0.99,
            "export const value = 'primary-only'",
            createHash("sha256").update("export const value = 'primary-only'").digest("hex"),
          ),
        ],
        [],
      ),
      overlay,
    })

    expect(await service.searchIndex("query")).toEqual([])
  })

  test("over-fetches when shadowed baseline results consume the first page", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "search-worktree-"))
    const main = await mkdtemp(path.join(tmpdir(), "search-main-"))
    const hash = (content: string) => createHash("sha256").update(content).digest("hex")
    await mkdir(path.join(root, "src"), { recursive: true })
    await mkdir(path.join(main, "src"), { recursive: true })
    await Promise.all(
      ["c", "d"].flatMap((name) => [
        writeFile(path.join(root, `src/${name}.ts`), `src/${name}.ts`),
        writeFile(path.join(main, `src/${name}.ts`), `src/${name}.ts`),
      ]),
    )
    const overlay = new WorktreeOverlay(
      root,
      main,
      new Map([
        ["src/a.ts", "a"],
        ["src/b.ts", "b"],
        ["src/c.ts", hash("src/c.ts")],
        ["src/d.ts", hash("src/d.ts")],
      ]),
    )
    overlay.reconcile({
      [path.join(root, "src/a.ts")]: "changed-a",
      [path.join(root, "src/b.ts")]: "changed-b",
      [path.join(root, "src/c.ts")]: hash("src/c.ts"),
      [path.join(root, "src/d.ts")]: hash("src/d.ts"),
    })

    const limits: number[] = []
    const state = new CodeIndexStateManager()
    state.setSystemState("Indexed")
    const service = new CodeIndexSearchService(config(), state, embedder([]), store([], []), {
      store: store(
        [
          result("src/a.ts", 0.99),
          result("src/b.ts", 0.98),
          result("src/c.ts", 0.8, "src/c.ts", hash("src/c.ts")),
          result("src/d.ts", 0.7, "src/d.ts", hash("src/d.ts")),
        ],
        limits,
      ),
      overlay,
    })

    const results = await service.searchIndex("query")

    expect(limits).toEqual([2, 4])
    expect(results.map((item) => item.payload?.filePath)).toEqual(["src/c.ts", "src/d.ts"])
  })
})
