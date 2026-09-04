import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { expect, spyOn } from "bun:test"
import path from "node:path"
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
import { BoardNotice } from "../../src/kilocode/board/notice"
import { BoardContext } from "../../src/kilocode/board/context"
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

for (const enabled of [false, true]) {
  it.live(`exposes board guidance and tools only when enabled (${enabled})`, () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Board guidance flag" })
        yield* llm.push(reply().text("Done").stop())
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "code",
          parts: [{ type: "text", text: "Reply briefly without tools." }],
        })
        const request = (yield* llm.inputs).at(0)
        if (!request) throw new Error("Missing model request")
        expect(
          messages({ body: request }).some(
            (message) => typeof message.content === "string" && message.content.includes(BoardContext.instructions),
          ),
        ).toBe(enabled)
        const tools = Array.isArray(request.tools) ? request.tools.filter(record) : []
        const names = tools.flatMap((tool) => (record(tool.function) ? [tool.function.name] : []))
        expect(names.includes("board_read")).toBe(enabled)
        expect(names.includes("board_post")).toBe(enabled)
        expect(JSON.stringify(tools).includes("Cursor from your last board_read, not an ID from board_post")).toBe(
          enabled,
        )
        expect(JSON.stringify(tools).includes("main is the board root, not necessarily your parent")).toBe(enabled)
      }),
      { config: (url) => ({ ...config(url), experimental: { shared_agent_board: enabled } }) },
    ),
  )
}

it.live(
  "delivers fixed tool notices and requires explicit reads without changing task completion",
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
        yield* llm.pushMatch(main, reply().tool("board_read", { since: null, limit: null }))
        yield* llm.pushMatch(main, reply().text("main read the peer notes as tool data").stop())
        yield* llm.pushMatch(
          sibling,
          reply()
            .wait(gate.promise)
            .tool("board_post", { to: "ALL", type: "INFO", body: "B boundary marker", reply_to: "" }),
        )
        yield* llm.pushMatch(sibling, reply().tool("board_read", { since: null, limit: null }))
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
          (input) => main(input) && calls(input, "bash") >= 1 && calls(input, "board_read") === 0,
          "main request with a fixed board notice",
        )
        const prefix = messages({ body: boundary })
        const outgoing = messages({ body: received })
        expect(outgoing.slice(0, prefix.length)).toEqual(prefix)
        expect(outgoing.at(-1)?.role).toBe("tool")
        expect(JSON.stringify(outgoing.at(-1)?.content)).toContain(BoardNotice.text)
        expect(outgoing.filter((message) => message.role === "user")).toEqual(
          prefix.filter((message) => message.role === "user"),
        )
        const body = text({ body: received })
        expect(body).not.toContain("A direct discovery for main")
        expect(body).not.toContain("A broadcast warning for every worker")
        expect(body).not.toContain("A routine broadcast body stays hidden")

        const update = yield* waitFor(
          llm,
          (input) => sibling(input) && calls(input, "board_post") >= 1 && calls(input, "board_read") === 0,
          "sibling request with a fixed board notice",
        )
        const notice = text({ body: update })
        expect(notice).toContain(BoardNotice.text)
        expect(notice).not.toContain("A broadcast warning for every worker")
        expect(notice).not.toContain("A direct discovery for main")
        expect(notice).not.toContain("A routine broadcast body stays hidden")

        for (const match of [main, sibling]) {
          const read = yield* waitFor(
            llm,
            (input) => match(input) && calls(input, "board_read") === 1,
            "request after an explicit board read",
          )
          const conversation = messages({ body: read })
          expect(conversation.at(-1)?.role).toBe("tool")
          const result = JSON.stringify(conversation.at(-1)?.content)
          expect(result).toContain("A direct discovery for main")
          expect(result).toContain("A broadcast warning for every worker")
          expect(result).toContain("A routine broadcast body stays hidden")
          expect(JSON.stringify(conversation.filter((message) => message.role !== "tool"))).not.toContain(
            "A direct discovery for main",
          )
          expect(conversation.filter((message) => message.role === "user")).toHaveLength(1)
        }
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

for (const failed of [false, true]) {
  it.live(
    `${failed ? "failed" : "successful"} explicit reads preserve the correct next-tool notice`,
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          yield* Effect.promise(() => Bun.write(path.join(dir, "boundary.txt"), "normal tool boundary"))
          const chat = yield* sessions.create({
            title: "Read before activity notice",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })
          const child = yield* sessions.create({ parentID: chat.id, title: "Peer" })
          yield* BoardStore.post({
            sessionID: child.id,
            messageID: "msg_read_notice",
            callID: "peer-post",
            to: "main",
            type: "INFO",
            body: "Explicit read regression body",
          })
          yield* llm.push(reply().tool("board_read", { since: failed ? "board_missing" : null, limit: null }))
          yield* llm.push(reply().tool("read", { filePath: "boundary.txt" }))
          yield* llm.push(reply().text("Done").stop())
          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            parts: [{ type: "text", text: "Read the board, then read boundary.txt." }],
          })
          const inputs = yield* llm.inputs
          expect(inputs).toHaveLength(3)
          const read = inputs.at(1)
          const next = inputs.at(2)
          if (!read || !next) throw new Error("Missing requests after tool results")
          const first = JSON.stringify(messages({ body: read }).at(-1))
          const last = JSON.stringify(messages({ body: next }).at(-1))
          expect(first).not.toContain(BoardNotice.text)
          expect(first.includes("Explicit read regression body")).toBe(!failed)
          expect(last).toContain("normal tool boundary")
          expect(last.includes(BoardNotice.text)).toBe(failed)
          expect(last).not.toContain("Explicit read regression body")
          const tools = (yield* sessions.messages({ sessionID: chat.id }))
            .flatMap((message) => message.parts)
            .filter((part) => part.type === "tool")
          expect(tools.map((part) => part.state.status)).toEqual([failed ? "error" : "completed", "completed"])
        }),
        { git: true, config },
      ),
    30_000,
  )
}

it.live(
  "preserves a completed tool result when cancelled during a notification check",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        yield* Effect.promise(() => Bun.write(path.join(dir, "completed.txt"), "completed-before-notice"))
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const activity = BoardStore.activity
        const probe = spyOn(BoardStore, "activity").mockImplementation((input) =>
          Effect.gen(function* () {
            entered.resolve()
            yield* Effect.promise(() => release.promise)
            return yield* activity(input)
          }),
        )
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            release.resolve()
            probe.mockRestore()
          }),
        )
        const chat = yield* sessions.create({
          title: "Notification cancellation",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* llm.push(reply().tool("read", { filePath: "completed.txt" }))
        const run = yield* prompt
          .prompt({
            sessionID: chat.id,
            agent: "code",
            parts: [{ type: "text", text: "Run the requested read-only check." }],
          })
          .pipe(Effect.forkChild)
        yield* awaitWithTimeout(
          Effect.promise(() => entered.promise),
          "notification check started",
          "5 seconds",
        )
        yield* awaitWithTimeout(prompt.cancel(chat.id), "cancel during notification check", "5 seconds")
        release.resolve()
        yield* Fiber.await(run)
        const parts = (yield* sessions.messages({ sessionID: chat.id })).flatMap((message) => message.parts)
        const tool = parts.find((part) => part.type === "tool" && part.tool === "read")
        if (!tool || tool.type !== "tool") throw new Error("The real read tool was not persisted")
        const saved =
          tool.state.status === "completed"
            ? tool.state.output
            : tool.state.status === "error"
              ? tool.state.metadata?.output
              : undefined
        expect(saved).toContain("completed-before-notice")
        expect(tool.state.status).not.toBe("running")
        expect(tool.state.status).not.toBe("pending")
        expect(parts.filter((part) => part.type === "tool")).toHaveLength(1)
        expect(JSON.stringify(parts)).not.toContain(BoardNotice.text)
      }),
      { git: true, config },
    ),
  30_000,
)
