import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { CodeIndexManager } from "@kilocode/kilo-indexing/engine"
import type { Config } from "../../src/config/config"
import { GlobalBus } from "../../src/bus/global"
import { getBootstrapRunEffect } from "../../src/effect/app-runtime"
import { KiloIndexing } from "../../src/kilocode/indexing"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

Log.init({ print: false })

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

const off: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  experimental: {
    semantic_indexing: false,
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
const disabled = process.env["KILO_DISABLE_CODEBASE_INDEXING"]
const error = new Error("test indexing initialization failed")

async function wait(read: () => Promise<KiloIndexing.Status>, state: KiloIndexing.Status["state"]) {
  for (const _ of Array.from({ length: 100 })) {
    const status = await read()
    if (status.state === state) return status
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`indexing did not reach ${state}`)
}

async function called(init: ReturnType<typeof spyOn<CodeIndexManager, "initialize">>) {
  for (const _ of Array.from({ length: 100 })) {
    if (init.mock.calls.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("indexing initialization did not start")
}

afterEach(async () => {
  if (configDir === undefined) delete process.env["KILO_CONFIG_DIR"]
  else process.env["KILO_CONFIG_DIR"] = configDir
  if (disabled === undefined) delete process.env["KILO_DISABLE_CODEBASE_INDEXING"]
  else process.env["KILO_DISABLE_CODEBASE_INDEXING"] = disabled
  await disposeAllInstances()
})

describe("indexing startup degradation", () => {
  test("keeps server routes alive when indexing initialization fails", async () => {
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockRejectedValue(error)

    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path

    try {
      const app = Server.Default().app

      const config = await app.request("/config", {
        headers: {
          "x-kilo-directory": tmp.path,
        },
      })
      expect(config.status).toBe(200)

      const body = await wait(async () => {
        const status = await app.request("/indexing/status", {
          headers: {
            "x-kilo-directory": tmp.path,
          },
        })
        expect(status.status).toBe(200)
        return status.json()
      }, "Error")

      expect(body).toMatchObject({
        state: "Error",
      })
      expect(body.message).toContain("Failed to initialize: test indexing initialization failed")
    } finally {
      init.mockRestore()
    }
  })

  test("reports routes as in progress while initialization is in flight", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const gate = Promise.withResolvers<{ requiresRestart: boolean }>()
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockImplementation(() => gate.promise)

    try {
      const app = Server.Default().app

      const config = await app.request("/config", {
        headers: {
          "x-kilo-directory": tmp.path,
        },
      })
      expect(config.status).toBe(200)
      await called(init)

      const status = await app.request("/indexing/status", {
        headers: {
          "x-kilo-directory": tmp.path,
        },
      })
      expect(status.status).toBe(200)

      const body = await status.json()
      expect(body).toMatchObject({
        state: "In Progress",
        message: "Indexing is initializing.",
      })
    } finally {
      gate.resolve({ requiresRestart: false })
      init.mockRestore()
    }
  })

  test("does not publish initialized status after in-flight startup is disposed", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const gate = Promise.withResolvers<{ requiresRestart: boolean }>()
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockImplementation(() => gate.promise)
    const events: KiloIndexing.Status[] = []
    const on = (data: {
      directory?: string
      payload?: { type?: string; properties?: { status?: KiloIndexing.Status } }
    }) => {
      if (data.directory !== tmp.path) return
      if (data.payload?.type !== KiloIndexing.Event.type) return
      if (data.payload.properties?.status) events.push(data.payload.properties.status)
    }
    GlobalBus.on("event", on)

    try {
      await Instance.provide({
        directory: tmp.path,
        init: await getBootstrapRunEffect(),
        fn: async () => {
          await called(init)
          expect((await KiloIndexing.current()).state).toBe("In Progress")
        },
      })

      await disposeAllInstances()
      gate.resolve({ requiresRestart: false })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(events.some((status) => status.state === "Complete" || status.state === "Standby")).toBe(false)
    } finally {
      GlobalBus.off("event", on)
      gate.resolve({ requiresRestart: false })
      init.mockRestore()
    }
  })

  test("keeps degraded indexing queryable but unavailable", async () => {
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockRejectedValue(error)

    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        init: await getBootstrapRunEffect(),
        fn: async () => {
          const status = await wait(() => KiloIndexing.current(), "Error")

          expect(status.state).toBe("Error")
          expect(status.message).toContain("Failed to initialize: test indexing initialization failed")
          expect(await KiloIndexing.available()).toBe(false)
          expect(KiloIndexing.ready()).toBe(false)
          expect(await KiloIndexing.search("boot failure")).toEqual([])
        },
      })
    } finally {
      init.mockRestore()
    }
  })

  test("reports not ready while initialization is in flight", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const gate = Promise.withResolvers<{ requiresRestart: boolean }>()
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockImplementation(() => gate.promise)

    try {
      await Instance.provide({
        directory: tmp.path,
        init: await getBootstrapRunEffect(),
        fn: async () => {
          await called(init)

          expect(init).toHaveBeenCalled()
          expect(KiloIndexing.ready()).toBe(false)
          expect(await KiloIndexing.available()).toBe(false)
          expect(await KiloIndexing.search("boot failure")).toEqual([])
        },
      })
    } finally {
      gate.resolve({ requiresRestart: false })
      init.mockRestore()
    }
  })

  test("stays disabled when semantic indexing flag is off", async () => {
    await using tmp = await tmpdir({ git: true, config: off })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const init = spyOn(CodeIndexManager.prototype, "initialize")

    await Instance.provide({
      directory: tmp.path,
      init: await getBootstrapRunEffect(),
      fn: async () => {
        const status = await KiloIndexing.current()

        expect(status).toMatchObject({
          state: "Disabled",
          message: "Semantic indexing is disabled. Enable it in the Experimental settings.",
        })
        expect(await KiloIndexing.available()).toBe(false)
        expect(KiloIndexing.ready()).toBe(false)
        expect(await KiloIndexing.search("flag off")).toEqual([])
        expect(init).not.toHaveBeenCalled()
      },
    })
  })

  test("stays disabled when VS Code starts without a workspace folder", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env["KILO_DISABLE_CODEBASE_INDEXING"] = "vscode-no-workspace"
    const init = spyOn(CodeIndexManager.prototype, "initialize")

    try {
      await Instance.provide({
        directory: tmp.path,
        init: await getBootstrapRunEffect(),
        fn: async () => {
          const status = await KiloIndexing.current()

          expect(status).toMatchObject({
            state: "Disabled",
            message: "Codebase indexing is disabled because no workspace folder is open in VS Code.",
          })
          expect(await KiloIndexing.available()).toBe(false)
          expect(KiloIndexing.ready()).toBe(false)
          expect(await KiloIndexing.search("no workspace")).toEqual([])
          expect(init).not.toHaveBeenCalled()
        },
      })
    } finally {
      init.mockRestore()
    }
  })
})
