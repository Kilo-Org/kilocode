import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { Config } from "../../src/config/config"
import { KiloIndexing } from "../../src/kilocode/indexing"
import { IndexingWorker } from "../../src/kilocode/indexing-worker-client"
import { disposeAllInstances, provideTestInstance, tmpdir } from "../fixture/fixture"

const cfg: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: true,
    provider: "ollama",
    vectorStore: "qdrant",
    ollama: {
      baseUrl: "http://127.0.0.1:1",
    },
  },
}

const configDir = process.env["KILO_CONFIG_DIR"]
const indexed = {
  state: "Complete" as const,
  message: "Index up-to-date.",
  processedFiles: 0,
  totalFiles: 0,
  percent: 100,
}

afterEach(async () => {
  IndexingWorker.override()
  if (configDir === undefined) delete process.env["KILO_CONFIG_DIR"]
  else process.env["KILO_CONFIG_DIR"] = configDir
  await disposeAllInstances()
})

describe("indexing worktrees", () => {
  test("shares the primary checkout index with a linked worktree", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    await Bun.$`git -C ${tmp.path} add kilo.jsonc && git -C ${tmp.path} commit -m config`.quiet()
    const worktree = path.join(tmp.path, ".kilo", "worktrees", "feature")
    await Bun.$`git -C ${tmp.path} worktree add -b feature ${worktree}`.quiet()

    const calls: Array<{ directory: string; baseline?: string }> = []
    IndexingWorker.override((directory) => ({
      async init(_input, baseline) {
        calls.push({ directory, baseline })
        return indexed
      },
      async search() {
        return []
      },
      async dispose() {},
    }))

    await provideTestInstance({
      directory: worktree,
      fn: async () => {
        await KiloIndexing.search("worktree")
        expect((await KiloIndexing.current()).state).toBe("Complete")
        expect(await KiloIndexing.available()).toBe(true)
      },
    })

    expect(calls).toEqual([{ directory: worktree, baseline: tmp.path }])
  }, 15_000)

  test("does not classify an ordinary directory from its pathname", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const directory = path.join(tmp.path, ".kilocode", "worktrees", "feature")
    await mkdir(directory, { recursive: true })
    await Bun.write(path.join(directory, "file.ts"), "export const value = 1\n")

    const calls: Array<string | undefined> = []
    IndexingWorker.override(() => ({
      async init(_input, baseline) {
        calls.push(baseline)
        return indexed
      },
      async search() {
        return []
      },
      async dispose() {},
    }))

    await provideTestInstance({
      directory,
      fn: async () => {
        await KiloIndexing.search("ordinary directory")
        expect((await KiloIndexing.current()).state).toBe("Complete")
        expect(await KiloIndexing.available()).toBe(true)
      },
    })

    expect(calls).toEqual([undefined])
  })
})
