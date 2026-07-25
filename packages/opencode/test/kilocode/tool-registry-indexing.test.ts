import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { KiloIndexing } from "../../src/kilocode/indexing"
import { KilocodeBootstrap } from "../../src/kilocode/bootstrap"
import { KilocodeWatcher } from "../../src/kilocode/watcher"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { InstanceState } from "../../src/effect/instance-state"
import { KiloToolRegistry } from "../../src/kilocode/tool/registry"
import { Provider } from "../../src/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "../../src/session/session"
import { SessionSummary } from "../../src/session/summary"
import { ToolRegistry } from "../../src/tool/registry"
import type * as Tool from "../../src/tool/tool"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(Agent.defaultLayer, ToolRegistry.defaultLayer, node))
const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("kilocode tool registry indexing", () => {
  const logger = Log.create({ service: "kilocode-tool-registry" })

  it.live("omits semantic_search without waiting for slow indexing startup", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const avail = spyOn(KiloIndexing, "available").mockImplementation(() => new Promise<boolean>(() => {}))

          try {
            const registry = yield* ToolRegistry.Service
            const ids = yield* registry.ids()

            expect(ids).not.toContain("semantic_search")
            expect(ids).not.toContain("codesearch")
            expect(ids).toContain("question")
            expect(ids).toContain("read")
            expect(ids).toContain("suggest")
            expect(avail).not.toHaveBeenCalled()
          } finally {
            avail.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("registers semantic search from config even when readiness throws", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const err = new Error("ready failed")
          const ready = spyOn(KiloIndexing, "ready").mockImplementation(() => {
            throw err
          })
          const warn = spyOn(logger, "warn").mockImplementation(() => {})

          try {
            const registry = yield* ToolRegistry.Service
            const ids = yield* registry.ids()

            expect(ids).toContain("semantic_search")
            expect(ids).toContain("question")
            expect(ids).toContain("read")
            expect(ids).toContain("suggest")
            expect(warn).not.toHaveBeenCalled()
          } finally {
            ready.mockRestore()
            warn.mockRestore()
          }
        }),
      { git: true, config: { indexing: { enabled: true } } },
    ),
  )

  it.live("registers semantic search from config even when readiness rejects", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const err = new Error("ready rejected")
          const ready = spyOn(KiloIndexing, "ready").mockImplementation(() => Promise.reject(err) as unknown as boolean)
          const warn = spyOn(logger, "warn").mockImplementation(() => {})

          try {
            const registry = yield* ToolRegistry.Service
            const ids = yield* registry.ids()

            expect(ids).toContain("semantic_search")
            expect(ids).toContain("question")
            expect(ids).toContain("read")
            expect(ids).toContain("suggest")
            expect(warn).not.toHaveBeenCalled()
          } finally {
            ready.mockRestore()
            warn.mockRestore()
          }
        }),
      { git: true, config: { indexing: { enabled: true } } },
    ),
  )

  it.live("registers semantic_search when indexing is enabled", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ready = spyOn(KiloIndexing, "ready").mockReturnValue(true)

          try {
            const registry = yield* ToolRegistry.Service
            const ids = yield* registry.ids()

            expect(ids).toContain("semantic_search")
          } finally {
            ready.mockRestore()
          }
        }),
      { git: true, config: { indexing: { enabled: true } } },
    ),
  )

  it.live("omits semantic_search hint from glob and grep descriptions when indexing is not ready", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ready = spyOn(KiloIndexing, "ready").mockReturnValue(false)

          try {
            const agent = yield* Agent.Service
            const build = yield* agent.get("build")
            const registry = yield* ToolRegistry.Service
            const tools = yield* registry.tools({ ...ref, agent: build })
            const glob = tools.find((tool) => tool.id === "glob")?.description ?? ""
            const grep = tools.find((tool) => tool.id === "grep")?.description ?? ""

            expect(glob).not.toContain("semantic_search")
            expect(grep).not.toContain("semantic_search")
          } finally {
            ready.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("includes semantic_search hint in glob and grep descriptions when indexing is enabled", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ready = spyOn(KiloIndexing, "ready").mockReturnValue(true)

          try {
            const agent = yield* Agent.Service
            const build = yield* agent.get("build")
            const registry = yield* ToolRegistry.Service
            const tools = yield* registry.tools({ ...ref, agent: build })
            const ids = tools.map((tool) => tool.id)
            const glob = tools.find((tool) => tool.id === "glob")?.description ?? ""
            const grep = tools.find((tool) => tool.id === "grep")?.description ?? ""

            expect(ids).toContain("semantic_search")
            expect(glob).toContain("semantic_search")
            expect(grep).toContain("semantic_search")
          } finally {
            ready.mockRestore()
          }
        }),
      { git: true, config: { indexing: { enabled: true } } },
    ),
  )

  it.live("omits interactive_terminal from subagent definitions", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const prev = process.env["KILO_CLIENT"]
        process.env["KILO_CLIENT"] = "cli"
        return prev
      }),
      () =>
        provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              const agent = yield* Agent.Service
              const build = yield* agent.get("build")
              const explore = yield* agent.get("explore")
              const registry = yield* ToolRegistry.Service
              const primary = yield* registry.tools({ ...ref, agent: build })
              const subagent = yield* registry.tools({ ...ref, agent: explore })

              expect(primary.map((tool) => tool.id)).toContain("interactive_terminal")
              expect(subagent.map((tool) => tool.id)).not.toContain("interactive_terminal")
            }),
          {
            git: true,
            config: { permission: { interactive_terminal: "allow" } },
          },
        ),
      (prev) =>
        Effect.sync(() => {
          if (prev === undefined) delete process.env["KILO_CLIENT"]
          if (prev !== undefined) process.env["KILO_CLIENT"] = prev
        }),
    ),
  )

  test("enables semantic search from indexing configuration before the index is ready", () => {
    expect(
      KiloToolRegistry.indexing({
        indexing: { enabled: true },
      }),
    ).toBe(true)
    expect(
      KiloToolRegistry.indexing({
        indexing: { enabled: false },
      }),
    ).toBe(false)
    expect(KiloToolRegistry.indexing({}, { indexing: { enabled: true } })).toBe(true)
  })

  it.live("omits memory tools when project memory is disabled but keeps kilo_local_recall", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          const build = yield* agent.get("build")
          const registry = yield* ToolRegistry.Service
          const tools = yield* registry.tools({ ...ref, agent: build })
          const ids = tools.map((tool) => tool.id)

          expect(ids).not.toContain("kilo_memory_recall")
          expect(ids).not.toContain("kilo_memory_save")
          // kilo_local_recall is a transcript-recall tool gated by `recall: "ask"` in agent
          // permissions; it must NOT be coupled to project-memory enablement.
          expect(ids).toContain("kilo_local_recall")
        }),
      { git: true },
    ),
  )

  it.live("memoryToolsEnabled coalesces consecutive probes within the TTL", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const probe = spyOn(KiloMemory, "toolEnabled")

          try {
            const a = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })
            const b = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })
            const c = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })

            expect([a, b, c]).toEqual([false, false, false])
            // Cache hit: only the first call should reach KiloMemory.toolEnabled.
            expect(probe).toHaveBeenCalledTimes(1)
          } finally {
            probe.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("memoryToolsEnabled reflects enable/disable immediately after invalidate", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const root = (yield* Effect.promise(() => KiloMemory.prepare({ ctx }))).toString()

          const first = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })
          expect(first).toBe(false)

          yield* Effect.promise(() => KiloMemory.enable({ ctx }))

          // The bootstrap MemoryEvents subscriber invalidates on mutation; call it directly here.
          KiloToolRegistry.invalidateMemoryEnabled(root)
          const afterEnable = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })
          expect(afterEnable).toBe(true)

          yield* Effect.promise(() => KiloMemory.disable({ ctx }))

          KiloToolRegistry.invalidateMemoryEnabled(root)
          const afterDisable = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })
          expect(afterDisable).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("includes memory tools when project memory is enabled", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          yield* Effect.promise(() => KiloMemory.enable({ ctx }))

          const agent = yield* Agent.Service
          const build = yield* agent.get("build")
          const registry = yield* ToolRegistry.Service
          const tools = yield* registry.tools({ ...ref, agent: build })
          const ids = tools.map((tool) => tool.id)

          expect(ids).toContain("kilo_memory_recall")
          expect(ids).toContain("kilo_memory_save")
          expect(ids).toContain("kilo_local_recall")
        }),
      { git: true },
    ),
  )

  test("conditionally includes Kilo registry extras", () => {
    const prev = process.env["KILO_CLIENT"]
    const def = (id: string): Tool.Def => ({
      id,
      description: id,
      parameters: Schema.String,
      execute: () => Effect.succeed({ title: id, output: id, metadata: {} }),
    })
    const tools = {
      codebase: def("codebase_search"),
      semantic: def("semantic_search"),
      recall: def("recall"),
      managerModels: def("agent_manager_models"),
      memory: def("kilo_memory_recall"),
      save: def("kilo_memory_save"),
      manager: def("agent_manager"),
      process: def("background_process"),
      image: def("generate_image"),
      terminal: def("interactive_terminal"),
      notify: def("notify_user"),
      notebookRead: def("notebook_read"),
      notebookEdit: def("notebook_edit"),
      notebookExecute: def("notebook_execute"),
    }

    try {
      process.env["KILO_CLIENT"] = "cli"
      expect(KiloToolRegistry.extra(tools, {}).map((tool) => tool.id)).toEqual([
        "semantic_search",
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "background_process",
        "interactive_terminal",
        "notify_user",
      ])
      expect(KiloToolRegistry.extra(tools, { experimental: { codebase_search: true } }).map((tool) => tool.id)).toEqual(
        [
          "codebase_search",
          "semantic_search",
          "kilo_memory_recall",
          "kilo_memory_save",
          "recall",
          "background_process",
          "interactive_terminal",
          "notify_user",
        ],
      )
      expect(
        KiloToolRegistry.extra(tools, { experimental: { codebase_search: true, image_generation: true } }).map(
          (tool) => tool.id,
        ),
      ).toEqual([
        "codebase_search",
        "generate_image",
        "semantic_search",
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "background_process",
        "interactive_terminal",
        "notify_user",
      ])

      process.env["KILO_CLIENT"] = "vscode"
      expect(KiloToolRegistry.extra(tools, { experimental: { codebase_search: true } }).map((tool) => tool.id)).toEqual(
        [
          "codebase_search",
          "semantic_search",
          "kilo_memory_recall",
          "kilo_memory_save",
          "recall",
          "background_process",
          "agent_manager_models",
          "agent_manager",
          "notify_user",
        ],
      )
      expect(
        KiloToolRegistry.extra(tools, {
          experimental: { codebase_search: true, native_notebook_tools: true },
        }).map((tool) => tool.id),
      ).toEqual([
        "codebase_search",
        "semantic_search",
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "background_process",
        "agent_manager_models",
        "agent_manager",
        "notebook_read",
        "notebook_edit",
        "notebook_execute",
        "notify_user",
      ])
      expect(KiloToolRegistry.extra({ ...tools, semantic: undefined }, {}).map((tool) => tool.id)).toEqual([
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "background_process",
        "agent_manager_models",
        "agent_manager",
        "notify_user",
      ])

      process.env["KILO_CLIENT"] = "desktop"
      expect(KiloToolRegistry.extra(tools, {}).map((tool) => tool.id)).toEqual([
        "semantic_search",
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "notify_user",
      ])

      process.env["KILO_CLIENT"] = "run"
      expect(KiloToolRegistry.extra(tools, {}).map((tool) => tool.id)).toEqual([
        "semantic_search",
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "notify_user",
      ])

      process.env["KILO_CLIENT"] = "acp"
      expect(KiloToolRegistry.extra(tools, {}).map((tool) => tool.id)).toEqual([
        "semantic_search",
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "notify_user",
      ])
    } finally {
      if (prev === undefined) delete process.env["KILO_CLIENT"]
      if (prev !== undefined) process.env["KILO_CLIENT"] = prev
    }
  })

  test("logs indexing bootstrap failures without blocking session bootstrap", async () => {
    const logger = Log.create({ service: "kilocode-bootstrap" })
    const err = new Error("indexing init failed")
    const calls: string[] = []
    const sessions = Layer.succeed(
      KiloSessions.Service,
      KiloSessions.Service.of({
        init: () => Effect.sync(() => calls.push("sessions")),
        sendAgentNotification: () => Effect.succeed({ ok: false as const, reason: "not_connected" }),
      }),
    )
    const bus = Layer.succeed(
      Bus.Service,
      Bus.Service.of({
        publish: () => Effect.void,
        subscribe: () => Effect.succeed(Stream.empty),
        subscribeAll: () => Effect.succeed(Stream.empty),
        subscribeCallback: () => Effect.succeed(() => {}),
        subscribeAllCallback: () => Effect.succeed(() => {}),
      }),
    )
    const memory = Layer.succeed(MemoryService.Service, MemoryService.make())
    const session = Layer.succeed(Session.Service, {} as Session.Interface)
    const summary = Layer.succeed(SessionSummary.Service, {} as SessionSummary.Interface)
    const provider = Layer.succeed(Provider.Service, {} as Provider.Interface)
    const watcher = Layer.succeed(KilocodeWatcher.Service, KilocodeWatcher.Service.of({ init: () => Effect.void }))
    const indexing = spyOn(KiloIndexing, "init").mockRejectedValue(err)
    const warn = spyOn(logger, "warn").mockImplementation(() => {})

    try {
      await Effect.runPromise(
        KilocodeBootstrap.Service.use((svc) => svc.init()).pipe(
          Effect.provide(
            KilocodeBootstrap.layer.pipe(Layer.provide([sessions, bus, memory, session, summary, provider, watcher])),
          ),
          Effect.scoped,
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(calls).toEqual(["sessions"])
      expect(indexing).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith("indexing bootstrap failed", { err })
    } finally {
      indexing.mockRestore()
      warn.mockRestore()
    }
  })
})
