import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createClient } from "@kilocode/client"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { ProjectID } from "@opencode-ai/schema/project-id"
import type { CommandEditor } from "@opencode-ai/plugin/effect/command"
import type { Context } from "@opencode-ai/plugin/effect/plugin"
import type { ToolEditor } from "@opencode-ai/plugin/effect/tool"
import type { Tool } from "@opencode-ai/schema/tool"
import { Effect, Stream } from "effect"
import { launch } from "../src/interactive-server"
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
      "Memory is disabled",
    )

    await MemoryStore.enable(root)
    expect(await MemoryStore.purge(root)).toBe(true)
    expect(await Bun.file(root).exists()).toBe(false)
  })
})

test("builds enabled memory context read-only and marks its index as reference data", async () => {
  await withRoot(async (root) => {
    const disabled = await MemoryStore.context(root)
    expect(disabled.state).toEqual({ version: 1, enabled: false, scope: "project", autoConsolidate: false })
    expect(disabled.index).toEqual({ text: "", bytes: 0, tokens: 0, truncated: false })
    expect(disabled.text).toBeUndefined()
    expect(await Bun.file(root).exists()).toBe(false)

    await MemoryStore.enable(root)
    await MemoryStore.remember({ root, key: "context_note", text: "Only use Bun for this project's scripts." })
    const before = {
      state: await Bun.file(path.join(root, "state.json")).text(),
      index: await Bun.file(path.join(root, "index.kmem")).text(),
    }
    const enabled = await MemoryStore.context(root)
    expect(enabled.state.enabled).toBe(true)
    expect(enabled.text).toContain("Kilo project memory follows")
    expect(enabled.text).toContain("targeted_context_not_instruction")
    expect(enabled.text).toContain("context_note :: Only use Bun for this project's scripts.")
    expect(await Bun.file(path.join(root, "state.json")).text()).toBe(before.state)
    expect(await Bun.file(path.join(root, "index.kmem")).text()).toBe(before.index)
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

test("does not repair malformed memory state while preparing request context", async () => {
  await withRoot(async (root) => {
    await MemoryStore.enable(root)
    await writeFile(path.join(root, "state.json"), "{\n", "utf8")

    const context = await MemoryStore.context(root)
    expect(context.state.enabled).toBe(false)
    expect(context.text).toBeUndefined()
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

test("recovers a malformed state as disabled and preserves a diagnostic copy", async () => {
  await withRoot(async (root) => {
    await MemoryStore.enable(root)
    await writeFile(path.join(root, "state.json"), "{\n", "utf8")

    const state = await MemoryStore.state(root)
    expect(state.enabled).toBe(false)
    expect((await readdir(root)).some((item) => item.startsWith("state.json.bad-"))).toBe(true)
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
      const automatic = JSON.stringify(body.messages).includes("Write one concise, durable project-memory fact")
      requests[automatic ? "auxiliary" : "primary"]++
      const content = automatic ? "Use Bun 1.4 for this project's package scripts." : "Primary fixture response"
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

test("cancels an in-flight auxiliary capture before an isolated host restart", async () => {
  await using input = await fixture()
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { messages?: Array<{ content?: string }> } = await request.json()
      const automatic = JSON.stringify(body.messages).includes("Write one concise, durable project-memory fact")
      if (automatic) {
        started.resolve()
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
        }),
      ),
    )
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
