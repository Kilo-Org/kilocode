import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import type { Config } from "../../src/config"
import { AppRuntime } from "../../src/effect/app-runtime"
import { KiloIndexing } from "../../src/kilocode/indexing"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const cfg: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  experimental: {
    semantic_indexing: true,
  },
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

afterEach(async () => {
  if (configDir === undefined) delete process.env["KILO_CONFIG_DIR"]
  else process.env["KILO_CONFIG_DIR"] = configDir
  await Instance.disposeAll()
})

describe("indexing worktree disable", () => {
  test("returns disabled status in .kilo/worktrees paths", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const dir = `${tmp.path}/.kilo/worktrees/feature`
    await mkdir(dir, { recursive: true })

    await Instance.provide({
      directory: dir,
      init: () => AppRuntime.runPromise(InstanceBootstrap),
      fn: async () => {
        const status = await KiloIndexing.current()

        expect(status.state).toBe("Disabled")
        expect(status.message).toBe("Indexing is disabled in worktree sessions. Use the main workspace for indexing.")
        expect(await KiloIndexing.available()).toBe(false)
        expect(KiloIndexing.ready()).toBe(false)
        expect(await KiloIndexing.search("worktree")).toEqual([])
      },
    })
  })

  test("returns disabled status in legacy .kilocode/worktrees paths", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const dir = `${tmp.path}/.kilocode/worktrees/feature`
    await mkdir(dir, { recursive: true })

    await Instance.provide({
      directory: dir,
      init: () => AppRuntime.runPromise(InstanceBootstrap),
      fn: async () => {
        const status = await KiloIndexing.current()

        expect(status.state).toBe("Disabled")
        expect(status.message).toBe("Indexing is disabled in worktree sessions. Use the main workspace for indexing.")
        expect(await KiloIndexing.available()).toBe(false)
        expect(KiloIndexing.ready()).toBe(false)
      },
    })
  })
})
