import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { expect } from "bun:test"
import { Effect, Fiber, Layer, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { BackgroundJob } from "../../src/background/job"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Plugin } from "../../src/plugin"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionSummary } from "../../src/session/summary"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { BoardStore } from "../../src/kilocode/board/store"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const plugin = Layer.mock(Plugin.Service)({
  trigger: <Output>(_name: string, _input: unknown, output: Output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
})

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    resourceTemplates: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in board live test"),
    authenticate: () => Effect.die("unexpected MCP auth in board live test"),
    finishAuth: () => Effect.die("unexpected MCP auth in board live test"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const memory = LayerNode.make({ service: MemoryService.Service, layer: MemoryService.layer, deps: [] })
const server = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })
const root = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  BackgroundJob.node,
  Database.node,
  CrossSpawnSpawner.node,
  memory,
  server,
])

const it = testEffect(
  LayerNode.compile(root, [
    [SessionSummary.node, summary],
    [Plugin.node, plugin],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [KiloSessions.node, KiloSessions.testLayer],
  ]),
)

const cfg = {
  model: "test/test-model",
  enabled_providers: ["test"],
  snapshot: false,
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
  experimental: { shared_agent_board: true },
}

type Probe = { body: Record<string, unknown> }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function messages(input: Probe) {
  return Array.isArray(input.body.messages) ? input.body.messages.filter(record) : []
}

function text(input: Probe) {
  return JSON.stringify(input.body)
}

function userHas(input: Probe, value: string) {
  return messages(input).some((message) => message.role === "user" && JSON.stringify(message.content).includes(value))
}

function calls(input: Probe, name: string) {
  return messages(input).reduce((count, message) => {
    if (!Array.isArray(message.tool_calls)) return count
    return (
      count +
      message.tool_calls.filter((call) => record(call) && record(call.function) && call.function.name === name).length
    )
  }, 0)
}

function main(input: Probe) {
  return !worker(input) && !sibling(input) && calls(input, "task") > 0
}

function worker(input: Probe) {
  return userHas(input, "worker A assignment: inspect the parser edge")
}

function sibling(input: Probe) {
  return userHas(input, "worker B assignment: inspect the serializer edge")
}

function config(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: { ...cfg.provider.test.options, baseURL: url },
      },
    },
  }
}

function waitFor(llm: TestLLMServer["Service"], match: (input: Probe) => boolean, label: string) {
  const wait = Effect.gen(function* () {
    while (true) {
      const inputs = yield* llm.inputs
      const found = inputs.findLast((body) => match({ body }))
      if (found) return found
      yield* llm.wait(inputs.length + 1)
    }
  })
  return awaitWithTimeout(wait, label, "15 seconds")
}

it.live(
  "delivers important board posts live without changing task or completion delivery",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const jobs = yield* BackgroundJob.Service
        const gate = Promise.withResolvers<void>()
        const ready = Promise.withResolvers<void>()
        const finish = Promise.withResolvers<void>()
        const done = Promise.withResolvers<void>()
        const release = () => {
          gate.resolve()
          ready.resolve()
          finish.resolve()
          done.resolve()
        }
        yield* Effect.addFinalizer(() => Effect.sync(release))

        const chat = yield* sessions.create({
          title: "Shared-board live main",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.push(
          reply().tool("task", {
            description: "launch worker A",
            prompt: "worker A assignment: inspect the parser edge",
            subagent_type: "general",
            background: true,
          }),
        )
        yield* llm.pushMatch(
          main,
          reply().tool("task", {
            description: "launch worker B",
            prompt: "worker B assignment: inspect the serializer edge",
            subagent_type: "general",
            background: true,
          }),
        )
        yield* llm.pushMatch(main, reply().wait(gate.promise).tool("bash", { command: "printf main-boundary" }))
        yield* llm.pushMatch(main, reply().tool("bash", { command: "printf main-important" }))
        yield* llm.pushMatch(main, reply().text("main retained the important notes").stop())
        yield* llm.pushMatch(
          sibling,
          reply()
            .wait(gate.promise)
            .tool("board_post", { to: "ALL", type: "INFO", body: "B boundary marker", reply_to: "" }),
        )
        yield* llm.pushMatch(sibling, reply().wait(done.promise).text("B final result").stop())

        yield* llm.pushMatch(
          worker,
          reply().wait(ready.promise).tool("board_post", {
            to: "main",
            type: "INFO",
            body: "A direct discovery for main",
            reply_to: null,
          }),
        )
        yield* llm.pushMatch(
          worker,
          reply().tool("board_post", {
            to: "ALL",
            type: "VETO",
            body: "A broadcast warning for every worker",
          }),
        )
        yield* llm.pushMatch(
          worker,
          reply().tool("board_post", {
            to: "ALL",
            type: "INFO",
            body: "A routine broadcast body stays hidden",
          }),
        )
        yield* llm.pushMatch(worker, reply().wait(finish.promise).text("A final result").stop())

        const run = yield* prompt
          .prompt({
            sessionID: chat.id,
            agent: "code",
            parts: [{ type: "text", text: "main objective: coordinate the shared live delivery test" }],
          })
          .pipe(Effect.forkChild)

        const boundary = yield* waitFor(
          llm,
          (input) => main(input) && calls(input, "task") >= 2 && calls(input, "bash") === 0,
          "main boundary request",
        )
        yield* waitFor(llm, (input) => sibling(input) && calls(input, "board_post") === 0, "sibling boundary request")
        ready.resolve()
        yield* waitFor(llm, (input) => worker(input) && calls(input, "board_post") >= 3, "worker A posts")

        const board = yield* BoardStore.read({ sessionID: chat.id })
        expect(board.messages.map((message) => ({ type: message.type, to: message.to, body: message.body }))).toEqual([
          { type: "INFO", to: "main", body: "A direct discovery for main" },
          { type: "VETO", to: "ALL", body: "A broadcast warning for every worker" },
          { type: "INFO", to: "ALL", body: "A routine broadcast body stays hidden" },
        ])

        const children = yield* sessions.children(chat.id)
        expect(children).toHaveLength(2)
        const direct = board.messages.find((message) => message.body === "A direct discovery for main")
        if (!direct) throw new Error("direct board post was not persisted")
        const child = children.find((item) => item.id === direct.from)
        if (!child) throw new Error("background task child was not persisted")
        const peer = children.find((item) => item.id !== child.id)
        if (!peer) throw new Error("background task sibling was not persisted")

        for (const id of [chat.id, child.id, peer.id]) {
          const users = (yield* sessions.messages({ sessionID: id })).filter((message) => message.info.role === "user")
          expect(users).toHaveLength(1)
        }

        gate.resolve()

        const received = yield* waitFor(
          llm,
          (input) => main(input) && calls(input, "task") >= 1 && calls(input, "bash") >= 1,
          "main request with live board context",
        )
        const prefix = messages({ body: boundary }).slice(0, -1)
        const outgoing = messages({ body: received })
        expect(outgoing.slice(0, prefix.length)).toEqual(prefix)
        expect(outgoing.at(-1)?.role).toBe("user")
        expect(JSON.stringify(outgoing.at(-1)?.content)).toContain("<shared-agent-board>")
        expect(JSON.stringify(outgoing.slice(0, -1))).not.toContain("<shared-agent-board>")
        const body = text({ body: received })
        expect(body).toContain("A direct discovery for main")
        expect(body).toContain("A broadcast warning for every worker")
        expect(body).toContain("New general broadcasts are available")
        expect(body).not.toContain("A routine broadcast body stays hidden")

        const update = yield* waitFor(
          llm,
          (input) => sibling(input) && calls(input, "board_post") >= 1,
          "sibling request with live board context",
        )
        const notice = text({ body: update })
        expect(notice).toContain("A broadcast warning for every worker")
        expect(notice).toContain("New general broadcasts are available")
        expect(notice).not.toContain("A direct discovery for main")
        expect(notice).not.toContain("A routine broadcast body stays hidden")

        const retained = yield* waitFor(
          llm,
          (input) => main(input) && calls(input, "task") >= 1 && calls(input, "bash") >= 2,
          "main retained board context request",
        )
        const content = text({ body: retained })
        expect(content).toContain("A direct discovery for main")
        expect(content).toContain("A broadcast warning for every worker")
        yield* Fiber.join(run)

        expect((yield* jobs.get(child.id))?.status).toBe("running")
        expect((yield* jobs.get(peer.id))?.status).toBe("running")
        expect((yield* jobs.list()).every((job) => Schema.is(Schema.Json)(job.metadata))).toBe(true)

        for (const item of [
          { id: child.id, name: "A", finish },
          { id: peer.id, name: "B", finish: done },
        ]) {
          yield* llm.pushMatch(
            (hit) => main(hit) && text(hit).includes(`${item.name} final result`),
            reply().text(`parent received ${item.name} result`).stop(),
          )
          item.finish.resolve()
          yield* jobs.wait({ id: item.id, timeout: 5_000 })

          const delivery = yield* waitFor(
            llm,
            (input) => main(input) && text(input).includes(`${item.name} final result`),
            `background ${item.name} result delivery`,
          )
          expect(text({ body: delivery })).toContain(`${item.name} final result`)
          const final = yield* pollWithTimeout(
            Effect.gen(function* () {
              const messages = yield* sessions.messages({ sessionID: chat.id })
              const done = messages.some(
                (message) =>
                  message.info.role === "assistant" &&
                  message.info.finish === "stop" &&
                  message.info.time.completed !== undefined &&
                  message.parts.some(
                    (part) => part.type === "text" && part.text.includes(`parent received ${item.name} result`),
                  ),
              )
              return done ? messages : undefined
            }),
            "parent completion response",
            "5 seconds",
          )
          expect(
            final
              .flatMap((message) => message.parts)
              .some((part) => part.type === "text" && part.text.includes(`${item.name} final result`)),
          ).toBe(true)
        }
      }),
      { git: true, config: config },
    ),
  60_000,
)
