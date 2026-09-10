import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createClient } from "@kilocode/client"
import { Memory } from "@kilocode/kilo-memory/memory"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import { MemoryFiles } from "@kilocode/kilo-memory/store"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { ProjectID } from "@opencode-ai/schema/project-id"
import type { CommandEditor } from "@opencode-ai/plugin/effect/command"
import type { Context } from "@opencode-ai/plugin/effect/plugin"
import type { ToolEditor } from "@opencode-ai/plugin/effect/tool"
import type { Tool } from "@opencode-ai/schema/tool"
import { Effect, Stream } from "effect"
import { launch } from "../src/interactive-server"
import {
  createMemoryCaptureGate,
  memoryTurnsAfterMarker,
  memoryTurnsFor,
  memoryTurnsSinceBaseline,
} from "../src/memory-capture"
import type { Layout } from "../src/paths"
import {
  createMemoryPlugin,
  MEMORY_INDEX_MAX_BYTES,
  MemoryStore,
  memoryRoot,
  parseMemoryCommand,
  type MemoryLocation,
} from "../src/memory-plugin"
import { MemoryRpc } from "../src/memory-rpc"
import { memoryUiRequestOptions } from "../src/tui-plugin/memory"
import { fixture } from "./fixture"

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-memory-test-"))
  try {
    await run(path.join(root, "memory"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function location(directory: string): MemoryLocation {
  return {
    directory: AbsolutePath.make(directory),
    project: {
      id: ProjectID.make("project-memory-test"),
      directory: AbsolutePath.make(directory),
      canonical: AbsolutePath.make(directory),
    },
  }
}

test("parses explicit project memory commands", () => {
  expect(parseMemoryCommand("/memory")).toEqual({ kind: "help" })
  expect(parseMemoryCommand("project remember use bun")).toBeUndefined()
  expect(parseMemoryCommand("/memory project remember use bun")).toEqual({
    kind: "operation",
    operation: "remember",
    text: "use bun",
  })
  expect(parseMemoryCommand("/memory project correct the command changed")).toEqual({
    kind: "operation",
    operation: "correct",
    text: "the command changed",
  })
  expect(parseMemoryCommand("/memory purge")).toEqual({
    kind: "usage",
    reason: "Purge requires confirmation. Run /memory purge confirm.",
  })
  expect(parseMemoryCommand("/memory auto on")).toEqual({
    kind: "operation",
    operation: "auto",
    mode: "on",
  })
})

test("groups completed assistant steps under their promoted user message", () => {
  const turns = memoryTurnsFor(
    [
      { type: "user", text: "first request" },
      { type: "assistant", id: "msg_first_step", content: [{ type: "text", text: "first step" }] },
      { type: "assistant", id: "msg_first_complete", content: [{ type: "text", text: "first completion" }] },
      { type: "user", text: "second request" },
      { type: "assistant", id: "msg_second_complete", content: [{ type: "text", text: "second completion" }] },
    ] as unknown as Parameters<typeof memoryTurnsFor>[0],
    { providerID: "fixture", id: "chat" } as Parameters<typeof memoryTurnsFor>[1],
  )

  expect(turns).toHaveLength(2)
  expect(turns[0]).toMatchObject({
    user: "first request",
    assistant: "first step first completion",
    lastAssistantID: "msg_first_complete",
  })
  expect(turns[1]).toMatchObject({ user: "second request", lastAssistantID: "msg_second_complete" })
  expect(memoryTurnsAfterMarker(turns, null).map((turn) => turn.lastAssistantID)).toEqual([
    "msg_first_complete",
    "msg_second_complete",
  ])
  expect(memoryTurnsAfterMarker(turns, "msg_first_complete").map((turn) => turn.lastAssistantID)).toEqual([
    "msg_second_complete",
  ])
})

test("uses only the first and last filtered assistant snapshot boundaries for a capture group", () => {
  const turns = memoryTurnsFor(
    [
      { type: "user", text: "snapshot boundary request" },
      {
        type: "assistant",
        id: "msg_snapshot_first",
        snapshot: { start: "snap_group_start", end: "snap_ignored_middle" },
        content: [{ type: "text", text: "first response step" }],
      },
      {
        type: "assistant",
        id: "msg_snapshot_last",
        snapshot: { start: "snap_ignored_last_start", end: "snap_group_end" },
        content: [{ type: "text", text: "last response step" }],
      },
      {
        type: "user",
        text: "missing boundary request",
      },
      {
        type: "assistant",
        id: "msg_snapshot_missing",
        snapshot: { start: "snap_missing_start" },
        content: [{ type: "text", text: "missing end" }],
      },
    ] as unknown as Parameters<typeof memoryTurnsFor>[0],
    { providerID: "fixture", id: "chat" } as Parameters<typeof memoryTurnsFor>[1],
  )

  expect(String(turns[0]?.snapshots?.start)).toBe("snap_group_start")
  expect(String(turns[0]?.snapshots?.end)).toBe("snap_group_end")
  expect(turns[1]?.snapshots).toBeUndefined()
})

test("keeps consecutive promoted users in the assistant group that answers them", () => {
  const turns = memoryTurnsFor(
    [
      { type: "user", text: "first steer detail" },
      { type: "user", text: "second steer detail" },
      { type: "user", text: "third steer detail" },
      { type: "assistant", id: "msg_batch_complete", content: [{ type: "text", text: "batch answer" }] },
    ] as unknown as Parameters<typeof memoryTurnsFor>[0],
    { providerID: "fixture", id: "chat" } as Parameters<typeof memoryTurnsFor>[1],
  )

  expect(turns).toMatchObject([
    {
      user: "first steer detail second steer detail third steer detail",
      assistant: "batch answer",
      lastAssistantID: "msg_batch_complete",
    },
  ])
})

test("uses only completed Kilo recall tool metadata as recall provenance", () => {
  const model = { providerID: "fixture", id: "chat" } as Parameters<typeof memoryTurnsFor>[1]
  const recalled = memoryTurnsFor(
    [
      { type: "user", text: "Find the saved project decision" },
      {
        type: "assistant",
        id: "msg_recalled",
        content: [
          { type: "text", text: "The decision is to use Bun." },
          {
            type: "tool",
            name: "kilo_memory_recall",
            state: { status: "completed", metadata: { count: 1 } },
          },
        ],
      },
    ] as unknown as Parameters<typeof memoryTurnsFor>[0],
    model,
  )
  expect(recalled[0]?.recalledMemory).toBe(true)

  const empty = memoryTurnsFor(
    [
      { type: "user", text: "Find the saved project decision" },
      {
        type: "assistant",
        id: "msg_empty_recall",
        content: [
          { type: "text", text: "No saved decision matched." },
          {
            type: "tool",
            name: "kilo_memory_recall",
            state: { status: "completed", metadata: { count: 0 } },
          },
        ],
      },
    ] as unknown as Parameters<typeof memoryTurnsFor>[0],
    model,
  )
  expect(empty[0]?.recalledMemory).toBe(false)
})

test("captures every complete group observed after an opted-in execution start without replaying older groups", () => {
  const turns = memoryTurnsFor(
    [
      { type: "user", text: "before auto enabled" },
      { type: "assistant", id: "msg_before", content: [{ type: "text", text: "old result" }] },
      { type: "user", text: "first observed execution" },
      { type: "assistant", id: "msg_first", content: [{ type: "text", text: "first result" }] },
      { type: "user", text: "second observed execution" },
      { type: "assistant", id: "msg_second", content: [{ type: "text", text: "second result" }] },
    ] as unknown as Parameters<typeof memoryTurnsFor>[0],
    { providerID: "fixture", id: "chat" } as Parameters<typeof memoryTurnsFor>[1],
  )
  const gate = createMemoryCaptureGate()
  gate.open({ root: "/tmp/memory", sessionID: "ses_memory" as never, assistantIDs: ["msg_before"] })
  const baseline = gate.take({ root: "/tmp/memory", sessionID: "ses_memory" as never })

  expect(baseline).toBeDefined()
  const eligible = memoryTurnsSinceBaseline(turns, baseline!, "msg_before")
  expect(eligible.map((turn) => turn.lastAssistantID)).toEqual(["msg_first", "msg_second"])
  expect(eligible[0]?.recent).not.toContain("before auto enabled")
  expect(eligible[1]?.recent).toContain("first observed execution")
  expect(eligible[1]?.recent).not.toContain("before auto enabled")
  expect(gate.take({ root: "/tmp/memory", sessionID: "ses_memory" as never })).toBeUndefined()

  gate.open({ root: "/tmp/memory", sessionID: "ses_memory" as never, assistantIDs: ["msg_second"] })
  gate.clear("/tmp/memory")
  expect(gate.take({ root: "/tmp/memory", sessionID: "ses_memory" as never })).toBeUndefined()
})

test("keeps an errored terminal group bounded to its user text for fallback capture", () => {
  const turns = memoryTurnsFor(
    [
      { type: "user", text: "Capture this sufficiently detailed failed request without provider diagnostics." },
      {
        type: "assistant",
        id: "msg_failed",
        content: [],
        error: { type: "provider", message: "provider diagnostics must not be copied" },
      },
    ] as unknown as Parameters<typeof memoryTurnsFor>[0],
    { providerID: "fixture", id: "chat" } as Parameters<typeof memoryTurnsFor>[1],
    "error",
  )

  expect(turns).toMatchObject([
    {
      user: "Capture this sufficiently detailed failed request without provider diagnostics.",
      assistant: "",
      lastAssistantID: "msg_failed",
    },
  ])
})

test("builds memory RPC options from the current TUI location", () => {
  let current: { readonly directory: string; readonly workspaceID?: string } | undefined = {
    directory: "/tmp/memory-left",
    workspaceID: "wrk_left",
  }
  const context = {
    get location() {
      return current
    },
    data: { location: { default: () => ({ directory: "/tmp/memory-default" }) } },
  } as unknown as Parameters<typeof memoryUiRequestOptions>[0]
  const signal = new AbortController().signal

  expect(memoryUiRequestOptions(context, signal)).toEqual({
    signal,
    location: { directory: "/tmp/memory-left", workspace: "wrk_left" },
  })
  current = { directory: "/tmp/memory-right" }
  expect(memoryUiRequestOptions(context)).toEqual({ location: { directory: "/tmp/memory-right" } })
  current = undefined
  expect(memoryUiRequestOptions(context)).toEqual({ location: { directory: "/tmp/memory-default" } })
})

test("registers the command and tools through the v2 public plugin transforms", async () => {
  const commands: string[] = []
  const tools: string[] = []
  const definitions: Tool.Info[] = []
  const rpcs: string[] = []
  const hooks: string[] = []
  const commandTransform: Context["command"]["transform"] = (callback) => {
    const editor: CommandEditor = { add: (definition) => commands.push(definition.name) }
    callback(editor)
    return Effect.succeed({ dispose: Effect.succeed(undefined) })
  }
  const toolTransform: Context["tool"]["transform"] = (callback) => {
    const editor: ToolEditor = {
      list: () => [],
      get: () => undefined,
      namespace: () => undefined,
      add: (definition) => {
        tools.push(definition.name)
        definitions.push(definition)
      },
      update: () => undefined,
      remove: () => undefined,
    }
    callback(editor)
    return Effect.succeed({ dispose: Effect.succeed(undefined) })
  }
  const context = {
    location: location(path.join(os.tmpdir(), "kilo2-memory-plugin-registration")),
    rpc: {
      register: (definition: typeof MemoryRpc.Definition) => {
        rpcs.push(definition.id)
        return Effect.succeed({
          dispose: Effect.succeed(undefined),
          events: { emit: () => Effect.succeed(undefined) },
        })
      },
    },
    command: { transform: commandTransform },
    event: { subscribe: () => Stream.empty },
    session: {
      hook: (name: string) => {
        hooks.push(name)
        return Effect.succeed({ dispose: Effect.succeed(undefined) })
      },
    },
    tool: { transform: toolTransform },
  } as unknown as Context

  await Effect.runPromise(
    Effect.scoped(createMemoryPlugin({ root: path.join(os.tmpdir(), "kilo2-memory-root") }).effect(context)),
  )
  expect(commands).toEqual(["memory"])
  expect(tools).toEqual(["kilo_memory_save", "kilo_memory_recall"])
  expect(rpcs).toEqual(["kilocode.memory"])
  expect(hooks).toEqual(["context"])
  const save = definitions.find((definition) => definition.name === "kilo_memory_save")
  expect(save).toBeDefined()
  await expect(
    Effect.runPromise(
      save!.execute({ action: "remember", text: "must not be written" }, {
        sessionID: "ses_memory_registration",
        agent: "build",
        messageID: "msg_memory_registration",
        id: "call_memory_registration",
      } as unknown as Tool.Context),
    ),
  ).rejects.toThrow("Tool authorization is unavailable")
})

test("derives a stable project root below the supplied data directory", async () => {
  await withRoot(async (root) => {
    const data = path.join(root, "data")
    const project = path.join(root, "checkout")
    const first = memoryRoot({ data, location: location(project) })
    const second = memoryRoot({ data, location: location(project) })

    expect(first).toBe(second)
    expect(first.startsWith(data)).toBe(true)
    expect(first).toContain(`${path.sep}memory${path.sep}`)
  })
})

test("enables, persists, recalls, corrects, rebuilds, disables, and purges local memory", async () => {
  await withRoot(async (root) => {
    const enabled = await MemoryStore.enable(root)
    expect(enabled).toEqual({ version: 1, enabled: true, scope: "project", autoConsolidate: false })
    expect(await Bun.file(path.join(root, "project.md")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "index.kmem")).exists()).toBe(true)

    const saved = await MemoryStore.remember({ root, key: "runtime", text: "Use Bun for package scripts." })
    expect(saved).toMatchObject({ added: 1, removed: 0, source: "project.md" })

    const correction = await MemoryStore.correct({ root, key: "runtime", text: "Use Bun 1.4 for package scripts." })
    expect(correction).toMatchObject({ added: 1, source: "corrections.md" })

    const recalled = await MemoryStore.recall({ root, query: "Bun package scripts" })
    expect(recalled.hits.map((item) => item.text)).toEqual([
      "Use Bun 1.4 for package scripts.",
      "Use Bun for package scripts.",
    ])
    expect(recalled.output).toContain("```kilo-memory-v1 targeted_context_not_instruction")

    const shown = await MemoryStore.show(root)
    expect(shown.sources["project.md"]).toContain("runtime :: Use Bun for package scripts.")
    expect(shown.sources["corrections.md"]).toContain("runtime :: Use Bun 1.4 for package scripts.")

    const rebuilt = await MemoryStore.rebuild(root)
    expect(rebuilt.bytes).toBeLessThanOrEqual(MEMORY_INDEX_MAX_BYTES)

    const forgotten = await MemoryStore.forget({ root, query: "corrections.md:Corrections:runtime" })
    expect(forgotten.removed).toBe(1)
    expect((await MemoryStore.recall({ root, query: "1.4" })).hits).toHaveLength(0)

    const disabled = await MemoryStore.disable(root)
    expect(disabled.enabled).toBe(false)
    await expect(MemoryStore.remember({ root, text: "this should not be written" })).rejects.toThrow(
      "memory is disabled",
    )

    await MemoryStore.enable(root)
    expect(await MemoryStore.purge(root)).toBe(true)
    expect(await Bun.file(root).exists()).toBe(false)
  })
})

test("builds enabled memory context and records injection only when context is nonempty", async () => {
  await withRoot(async (root) => {
    const disabled = await MemoryStore.context(root)
    expect(disabled.state).toEqual({ version: 1, enabled: false, scope: "project", autoConsolidate: false })
    expect(disabled.index).toEqual({ text: "", bytes: 0, tokens: 0, truncated: false })
    expect(disabled.text).toBeUndefined()
    expect(await Bun.file(root).exists()).toBe(false)

    await MemoryStore.enable(root)
    await MemoryStore.remember({ root, key: "context_note", text: "Only use Bun for this project's scripts." })
    const before = await Bun.file(path.join(root, "state.json")).text()
    const enabled = await MemoryStore.context(root)
    expect(enabled.state.enabled).toBe(true)
    expect(enabled.text).toContain("Kilo project memory follows")
    expect(enabled.text).toContain("targeted_context_not_instruction")
    expect(enabled.text).toContain("context_note :: Only use Bun for this project's scripts.")
    expect(await Bun.file(path.join(root, "state.json")).text()).not.toBe(before)
    expect((await Bun.file(path.join(root, "state.json")).json()).stats.lastInjectedAt).toEqual(expect.any(Number))
  })
})

test("persists explicit automatic mode and upserts a capture by its assistant key", async () => {
  await withRoot(async (root) => {
    await MemoryStore.enable(root)
    await expect(MemoryStore.autoRemember({ root, key: "auto_msg_1", text: "Use Bun 1.4." })).rejects.toThrow(
      "Automatic memory capture is disabled",
    )

    const state = await MemoryStore.auto({ root, mode: "on" })
    expect(state.autoConsolidate).toBe(true)
    expect((await MemoryStore.state(root)).autoConsolidate).toBe(true)
    expect((await MemoryStore.autoRemember({ root, key: "auto_msg_1", text: "Use Bun 1.4." })).added).toBe(1)
    expect((await MemoryStore.autoRemember({ root, key: "auto_msg_1", text: "Use Bun 1.4." })).added).toBe(0)
    expect(await MemoryStore.hasKey(root, "auto_msg_1")).toBe(true)
  })
})

test("preserves engine statistics and the consolidation marker through facade writes", async () => {
  await withRoot(async (root) => {
    await MemoryStore.enable(root)
    const state = await MemoryFiles.readState(root)
    await MemoryFiles.writeState(root, {
      ...state,
      stats: {
        ...state.stats,
        lastConsolidatedMessageID: "msg_memory_marker",
        lastInjectedAt: 123,
        lastConsolidationTokens: 7,
      },
    })

    await MemoryStore.remember({ root, key: "preserve_stats", text: "Keep engine state fields." })
    await MemoryStore.auto({ root, mode: "on" })

    expect(await MemoryFiles.readState(root)).toMatchObject({
      autoConsolidate: true,
      stats: {
        lastConsolidatedMessageID: "msg_memory_marker",
        lastInjectedAt: 123,
        lastConsolidationTokens: 7,
      },
    })
  })
})

test("does not repair malformed memory state while preparing request context", async () => {
  await withRoot(async (root) => {
    await MemoryStore.enable(root)
    await writeFile(path.join(root, "state.json"), "{\n", "utf8")

    await expect(MemoryStore.context(root)).rejects.toThrow()
    expect(await Bun.file(path.join(root, "state.json")).text()).toBe("{\n")
    expect((await readdir(root)).some((item) => item.startsWith("state.json.bad-"))).toBe(false)
  })
})

test("rejects secret-like explicit writes without changing the local memory", async () => {
  await withRoot(async (root) => {
    await MemoryStore.enable(root)
    await expect(MemoryStore.remember({ root, text: "api_key = do-not-store" })).rejects.toThrow("secret-like")
    expect((await MemoryStore.recall({ root, query: "do not store" })).hits).toHaveLength(0)
  })
})

test("keeps malformed state bytes unchanged on ordinary reads", async () => {
  await withRoot(async (root) => {
    await MemoryStore.enable(root)
    await writeFile(path.join(root, "state.json"), "{\n", "utf8")

    await expect(MemoryStore.state(root)).rejects.toThrow()
    expect(await Bun.file(path.join(root, "state.json")).text()).toBe("{\n")
    expect((await readdir(root)).some((item) => item.startsWith("state.json.bad-"))).toBe(false)
  })
})

test("refuses symlinked memory roots", async () => {
  await withRoot(async (root) => {
    const target = `${root}-target`
    await MemoryStore.enable(target)
    const link = `${root}-link`
    await symlink(target, link)
    try {
      await expect(MemoryStore.enable(link)).rejects.toThrow("memory path rejects symlink")
    } finally {
      await rm(target, { recursive: true, force: true })
      await rm(link, { recursive: true, force: true })
    }
  })
})

test("dispatches the memory command through an isolated host and reloads persisted memory", async () => {
  await using input = await fixture()
  const layout = makeInteractiveLayout(path.join(input.directory, "interactive"), input.home)
  const runHost = (sessionID?: string) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            plugins: [createMemoryPlugin({ data: layout.paths.data })],
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          yield* Effect.promise(() => client.plugin.awaitActivation({ location: { directory: input.cwd } }))

          const commands = (yield* Effect.promise(() => client.command.list({ location: { directory: input.cwd } })))
            .data
          expect(commands.map((command) => command.name)).toContain("memory")

          const current =
            sessionID ??
            (yield* Effect.promise(() =>
              client.session.create({ title: "Memory host fixture", location: { directory: input.cwd } }),
            )).id
          yield* Effect.promise(() =>
            client.session.command({
              sessionID: current,
              command: "memory",
              text: sessionID ? "status" : "on",
            }),
          )
          if (!sessionID) {
            yield* Effect.promise(() =>
              client.session.command({ sessionID: current, command: "memory", text: "remember persisted host note" }),
            )
          }
          const inbox = yield* Effect.promise(() => client.session.inbox.list({ sessionID: current }))
          expect(inbox.some((item) => item.type === "synthetic" && item.payload.text.includes("Memory"))).toBe(true)
          return current
        }),
      ),
    )

  const sessionID = await runHost()
  const memoryDirectory = path.join(layout.paths.data, "memory")
  const roots = await readdir(memoryDirectory)
  expect(roots).toHaveLength(1)
  expect(await Bun.file(path.join(memoryDirectory, roots[0]!, "project.md")).text()).toContain(
    "persisted_host_note :: persisted host note",
  )

  await runHost(sessionID)
  expect(await Bun.file(path.join(memoryDirectory, roots[0]!, "project.md")).text()).toContain(
    "persisted_host_note :: persisted host note",
  )
})

test("authorizes memory saves before mutation and fails closed without a host authorizer", async () => {
  await using input = await fixture()
  const model = memoryToolModel()
  const layout = makeInteractiveLayout(path.join(input.directory, "memory-permission-interactive"), input.home)
  try {
    const rejected = await runMemoryAuthorizationCase({
      layout,
      directory: input.cwd,
      content: memoryToolConfig(model.server.url.origin, "ask"),
      prompt: "reject memory save",
      enable: true,
      reply: "reject",
    })
    expect(rejected.asked).toMatchObject({
      action: "kilo_memory_save",
      resources: ["remember"],
      save: [],
      metadata: { action: "remember", key: "rejected" },
    })
    expect(rejected.shown.sources["project.md"]).not.toContain("rejected ::")

    const allowed = await runMemoryAuthorizationCase({
      layout,
      directory: input.cwd,
      content: memoryToolConfig(model.server.url.origin, "ask"),
      prompt: "allow memory save",
      reply: "once",
    })
    expect(allowed.asked).toMatchObject({ action: "kilo_memory_save", resources: ["remember"], save: [] })
    expect(allowed.shown.sources["project.md"]).toContain("allowed :: allowed memory proof")

    const denied = await runMemoryAuthorizationCase({
      layout,
      directory: input.cwd,
      content: memoryToolConfig(model.server.url.origin, "deny"),
      prompt: "deny memory save",
    })
    expect(denied.asked).toBeUndefined()
    expect(denied.shown.sources["project.md"]).not.toContain("denied ::")
  } finally {
    await model.server.stop(true)
  }
}, 60_000)

test("serves immediate memory status and persistence through typed RPC without session admission", async () => {
  await using input = await fixture()
  const layout = makeInteractiveLayout(path.join(input.directory, "rpc-interactive"), input.home)
  const modelRequests: string[] = []
  const runHost = (restart = false) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            plugins: [createMemoryPlugin({ data: layout.paths.data })],
          })
          const fetch = Object.assign(
            async (...args: Parameters<typeof globalThis.fetch>) => {
              const request = args[0]
              const url =
                request instanceof Request ? request.url : request instanceof URL ? request.href : String(request)
              if (url.includes("/api/generate")) modelRequests.push(url)
              return globalThis.fetch(...args)
            },
            { preconnect: globalThis.fetch.preconnect },
          )
          const client = createClient({
            baseUrl: server.url,
            fetch,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const session = yield* Effect.promise(() =>
            client.session.create({ title: "Memory RPC fixture", location: { directory: input.cwd } }),
          )
          const rpc = client.rpc(MemoryRpc.Definition)
          const before = {
            messages: yield* Effect.promise(() => client.message.list({ sessionID: session.id })),
            inbox: yield* Effect.promise(() => client.session.inbox.list({ sessionID: session.id })),
          }

          const initial = yield* Effect.promise(() => rpc.status({}, location))
          expect(initial.state.enabled).toBe(restart)
          expect(yield* Effect.promise(() => client.message.list({ sessionID: session.id }))).toEqual(before.messages)
          expect(yield* Effect.promise(() => client.session.inbox.list({ sessionID: session.id }))).toEqual(
            before.inbox,
          )
          expect(modelRequests).toEqual([])

          if (!restart) {
            const failure = yield* Effect.promise(() =>
              rpc.remember({ text: "must remain disabled" }, location).then(
                () => undefined,
                (error) => error,
              ),
            )
            expect(failure).toMatchObject({ type: "kilocode.memory" })
            const enabled = yield* Effect.promise(() => rpc.enable({}, location))
            expect(enabled.enabled).toBe(true)
            const saved = yield* Effect.promise(() =>
              rpc.remember({ key: "rpc_note", text: "Persist this RPC memory without a session prompt." }, location),
            )
            expect(saved.added).toBe(1)
          }
          const final = yield* Effect.promise(() => rpc.status({}, location))
          const shown = yield* Effect.promise(() => rpc.show({}, location))
          const recalled = yield* Effect.promise(() => rpc.recall({ query: "RPC memory session prompt" }, location))
          expect(final.state.enabled).toBe(true)
          expect(shown.sources["project.md"]).toContain("rpc_note :: Persist this RPC memory without a session prompt.")
          expect(recalled.hits.map((item) => item.key)).toContain("rpc_note")
          yield* Effect.promise(() => Memory.context({ root: final.root, sessionID: session.id }))
          const injected = yield* Effect.promise(() => rpc.status({}, location))
          expect(injected.activity).toMatchObject({
            lastInjectedAt: expect.any(Number),
            lastInjectedBytes: expect.any(Number),
            lastInjectedTokens: expect.any(Number),
          })
          yield* Effect.promise(() =>
            Memory.recordSession({
              root: final.root,
              sessionID: "ses_rpc_digest",
              topic: "RPC digest proof",
              summary: "The reusable engine stores this real session digest for RPC recall.",
              time: 1,
            }),
          )
          const digest = yield* Effect.promise(() => rpc.recall({ query: "reusable engine session digest" }, location))
          expect(digest.hits).toContainEqual(
            expect.objectContaining({
              source: expect.stringContaining("ses_rpc_digest"),
              text: expect.stringContaining("reusable engine"),
            }),
          )
          expect(yield* Effect.promise(() => client.message.list({ sessionID: session.id }))).toEqual(before.messages)
          expect(yield* Effect.promise(() => client.session.inbox.list({ sessionID: session.id }))).toEqual(
            before.inbox,
          )
          expect(modelRequests).toEqual([])
          return { status: final, show: shown }
        }),
      ),
    )

  const first = await runHost()
  expect(first.status.state.enabled).toBe(true)
  const second = await runHost(true)
  expect(second.status.state.enabled).toBe(true)
  expect(second.show.sources["project.md"]).toContain("rpc_note :: Persist this RPC memory without a session prompt.")
  expect(modelRequests).toEqual([])
})

test("routes memory RPC operations to the requested project", async () => {
  await using input = await fixture()
  const left = path.join(input.directory, "project-left")
  const right = path.join(input.directory, "project-right")
  await Promise.all([mkdir(left), mkdir(right)])
  const layout = makeInteractiveLayout(path.join(input.directory, "multi-location-interactive"), input.home)

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch(layout, {
          models: false,
          recover: false,
          plugins: [createMemoryPlugin({ data: layout.paths.data })],
        })
        const client = createClient({
          baseUrl: server.url,
          headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
        })
        const rpc = client.rpc(MemoryRpc.Definition)
        const leftLocation = { location: { directory: left } }
        const rightLocation = { location: { directory: right } }
        yield* Effect.promise(() => client.plugin.awaitActivation(leftLocation))

        const leftEnabled = yield* Effect.promise(() => rpc.enable({}, leftLocation))
        const leftInitial = yield* Effect.promise(() => rpc.status({}, leftLocation))
        const rightInitial = yield* Effect.promise(() => rpc.status({}, rightLocation))
        expect(leftEnabled.enabled).toBe(true)
        expect(rightInitial.state.enabled).toBe(false)
        expect(rightInitial.root).not.toBe(leftInitial.root)

        yield* Effect.promise(() =>
          rpc.remember({ key: "left_only", text: "This note belongs only to the left project." }, leftLocation),
        )
        const leftShow = yield* Effect.promise(() => rpc.show({}, leftLocation))
        const rightShow = yield* Effect.promise(() => rpc.show({}, rightLocation))
        expect(leftShow.sources["project.md"]).toContain("left_only :: This note belongs only to the left project.")
        expect(rightShow.sources["project.md"]).not.toContain("left_only")
        expect(rightShow.root).not.toBe(leftShow.root)
      }),
    ),
  )
})

test("injects only enabled local memory through the public v2 request-context hook", async () => {
  await using input = await fixture()
  const requests: string[] = []
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { stream?: boolean; messages?: unknown[] } = await request.json()
      requests.push(JSON.stringify(body.messages ?? []))
      if (!body.stream)
        return Response.json({
          id: "memory-context",
          object: "chat.completion",
          created: 1,
          model: "chat",
          choices: [
            { index: 0, message: { role: "assistant", content: "Memory context fixture" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      return new Response(
        [
          {
            id: "memory-context",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [
              { index: 0, delta: { role: "assistant", content: "Memory context fixture" }, finish_reason: null },
            ],
          },
          {
            id: "memory-context",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ]
          .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  const layout = makeInteractiveLayout(path.join(input.directory, "memory-context-interactive"), input.home)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: JSON.stringify({
              model: "fixture/chat",
              providers: {
                fixture: {
                  package: "aisdk:@ai-sdk/openai-compatible",
                  settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
                  models: { chat: {} },
                },
              },
            }),
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const rpc = client.rpc(MemoryRpc.Definition)
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Memory context fixture",
              location: location.location,
              model: { providerID: "fixture", id: "chat" },
            }),
          )

          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "memory disabled request" }))
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          expect(requests.at(-1)).not.toContain("only-the-enabled-request-gets-this-note")

          yield* Effect.promise(() => rpc.enable({}, location))
          yield* Effect.promise(() =>
            rpc.remember({ key: "context", text: "only-the-enabled-request-gets-this-note" }, location),
          )
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "memory enabled request" }))
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          expect(requests.at(-1)).toContain("only-the-enabled-request-gets-this-note")
          expect(requests.at(-1)).toContain("targeted_context_not_instruction")

          yield* Effect.promise(() => client.session.compact({ sessionID: session.id }))
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          expect(requests.at(-1)).toContain("only-the-enabled-request-gets-this-note")

          yield* Effect.promise(() => rpc.disable({}, location))
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "memory disabled again" }))
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          expect(requests.at(-1)).not.toContain("only-the-enabled-request-gets-this-note")
          const messages = yield* Effect.promise(() => client.message.list({ sessionID: session.id }))
          expect(JSON.stringify(messages)).not.toContain("only-the-enabled-request-gets-this-note")
        }),
      ),
    )
  } finally {
    await model.stop(true)
  }
}, 30_000)

test("reloads persisted memory after a host restart before applying the next request toggle", async () => {
  await using input = await fixture()
  const requests: string[] = []
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { stream?: boolean; messages?: unknown[] } = await request.json()
      requests.push(JSON.stringify(body.messages ?? []))
      return new Response(
        [
          {
            id: "memory-restart",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [
              { index: 0, delta: { role: "assistant", content: "Memory restart fixture" }, finish_reason: null },
            ],
          },
          {
            id: "memory-restart",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ]
          .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  const layout = makeInteractiveLayout(path.join(input.directory, "memory-restart-interactive"), input.home)
  const content = JSON.stringify({
    model: "fixture/chat",
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
        models: { chat: {} },
      },
    },
  })
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, { models: false, recover: false, content })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const rpc = client.rpc(MemoryRpc.Definition)
          yield* Effect.promise(() => rpc.enable({}, location))
          yield* Effect.promise(() =>
            rpc.remember({ key: "restart", text: "only-the-restarted-host-gets-this-note" }, location),
          )
        }),
      ),
    )

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, { models: false, recover: false, content })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const rpc = client.rpc(MemoryRpc.Definition)
          expect((yield* Effect.promise(() => rpc.status({}, location))).state.enabled).toBe(true)
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Memory restart fixture",
              location: location.location,
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* Effect.promise(() =>
            client.session.prompt({ sessionID: session.id, text: "restarted enabled request" }),
          )
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          expect(requests.at(-1)).toContain("only-the-restarted-host-gets-this-note")

          yield* Effect.promise(() => rpc.disable({}, location))
          yield* Effect.promise(() =>
            client.session.prompt({ sessionID: session.id, text: "restarted disabled request" }),
          )
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          expect(requests.at(-1)).not.toContain("only-the-restarted-host-gets-this-note")
        }),
      ),
    )
  } finally {
    await model.stop(true)
  }
}, 30_000)

test("runs one auxiliary consolidation only after memory and auto mode are explicitly enabled", async () => {
  await using input = await fixture()
  const requests = { primary: 0, auxiliary: 0 }
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { messages?: Array<{ content?: string }> } = await request.json()
      const automatic =
        JSON.stringify(body.messages).includes("session digest updater") ||
        JSON.stringify(body.messages).includes("typed memory consolidation step")
      requests[automatic ? "auxiliary" : "primary"]++
      const content = JSON.stringify(body.messages).includes("typed memory consolidation step")
        ? `{"operations":[{"op":"upsert_project_fact","key":"package_runtime","value":"Use Bun 1.4 for this project's package scripts."}],"skipped":[]}`
        : automatic
          ? '{"topic":"memory fixture","summary":"Memory consolidation fixture completed."}'
          : "Primary fixture response"
      return new Response(
        [
          {
            id: "memory-auto",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
          },
          {
            id: "memory-auto",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ]
          .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  const layout = makeInteractiveLayout(path.join(input.directory, "memory-auto-interactive"), input.home)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: JSON.stringify({
              model: "fixture/chat",
              providers: {
                fixture: {
                  package: "aisdk:@ai-sdk/openai-compatible",
                  settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
                  models: { chat: {} },
                },
              },
            }),
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const rpc = client.rpc(MemoryRpc.Definition)
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Memory auto fixture",
              location: location.location,
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          const prompt = (text: string) =>
            Effect.promise(async () => {
              await client.session.prompt({ sessionID: session.id, text })
              await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
            })

          yield* prompt("disabled memory request")
          expect(requests).toEqual({ primary: 1, auxiliary: 0 })

          yield* Effect.promise(() => rpc.enable({}, location))
          yield* prompt("enabled but automatic consolidation is off")
          expect(requests).toEqual({ primary: 2, auxiliary: 0 })

          const automatic = yield* Effect.promise(() => rpc.auto({ mode: "on" }, location))
          expect(automatic).toMatchObject({ enabled: true, autoConsolidate: true })
          yield* prompt("enabled automatic consolidation request")
          yield* Effect.tryPromise({
            try: async () => {
              for (let attempt = 0; attempt < 100; attempt++) {
                const shown = await rpc.show({}, location)
                if (shown.sources["project.md"].includes("Use Bun 1.4 for this project's package scripts.")) return
                await Bun.sleep(25)
              }
              throw new Error("Timed out waiting for automatic memory consolidation")
            },
            catch: (error) => error,
          })
          expect(requests).toEqual({ primary: 3, auxiliary: 1 })

          const disabled = yield* Effect.promise(() => rpc.auto({ mode: "off" }, location))
          expect(disabled.autoConsolidate).toBe(false)
          yield* prompt("automatic consolidation disabled again")
          expect(requests).toEqual({ primary: 4, auxiliary: 1 })
        }),
      ),
    )
  } finally {
    await model.stop(true)
  }
}, 30_000)

test("coalesces queued opted-in steers without sending pre-opt-in history to auxiliary capture", async () => {
  await using input = await fixture()
  const directory = await realpath(input.cwd)
  await writeFile(path.join(directory, "tracked-before-memory-capture.txt"), "before\n")
  await Bun.spawn(["git", "init"], { cwd: directory, stdout: "ignore", stderr: "ignore" }).exited
  await Bun.spawn(["git", "add", "tracked-before-memory-capture.txt"], {
    cwd: directory,
    stdout: "ignore",
    stderr: "ignore",
  }).exited
  await Bun.spawn(
    [
      "git",
      "-c",
      "user.name=Memory Fixture",
      "-c",
      "user.email=memory-fixture@example.test",
      "commit",
      "-m",
      "baseline",
    ],
    { cwd: directory, stdout: "ignore", stderr: "ignore" },
  ).exited
  const auxiliary: string[] = []
  let holdPrimary = false
  let releasePrimary: (() => void) | undefined
  let primaryStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    primaryStarted = resolve
  })
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { messages?: Array<{ content?: string }> } = await request.json()
      const contents = JSON.stringify(body.messages)
      const automatic =
        contents.includes("session digest updater") || contents.includes("typed memory consolidation step")
      if (automatic) auxiliary.push(contents)
      if (holdPrimary && !automatic) {
        holdPrimary = false
        primaryStarted?.()
        await new Promise<void>((resolve) => {
          releasePrimary = resolve
        })
      }
      const content = contents.includes("typed memory consolidation step")
        ? '{"operations":[],"skipped":["fixture"]}'
        : automatic
          ? '{"topic":"memory fixture","summary":"Memory consolidation fixture completed."}'
          : "Primary fixture response"
      return new Response(
        [
          {
            id: "memory-steer-batch",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
          },
          {
            id: "memory-steer-batch",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ]
          .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  const layout = makeInteractiveLayout(path.join(input.directory, "memory-steer-batch-interactive"), input.home)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: JSON.stringify({
              snapshots: true,
              model: "fixture/chat",
              providers: {
                fixture: {
                  package: "aisdk:@ai-sdk/openai-compatible",
                  settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
                  models: { chat: {} },
                },
              },
            }),
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { location: { directory } }
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const rpc = client.rpc(MemoryRpc.Definition)
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Memory steer batch fixture",
              location: location.location,
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* Effect.promise(() =>
            client.session.prompt({ sessionID: session.id, text: "pre-opt-in history must not replay" }),
          )
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          expect(auxiliary).toEqual([])

          yield* Effect.promise(() => rpc.enable({}, location))
          yield* Effect.promise(() => rpc.auto({ mode: "on" }, location))
          holdPrimary = true
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "eligible steer first" }))
          yield* Effect.promise(() => started)
          yield* Effect.promise(() => writeFile(path.join(directory, "memory-diff-proof.txt"), "captured\n"))
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "eligible steer second" }))
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "eligible steer third" }))
          releasePrimary?.()
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )

          yield* Effect.tryPromise({
            try: async () => {
              for (let attempt = 0; attempt < 800; attempt++) {
                if (
                  auxiliary.some(
                    (body) => body.includes("eligible steer second") && body.includes("eligible steer third"),
                  )
                )
                  return
                await Bun.sleep(50)
              }
              throw new Error("Timed out waiting for the source engine's idle coalesced capture")
            },
            catch: (error) => error,
          })
          const captured = auxiliary.join("\n")
          expect(captured).toContain("eligible steer first")
          expect(captured).toContain("eligible steer second")
          expect(captured).toContain("eligible steer third")
          expect(captured).not.toContain("pre-opt-in history must not replay")
          expect(captured).toContain("added memory-diff-proof.txt +1 -0")
        }),
      ),
    )
  } finally {
    await model.stop(true)
  }
}, 50_000)

test("records a bounded fallback digest after an execution failure without an auxiliary model call", async () => {
  await using input = await fixture()
  const requests = { primary: 0, auxiliary: 0 }
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body = await request.text()
      if (body.includes("session digest updater") || body.includes("typed memory consolidation step")) {
        requests.auxiliary++
      } else {
        requests.primary++
      }
      return Response.json({ error: { message: "fixture invalid request" } }, { status: 400 })
    },
  })
  const layout = makeInteractiveLayout(path.join(input.directory, "memory-failure-interactive"), input.home)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: JSON.stringify({
              model: "fixture/chat",
              providers: {
                fixture: {
                  package: "aisdk:@ai-sdk/openai-compatible",
                  settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
                  models: { chat: {} },
                },
              },
            }),
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const rpc = client.rpc(MemoryRpc.Definition)
          yield* Effect.promise(() => rpc.enable({}, location))
          yield* Effect.promise(() => rpc.auto({ mode: "on" }, location))
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Memory execution failure fixture",
              location: location.location,
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* Effect.promise(() =>
            client.session.prompt({
              sessionID: session.id,
              text: "failure-lifecycle-proof preserve this detailed project request when the configured provider fails before replying",
            }),
          )
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          yield* Effect.tryPromise({
            try: async () => {
              for (let attempt = 0; attempt < 100; attempt++) {
                const status = await rpc.status({}, location)
                const digests = await MemoryFiles.recentSessions(status.root, 20, 480)
                if (
                  digests.some(
                    (digest) =>
                      digest.id === session.id && digest.fallback && digest.summary.includes("failure-lifecycle-proof"),
                  )
                )
                  return
                await Bun.sleep(25)
              }
              throw new Error("Timed out waiting for an execution-error fallback digest")
            },
            catch: (error) => error,
          })
          expect(requests.primary).toBeGreaterThan(0)
          expect(requests.auxiliary).toBe(0)
        }),
      ),
    )
  } finally {
    await model.stop(true)
  }
}, 30_000)

test("records a bounded fallback digest when a held local model execution is interrupted", async () => {
  await using input = await fixture()
  const started = Promise.withResolvers<void>()
  const aborted = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body = await request.text()
      if (body.includes("session digest updater") || body.includes("typed memory consolidation step")) {
        return new Response("unexpected auxiliary capture", { status: 500 })
      }
      started.resolve()
      request.signal.addEventListener("abort", () => aborted.resolve(), { once: true })
      await release.promise
      return new Response(null, { status: 499 })
    },
  })
  const layout = makeInteractiveLayout(path.join(input.directory, "memory-interrupted-interactive"), input.home)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: JSON.stringify({
              model: "fixture/chat",
              providers: {
                fixture: {
                  package: "aisdk:@ai-sdk/openai-compatible",
                  settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
                  models: { chat: {} },
                },
              },
            }),
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const rpc = client.rpc(MemoryRpc.Definition)
          yield* Effect.promise(() => rpc.enable({}, location))
          yield* Effect.promise(() => rpc.auto({ mode: "on" }, location))
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Memory interrupted execution fixture",
              location: location.location,
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* Effect.promise(async () => {
            await client.session.prompt({
              sessionID: session.id,
              text: "interrupted-lifecycle-proof preserve this detailed project request when the local model is cancelled",
            })
            await started.promise
            await client.session.interrupt({ sessionID: session.id })
            await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
          })
          yield* Effect.tryPromise({
            try: async () => {
              for (let attempt = 0; attempt < 100; attempt++) {
                const status = await rpc.status({}, location)
                const digests = await MemoryFiles.recentSessions(status.root, 20, 480)
                if (
                  digests.some(
                    (digest) =>
                      digest.id === session.id &&
                      digest.fallback &&
                      digest.summary.includes("interrupted-lifecycle-proof"),
                  )
                )
                  return
                await Bun.sleep(25)
              }
              throw new Error("Timed out waiting for an execution-interrupted fallback digest")
            },
            catch: (error) => error,
          })
        }),
      ),
    )
    await Promise.race([
      aborted.promise,
      Bun.sleep(1_000).then(() => Promise.reject(new Error("Timed out waiting for primary HTTP cancellation"))),
    ])
  } finally {
    release.resolve()
    await model.stop(true)
  }
}, 30_000)

test("cancels an in-flight auxiliary capture before an isolated host restart", async () => {
  await using input = await fixture()
  const started = Promise.withResolvers<void>()
  const aborted = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { messages?: Array<{ content?: string }> } = await request.json()
      const automatic =
        JSON.stringify(body.messages).includes("session digest updater") ||
        JSON.stringify(body.messages).includes("typed memory consolidation step")
      if (automatic) {
        started.resolve()
        request.signal.addEventListener("abort", () => aborted.resolve(), { once: true })
        await release.promise
      }
      const content = automatic ? "This must not survive the stopped host." : "Primary fixture response"
      return new Response(
        [
          {
            id: "memory-cancel",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
          },
          {
            id: "memory-cancel",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ]
          .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  const layout = makeInteractiveLayout(path.join(input.directory, "memory-cancel-interactive"), input.home)
  const content = JSON.stringify({
    model: "fixture/chat",
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
        models: { chat: {} },
      },
    },
  })
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, { models: false, recover: false, content })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const rpc = client.rpc(MemoryRpc.Definition)
          yield* Effect.promise(() => rpc.enable({}, location))
          yield* Effect.promise(() => rpc.auto({ mode: "on" }, location))
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Memory cancellation fixture",
              location: location.location,
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* Effect.promise(async () => {
            await client.session.prompt({ sessionID: session.id, text: "cancel the automatic memory save" })
            await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
            await started.promise
          })
          yield* Effect.promise(() => rpc.disable({}, location))
        }),
      ),
    )
    await Promise.race([
      aborted.promise,
      Bun.sleep(1_000).then(() => Promise.reject(new Error("Timed out waiting for auxiliary HTTP cancellation"))),
    ])
    release.resolve()
    await Bun.sleep(50)
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, { models: false, recover: false, content })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const rpc = client.rpc(MemoryRpc.Definition)
          const shown = yield* Effect.promise(() => rpc.show({}, location))
          expect(shown.sources["project.md"]).not.toContain("This must not survive the stopped host.")
        }),
      ),
    )
  } finally {
    release.resolve()
    await model.stop(true)
  }
}, 30_000)

test("publishes the saved RPC event only for real per-session saves owned by the host location", async () => {
  await using input = await fixture()
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { messages?: Array<{ content?: string }> } = await request.json()
      const contents = JSON.stringify(body.messages)
      const content = contents.includes("typed memory consolidation step")
        ? JSON.stringify({
            operations: [{ op: "upsert_project_fact", key: "event_note", value: "saved event fixture" }],
            skipped: [],
          })
        : "Primary fixture response"
      return new Response(
        [
          {
            id: "memory-saved-event",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
          },
          {
            id: "memory-saved-event",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ]
          .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  const layout = makeInteractiveLayout(path.join(input.directory, "memory-saved-event-interactive"), input.home)
  const content = JSON.stringify({
    snapshots: true,
    model: "fixture/chat",
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
        models: { chat: {} },
      },
    },
  })
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, { models: false, recover: false, content })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const rpc = client.rpc(MemoryRpc.Definition)
          const events: string[] = []
          const stop = rpc.events.on("saved", (event) => {
            events.push(event.data.sessionID)
          })
          const enabled = yield* Effect.promise(() => rpc.enable({}, location))
          expect(enabled.enabled).toBe(true)
          yield* Effect.promise(() => rpc.auto({ mode: "on" }, location))
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Memory saved event fixture",
              location: location.location,
              model: { providerID: "fixture", id: "chat" },
            }),
          )

          // Explicit RPC saves are unscoped: they persist but attribute no session.
          yield* Effect.promise(() => rpc.remember({ text: "unscoped explicit save" }, location))
          yield* Effect.promise(() => Bun.sleep(200))
          expect(events).toEqual([])

          // Producer events without a session or for a foreign root forward nothing.
          const status = yield* Effect.promise(() => rpc.status({}, location))
          yield* Effect.promise(() =>
            KiloMemory.apply({ root: status.root, ops: [{ action: "add", key: "no_session", text: "no session" }] }),
          )
          const foreign = path.join(input.directory, "foreign-memory-root")
          yield* Effect.promise(() => Memory.enable({ root: foreign }))
          yield* Effect.promise(() =>
            KiloMemory.apply({
              root: foreign,
              ops: [{ action: "add", key: "foreign", text: "foreign root" }],
              sessionID: session.id,
            }),
          )
          yield* Effect.promise(() => Bun.sleep(200))
          expect(events).toEqual([])

          // The real capture path publishes saved activity for its own session.
          yield* Effect.promise(() =>
            client.session.prompt({ sessionID: session.id, text: "trigger the saved event turn" }),
          )
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(15_000) }),
          )
          yield* Effect.tryPromise({
            try: async () => {
              for (let attempt = 0; attempt < 200; attempt++) {
                if (events.length > 0) return
                await Bun.sleep(50)
              }
              throw new Error("Timed out waiting for the real capture saved event")
            },
            catch: (error) => error,
          })
          expect(events).toEqual([session.id])

          // A second session's own save forwards with its own session ID, never
          // the first session's. The engine's typed-consolidation interval
          // (300s per root) suppresses a second model consolidation, so drive
          // the other session through the same real producer the capture path
          // uses.
          const other = yield* Effect.promise(() =>
            client.session.create({
              title: "Memory saved event other session",
              location: location.location,
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* Effect.promise(() =>
            KiloMemory.apply({
              root: status.root,
              ops: [{ action: "add", key: "other_note", text: "other session save" }],
              sessionID: other.id,
            }),
          )
          yield* Effect.tryPromise({
            try: async () => {
              for (let attempt = 0; attempt < 200; attempt++) {
                if (events.length > 1) return
                await Bun.sleep(50)
              }
              throw new Error("Timed out waiting for the other session saved event")
            },
            catch: (error) => error,
          })
          expect(events).toEqual([session.id, other.id])

          // The first session's digest-phase publish carries no saved detail,
          // so a turn inside the consolidation interval adds nothing.
          yield* Effect.promise(() =>
            client.session.prompt({ sessionID: session.id, text: "trigger the interval-throttled turn" }),
          )
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(15_000) }),
          )
          yield* Effect.promise(() => Bun.sleep(500))
          expect(events).toEqual([session.id, other.id])

          // Listener disposal stops delivery without breaking the host.
          stop()
          yield* Effect.promise(() =>
            KiloMemory.apply({
              root: status.root,
              ops: [{ action: "add", key: "post_disposal", text: "post disposal save" }],
              sessionID: session.id,
            }),
          )
          yield* Effect.promise(() => Bun.sleep(300))
          expect(events).toEqual([session.id, other.id])
        }),
      ),
    )
  } finally {
    await model.stop(true)
  }
}, 60_000)

function makeInteractiveLayout(root: string, home: string): Layout {
  const paths = {
    home,
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}

type MemoryPermissionEffect = "ask" | "allow" | "deny"
type PermissionAskedEvent = Extract<OpenCodeEvent, { type: "permission.asked" }>

function memoryToolConfig(origin: string, effect: MemoryPermissionEffect) {
  return JSON.stringify({
    model: "fixture/chat",
    permissions: [{ action: "kilo_memory_save", resource: "remember", effect }],
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `${origin}/v1`, apiKey: "fixture" },
        models: { chat: {} },
      },
    },
  })
}

function memoryToolModel() {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { stream?: boolean; messages?: Array<{ role: string; content?: unknown }> } = await request.json()
      if (!body.stream) return Response.json({ choices: [{ message: { role: "assistant", content: "fixture" } }] })
      if (body.messages?.at(-1)?.role === "tool") {
        return memoryStream({ role: "assistant", content: "Memory tool completed." }, "stop")
      }
      const prompt = String(
        [...(body.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "",
      )
      const key = prompt.includes("allow") ? "allowed" : prompt.includes("deny") ? "denied" : "rejected"
      return memoryStream(
        {
          tool_calls: [
            {
              index: 0,
              id: `call_memory_${key}`,
              type: "function",
              function: {
                name: "kilo_memory_save",
                arguments: JSON.stringify({ action: "remember", key, text: `${key} memory proof` }),
              },
            },
          ],
        },
        "tool_calls",
      )
    },
  })
  return { server }
}

function memoryStream(delta: Record<string, unknown>, finishReason: string) {
  return new Response(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
    ]
      .map(
        (frame) =>
          `data: ${JSON.stringify({ id: "memory-permission", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}

async function runMemoryAuthorizationCase(input: {
  readonly layout: Layout
  readonly directory: string
  readonly content: string
  readonly prompt: string
  readonly enable?: boolean
  readonly reply?: "reject" | "once"
}) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch(input.layout, { models: false, recover: false, content: input.content })
        const client = createClient({
          baseUrl: server.url,
          headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
        })
        const location = { location: { directory: input.directory } }
        yield* Effect.promise(() => client.plugin.awaitActivation(location))
        const rpc = client.rpc(MemoryRpc.Definition)
        if (input.enable) yield* Effect.promise(() => rpc.enable({}, location))
        const session = yield* Effect.promise(() =>
          client.session.create({
            title: "Memory permission fixture",
            location: location.location,
            model: { providerID: "fixture", id: "chat" },
          }),
        )
        const events: OpenCodeEvent[] = []
        const controller = new AbortController()
        const pump = (async () => {
          try {
            for await (const event of client.event.subscribe({ signal: controller.signal })) events.push(event)
          } catch {}
        })()
        try {
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: input.prompt }))
          const asked = yield* Effect.promise(() =>
            input.reply ? waitForMemoryPermission(events, session.id) : Promise.resolve(undefined),
          )
          if (asked && input.reply) {
            yield* Effect.promise(() =>
              client.permission.reply({ sessionID: session.id, requestID: asked.id, reply: input.reply! }),
            )
          }
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          const shown = yield* Effect.promise(() => rpc.show({}, location))
          return { asked, shown }
        } finally {
          controller.abort()
          yield* Effect.promise(() => pump.catch(() => undefined))
        }
      }),
    ),
  )
}

function isMemoryPermissionAsked(event: OpenCodeEvent, sessionID: string): event is PermissionAskedEvent {
  return event.type === "permission.asked" && event.data.sessionID === sessionID
}

async function waitForMemoryPermission(events: readonly OpenCodeEvent[], sessionID: string) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const event = events.find((item): item is PermissionAskedEvent => isMemoryPermissionAsked(item, sessionID))
    if (event) return event.data
    await Bun.sleep(20)
  }
  throw new Error("memory tool permission request did not arrive")
}
