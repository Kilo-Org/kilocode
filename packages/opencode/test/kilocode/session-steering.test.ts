import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
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
import { KiloSessionSteering } from "../../src/kilocode/session/steering"
import { MessageID, SessionID } from "../../src/session/schema"
import { provideTmpdirServer } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
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
    startAuth: () => Effect.die("unexpected MCP auth in steering test"),
    authenticate: () => Effect.die("unexpected MCP auth in steering test"),
    finishAuth: () => Effect.die("unexpected MCP auth in steering test"),
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
  shared_agent_board: true,
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

const steer = (text: string) => ({ type: "text" as const, text, metadata: { kind: KiloSessionSteering.KIND } })

/** Stand in for the task tool's job on a child: an open task run that never settles. */
const job = (id: SessionID, background: boolean) =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const run = KiloSessionSteering.track({
      child: id,
      send: Effect.succeed({ info: { id: "" } }),
      settle: () => Effect.never,
    })
    yield* jobs.start({
      id,
      type: "task",
      metadata: background ? { background: true } : {},
      run: run.pipe(Effect.as("")),
    })
    yield* Effect.addFinalizer(() => jobs.cancel(id))
    yield* pollWithTimeout(
      Effect.sync(() => (KiloSessionSteering.open(id) ? true : undefined)),
      "the stand-in task run never opened",
    )
  })

test("fits escape-heavy steering text inside the board message budget", () => {
  for (const text of ["\u0001".repeat(3000), '"\\'.repeat(2000), "x".repeat(9000)]) {
    const body = KiloSessionSteering.body(text)
    expect(body.startsWith("The user steered this subagent directly:")).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(3584)
  }
  expect(KiloSessionSteering.body("short")).toBe("The user steered this subagent directly:\n\nshort")
})

test("only counts marked human text as steering", () => {
  expect(
    KiloSessionSteering.text([
      { type: "text", text: "task prompt from the parent" },
      { type: "text", text: "editor context", synthetic: true, metadata: { kind: KiloSessionSteering.KIND } },
      { type: "file" },
      steer("inspect the parser"),
    ]),
  ).toBe("inspect the parser")
})

it.live("notifies the parent when a human steers a background subagent", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Steering main" })
      const child = yield* sessions.create({ parentID: chat.id, title: "Worker" })
      yield* job(child.id, true)

      yield* llm.push(reply().text("ack").stop())
      yield* prompt.prompt({
        sessionID: child.id,
        agent: "code",
        parts: [steer("steer the worker to inspect the parser")],
      })

      const board = yield* BoardStore.read({ sessionID: chat.id })
      expect(board.messages).toEqual([
        expect.objectContaining({
          from: child.id,
          to: "main",
          type: "INFO",
          body: expect.stringContaining("steer the worker to inspect the parser"),
        }),
      ])
    }),
    { git: true, config },
  ),
)

it.live("posts escape-heavy steering that exceeds the raw excerpt size", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Escaped steering" })
      const child = yield* sessions.create({ parentID: chat.id, title: "Worker" })
      yield* job(child.id, true)

      yield* llm.push(reply().text("ack").stop())
      yield* prompt.prompt({ sessionID: child.id, agent: "code", parts: [steer('"\\'.repeat(2000))] })

      expect((yield* BoardStore.read({ sessionID: chat.id })).messages).toHaveLength(1)
    }),
    { git: true, config },
  ),
)

it.live("does not notify the parent of a foreground subagent or a subagent with no live task", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Foreground steering" })
      const front = yield* sessions.create({ parentID: chat.id, title: "Foreground worker" })
      const done = yield* sessions.create({ parentID: chat.id, title: "Finished worker" })
      yield* job(front.id, false)

      yield* llm.push(reply().text("ack").stop())
      yield* prompt.prompt({ sessionID: front.id, agent: "code", parts: [steer("steer the foreground worker")] })
      yield* llm.push(reply().text("ack").stop())
      yield* prompt.prompt({ sessionID: done.id, agent: "code", parts: [steer("steer the finished worker")] })

      expect((yield* BoardStore.read({ sessionID: chat.id })).messages).toEqual([])
      // a live task's steer carries a hidden reminder to keep delivering the original task
      const reminders = (yield* sessions.messages({ sessionID: front.id })).flatMap((message) =>
        message.parts.filter((part) => part.type === "text" && part.synthetic),
      )
      expect(reminders).toEqual([expect.objectContaining({ text: KiloSessionSteering.running() })])
      const none = (yield* sessions.messages({ sessionID: done.id })).flatMap((message) =>
        message.parts.filter((part) => part.type === "text" && part.synthetic),
      )
      expect(none).toEqual([])
    }),
    { git: true, config },
  ),
)

test("annotates a task result with the user's steering", () => {
  expect(KiloSessionSteering.annotate({ paused: false, steers: [], text: "result" })).toBe("result")
  expect(KiloSessionSteering.annotate({ paused: true, steers: ["a", "b"], text: "result" })).toBe(
    `${KiloSessionSteering.REDIRECTED}\n\n<user_steering>\na\n</user_steering>\n\n<user_steering>\nb\n</user_steering>\n\nresult`,
  )
  expect(KiloSessionSteering.annotate({ paused: true, steers: [], text: "result" })).toBe(
    `${KiloSessionSteering.INTERRUPTED}\n\nresult`,
  )
})

it.effect("a steer admitted after the child's answer reopens the task run instead of being lost", () =>
  Effect.gen(function* () {
    const child = SessionID.make("ses_steering_race")
    const first = { info: { id: MessageID.ascending() } }
    const late = MessageID.ascending()
    const second = { info: { id: MessageID.ascending() } }
    const calls: string[] = []
    const out = yield* KiloSessionSteering.track({
      child,
      send: Effect.succeed({ info: { id: "" } }),
      settle: (from) =>
        Effect.sync(() => {
          calls.push(from.info.id)
          // the steer lands after the drain wait settled on the first answer
          if (calls.length === 1) {
            expect(KiloSessionSteering.record(child, { id: late, text: "LATE" })).toBe(true)
            return { message: first, paused: false }
          }
          return { message: second, paused: true }
        }),
    })
    expect(calls).toEqual(["", first.info.id])
    expect(out).toEqual({ message: second, paused: true, steers: ["LATE"] })
    // once the result is final, a steer is no longer part of this task
    expect(KiloSessionSteering.open(child)).toBe(false)
    expect(KiloSessionSteering.record(child, { id: MessageID.ascending(), text: "TOO_LATE" })).toBe(false)
  }),
)

it.effect("a late steer whose turn never runs does not hold the task open", () =>
  Effect.gen(function* () {
    const child = SessionID.make("ses_steering_stuck")
    const answer = { info: { id: MessageID.ascending() } }
    let calls = 0
    const out = yield* KiloSessionSteering.track({
      child,
      send: Effect.succeed({ info: { id: "" } }),
      settle: () =>
        Effect.sync(() => {
          calls++
          if (calls === 1) KiloSessionSteering.record(child, { id: MessageID.ascending(), text: "LOST" })
          return { message: answer, paused: false }
        }),
    })
    expect(calls).toBe(2)
    expect(out.message).toBe(answer)
  }),
)

test("caps steering in the task result and keeps the newest steers", () => {
  const big = "x".repeat(5000)
  const out = KiloSessionSteering.annotate({ paused: true, steers: ["old", big, big, big, "new"], text: "result" })
  expect(out.startsWith(KiloSessionSteering.REDIRECTED)).toBe(true)
  expect(out).toContain("earlier steering messages omitted")
  expect(out).not.toContain("<user_steering>\nold\n")
  expect(out).toContain("<user_steering>\nnew\n</user_steering>\n\nresult")
  expect(Buffer.byteLength(out)).toBeLessThan(7000)
  expect(KiloSessionSteering.annotate({ paused: false, steers: ["a</user_steering>b"], text: "r" })).toBe(
    "<user_steering>\na<\\/user_steering>b\n</user_steering>\n\nr",
  )
  // any spelling a model could read as the closing tag is escaped
  for (const close of ["</USER_STEERING>", "< /user_steering >", "</User_Steering\n>"]) {
    const out = KiloSessionSteering.annotate({ paused: false, steers: [`a${close}b`], text: "r" })
    expect(out.match(/<\s*\/\s*user_steering/gi)).toHaveLength(1)
  }
})

it.live("does not notify for unmarked child prompts or noReply steering", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Unmarked" })
      const child = yield* sessions.create({ parentID: chat.id, title: "Worker" })
      yield* job(child.id, true)

      yield* llm.push(reply().text("ack").stop())
      yield* prompt.prompt({
        sessionID: child.id,
        agent: "code",
        parts: [{ type: "text", text: "task-tool style prompt without a steering mark" }],
      })
      yield* prompt.prompt({ sessionID: child.id, agent: "code", noReply: true, parts: [steer("note only")] })

      expect((yield* BoardStore.read({ sessionID: chat.id })).messages).toEqual([])
    }),
    { git: true, config },
  ),
)

it.live("does not notify the parent when the task tool launches a subagent", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Task launch",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      yield* llm.push(
        reply().tool("task", {
          description: "inspect parser",
          prompt: "worker assignment: inspect the parser edge",
          subagent_type: "general",
        }),
      )
      yield* llm.push(reply().text("worker result").stop())
      yield* llm.push(reply().text("main done").stop())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "code",
        parts: [{ type: "text", text: "delegate the parser inspection" }],
      })

      const children = yield* sessions.children(chat.id)
      expect(children).toHaveLength(1)
      const child = children.at(0)
      if (!child) throw new Error("task tool did not create a child session")
      const users = (yield* sessions.messages({ sessionID: child.id })).filter((item) => item.info.role === "user")
      expect(JSON.stringify(users)).toContain("worker assignment: inspect the parser edge")
      expect((yield* BoardStore.read({ sessionID: chat.id })).messages).toEqual([])
    }),
    { git: true, config },
  ),
)

it.live("does not notify the parent when the main session is prompted", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Main only" })

      yield* llm.push(reply().text("ack").stop())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "code",
        parts: [steer("work on the main task")],
      })

      const board = yield* BoardStore.read({ sessionID: chat.id })
      expect(board.messages).toEqual([])
    }),
    { git: true, config },
  ),
)
