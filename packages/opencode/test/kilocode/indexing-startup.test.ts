import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { CodeIndexManager } from "@kilocode/kilo-indexing/engine"
import { normalizeIndexingStatus } from "@kilocode/kilo-indexing/status"
import type { Config } from "../../src/config/config"
import { GlobalBus } from "../../src/bus/global"
import { KiloIndexing } from "../../src/kilocode/indexing"
import { IndexingWorker } from "../../src/kilocode/indexing-worker-client"
import { WithInstance } from "../../src/project/with-instance"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const fetch = global.fetch

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

const unset: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    provider: "ollama",
    vectorStore: "qdrant",
    ollama: {
      baseUrl: "http://127.0.0.1:1",
    },
  },
}
const inactive: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: false,
    provider: "ollama",
    vectorStore: "qdrant",
  },
}
const kilo: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: true,
    vectorStore: "qdrant",
  },
}
const implicitOpenAi: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: true,
    vectorStore: "qdrant",
    openai: {
      apiKey: "openai-token",
    },
  },
}
const staleKilo: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: true,
    provider: "kilo",
    model: "custom/model",
    dimension: 2048,
    vectorStore: "qdrant",
  },
}
const configDir = process.env["KILO_CONFIG_DIR"]
const disabled = process.env["KILO_DISABLE_CODEBASE_INDEXING"]
const error = new Error("test indexing initialization failed")

function inline(directory: string, root: string, hooks: IndexingWorker.Hooks): IndexingWorker.Driver {
  const manager = new CodeIndexManager(directory, root)
  const progress = manager.onProgressUpdate.on(() => hooks.status(normalizeIndexingStatus(manager)))
  const telemetry = manager.onTelemetry.on(hooks.telemetry)

  return {
    async init(input) {
      await manager.initialize(input)
      return normalizeIndexingStatus(manager)
    },
    search: (query, directoryPrefix) => manager.searchIndex(query, directoryPrefix),
    async dispose() {
      progress.dispose()
      telemetry.dispose()
      manager.dispose()
    },
  }
}

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

beforeEach(() => {
  IndexingWorker.override(inline)
})

afterEach(async () => {
  IndexingWorker.override()
  if (configDir === undefined) delete process.env["KILO_CONFIG_DIR"]
  else process.env["KILO_CONFIG_DIR"] = configDir
  if (disabled === undefined) delete process.env["KILO_DISABLE_CODEBASE_INDEXING"]
  else process.env["KILO_DISABLE_CODEBASE_INDEXING"] = disabled
  global.fetch = fetch
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
      await WithInstance.provide({
        directory: tmp.path,
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

  test("keeps degraded indexing queryable but releases its failed engine", async () => {
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockRejectedValue(error)
    const dispose = spyOn(CodeIndexManager.prototype, "dispose")

    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          const status = await wait(() => KiloIndexing.current(), "Error")

          expect(status.state).toBe("Error")
          expect(status.message).toContain("Failed to initialize: test indexing initialization failed")
          expect(await KiloIndexing.available()).toBe(false)
          expect(KiloIndexing.ready()).toBe(false)
          expect(await KiloIndexing.search("boot failure")).toEqual([])
          expect(dispose).toHaveBeenCalledTimes(1)
        },
      })
    } finally {
      dispose.mockRestore()
      init.mockRestore()
    }
  })

  test("reports not ready while initialization is in flight", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const gate = Promise.withResolvers<{ requiresRestart: boolean }>()
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockImplementation(() => gate.promise)

    try {
      await WithInstance.provide({
        directory: tmp.path,
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

  test("stays disabled when indexing enablement is unset", async () => {
    await using tmp = await tmpdir({ git: true, config: unset })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const init = spyOn(CodeIndexManager.prototype, "initialize")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const status = await wait(() => KiloIndexing.current(), "Disabled")

        expect(status).toMatchObject({
          state: "Disabled",
          message: "Indexing disabled.",
        })
        expect(await KiloIndexing.available()).toBe(false)
        expect(KiloIndexing.ready()).toBe(false)
        expect(await KiloIndexing.search("disabled")).toEqual([])
        expect(init).not.toHaveBeenCalled()
      },
    })
  })

  test("does not allocate an engine when indexing configuration is disabled", async () => {
    const created: string[] = []
    IndexingWorker.override((directory, root, hooks) => {
      created.push(directory)
      return inline(directory, root, hooks)
    })

    await using tmp = await tmpdir({ git: true, config: inactive })
    process.env["KILO_CONFIG_DIR"] = tmp.path

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const status = await wait(() => KiloIndexing.current(), "Disabled")

        expect(status).toMatchObject({
          state: "Disabled",
          message: "Indexing disabled.",
        })
        expect(await KiloIndexing.available()).toBe(false)
        expect(KiloIndexing.ready()).toBe(false)
        expect(await KiloIndexing.search("disabled")).toEqual([])
        expect(created).toEqual([])
      },
    })
  })

  test("enriches Kilo provider config from env auth", async () => {
    global.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            defaultModel: "mistralai/mistral-embed-2312",
            models: [
              { id: "mistralai/mistral-embed-2312", name: "Mistral Embed 2312", dimension: 1024, scoreThreshold: 0.35 },
            ],
            aliases: {},
          }),
        ),
      )) as unknown as typeof global.fetch
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockResolvedValue({ requiresRestart: false })
    const key = process.env.KILO_API_KEY
    const org = process.env.KILO_ORG_ID

    await using tmp = await tmpdir({ git: true, config: kilo })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env.KILO_API_KEY = "kilo-token"
    process.env.KILO_ORG_ID = "org_123"

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)
          expect(init.mock.calls[0]?.[0]).toMatchObject({
            embedderProvider: "kilo",
            kiloApiKey: "kilo-token",
            kiloOrganizationId: "org_123",
            modelId: "mistralai/mistral-embed-2312",
            modelDimension: 1024,
            searchMinScore: 0.35,
          })
        },
      })
    } finally {
      if (key === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = key
      if (org === undefined) delete process.env.KILO_ORG_ID
      else process.env.KILO_ORG_ID = org
      init.mockRestore()
    }
  })

  test("falls back from unsupported stored Kilo models to the hosted default", async () => {
    global.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            defaultModel: "mistralai/mistral-embed-2312",
            models: [
              { id: "mistralai/mistral-embed-2312", name: "Mistral Embed 2312", dimension: 1024, scoreThreshold: 0.35 },
            ],
            aliases: {},
          }),
        ),
      )) as unknown as typeof global.fetch
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockResolvedValue({ requiresRestart: false })
    const key = process.env.KILO_API_KEY

    await using tmp = await tmpdir({ git: true, config: staleKilo })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env.KILO_API_KEY = "kilo-token"

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)
          expect(init.mock.calls[0]?.[0]).toMatchObject({
            embedderProvider: "kilo",
            modelId: "mistralai/mistral-embed-2312",
            modelDimension: 1024,
            searchMinScore: 0.35,
          })
        },
      })
    } finally {
      if (key === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = key
      init.mockRestore()
    }
  })

  test("keeps configured dimensions for supported Kilo models", async () => {
    global.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            defaultModel: "mistralai/mistral-embed-2312",
            models: [
              { id: "mistralai/mistral-embed-2312", name: "Mistral Embed 2312", dimension: 1024, scoreThreshold: 0.35 },
              {
                id: "openai/text-embedding-3-small",
                name: "OpenAI Text Embedding 3 Small",
                dimension: 1536,
                scoreThreshold: 0.4,
              },
            ],
            aliases: {},
          }),
        ),
      )) as unknown as typeof global.fetch
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockResolvedValue({ requiresRestart: false })
    const key = process.env.KILO_API_KEY
    const config: Partial<Config.Info> = {
      ...staleKilo,
      indexing: {
        ...staleKilo.indexing,
        model: "openai/text-embedding-3-small",
        dimension: 256,
      },
    }

    await using tmp = await tmpdir({ git: true, config })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env.KILO_API_KEY = "kilo-token"

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)
          expect(init.mock.calls[0]?.[0]).toMatchObject({
            embedderProvider: "kilo",
            modelId: "openai/text-embedding-3-small",
            modelDimension: 256,
          })
        },
      })
    } finally {
      if (key === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = key
      init.mockRestore()
    }
  })

  test("does not execute stored Kilo models when the hosted catalog is unavailable", async () => {
    global.fetch = (() => Promise.resolve(new Response(undefined, { status: 500 }))) as unknown as typeof global.fetch
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockResolvedValue({ requiresRestart: false })
    const key = process.env.KILO_API_KEY

    await using tmp = await tmpdir({ git: true, config: staleKilo })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env.KILO_API_KEY = "kilo-token"

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)
          expect(init.mock.calls[0]?.[0]).toMatchObject({ embedderProvider: "kilo" })
          expect(init.mock.calls[0]?.[0].modelId).toBeUndefined()
          expect(init.mock.calls[0]?.[0].modelDimension).toBeUndefined()
        },
      })
    } finally {
      if (key === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = key
      init.mockRestore()
    }
  })

  test("does not default to Kilo when an existing provider config is present", async () => {
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockResolvedValue({ requiresRestart: false })
    const key = process.env.KILO_API_KEY

    await using tmp = await tmpdir({ git: true, config: implicitOpenAi })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env.KILO_API_KEY = "kilo-token"

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)
          expect(init.mock.calls[0]?.[0]).toMatchObject({
            embedderProvider: "openai",
            openAiKey: "openai-token",
          })
        },
      })
    } finally {
      if (key === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = key
      init.mockRestore()
    }
  })

  test("stays disabled when VS Code starts without a workspace folder", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env["KILO_DISABLE_CODEBASE_INDEXING"] = "vscode-no-workspace"
    const init = spyOn(CodeIndexManager.prototype, "initialize")

    try {
      await WithInstance.provide({
        directory: tmp.path,
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
