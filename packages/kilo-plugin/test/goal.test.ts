import { describe, expect } from "bun:test"
import type { CommandDefinition, CommandEditor, CommandInvocation } from "@opencode/plugin/effect/command"
import type { SessionIdle } from "@opencode/plugin/effect/session"
import type { ToolEditor } from "@opencode/plugin/effect/tool"
import type { PromptInput } from "@opencode/schema/prompt-input"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { Tool } from "@opencode/schema/tool"
import { DateTime, Effect, Layer } from "effect"
import { host } from "../../core/test/plugin/host"
import { testEffect } from "../../core/test/lib/effect"
import { KiloGoalPlugin } from "../src/goal"
import { evaluate } from "../src/goal/progress"
import { boot, parse, PREFIX, read } from "../src/goal/state"

const it = testEffect(Layer.empty)
const sessionID = "ses_goal_test" as Session.ID
const messageID = "msg_goal_test" as SessionMessage.ID

type Captured = {
  writes: Record<string, unknown>
  synthetic: { text: string; metadata?: Record<string, unknown> }[]
  changed: { sessionID: string; goal: unknown }[]
  command?: (input: CommandInvocation) => Effect.Effect<void, unknown>
  get?: (input: { sessionID: string }) => Effect.Effect<unknown, unknown>
  tools: Record<string, Tool.Info>
  idle?: (input: SessionIdle) => Effect.Effect<void, unknown>
}

function hostFor(captured: Captured, messages: SessionMessage.Info[] = []) {
  return host({
    rpc: {
      register: (_definition: unknown, handlers: { get: (input: { sessionID: string }) => Effect.Effect<unknown, unknown> }) =>
        Effect.succeed({
          ...((captured.get = handlers.get), {}),
          dispose: Effect.void,
          events: {
            emit: (_name: string, value: { sessionID: string; goal: unknown }) =>
              Effect.sync(() => {
                captured.changed.push(value)
              }),
          },
        }),
    } as unknown as ReturnType<typeof host>["rpc"],
    storage: {
      get: (key) => Effect.succeed(captured.writes[key] as never),
      set: (key, value) =>
        Effect.sync(() => {
          captured.writes[key] = value
        }),
      remove: (key) =>
        Effect.sync(() => {
          delete captured.writes[key]
        }),
      scan: () =>
        Effect.succeed({
          entries: Object.entries(captured.writes).map(([key, value]) => ({ key, value: value as never })),
        }),
    },
    command: {
      list: () => Effect.succeed([]),
      reload: () => Effect.void,
      transform: (callback: (editor: CommandEditor) => void) =>
        Effect.sync(() => {
          callback({
            add: (definition: CommandDefinition) => {
              captured.command = definition.execute
            },
          })
          return { dispose: Effect.void }
        }),
    } as unknown as ReturnType<typeof host>["command"],
    tool: {
      transform: (callback: (editor: ToolEditor) => void) =>
        Effect.sync(() => {
          callback({
            list: () => [],
            get: () => undefined,
            namespace: () => undefined,
            add: (tool: Tool.Info) => {
              captured.tools[tool.name] = tool
            },
            update: () => undefined,
            remove: () => undefined,
          })
          return { dispose: Effect.void }
        }),
      hook: () => Effect.succeed({ dispose: Effect.void }),
      reload: () => Effect.void,
      list: () => Effect.succeed([]),
    } as unknown as ReturnType<typeof host>["tool"],
    permission: {
      list: () => Effect.succeed([]),
      get: () => Effect.die("unused"),
      reply: () => Effect.die("unused"),
      hook: () => Effect.succeed({ dispose: Effect.void }),
      assert: () => Effect.void,
    } as unknown as ReturnType<typeof host>["permission"],
    session: {
      hook: (name, callback) =>
        Effect.sync(() => {
          if (name === "experimental.idle") captured.idle = callback as never
          return { dispose: Effect.void }
        }),
      get: () => Effect.succeed({ id: sessionID, time: { created: 0, updated: 0 } } as unknown as Session.Info),
      context: () => Effect.succeed(messages),
      synthetic: (input) =>
        Effect.sync(() => {
          captured.synthetic.push({ text: input.text, metadata: input.metadata })
          return {} as never
        }),
      update: () => Effect.void,
    },
  })
}

const start = (captured: Captured, messages: SessionMessage.Info[] = []) =>
  Effect.gen(function* () {
    yield* KiloGoalPlugin.effect(hostFor(captured, messages))
    return captured
  }).pipe(Effect.scoped)

const seed = (captured: Captured) =>
  Effect.sync(() => {
    captured.writes[PREFIX + sessionID] = {
      id: "goal-1",
      text: "Ship the release",
      status: "active",
      updatedAt: 1,
      boot: boot(),
    }
  })

const context = {
  agent: "code" as never,
  sessionID,
  messageID,
  id: "call-1" as never,
  progress: () => Effect.void,
}

const userMessage = (goalID: string): SessionMessage.Info =>
  ({
    id: "msg_goal_kickoff",
    type: "synthetic",
    time: { created: DateTime.makeUnsafe(0) },
    text: "Continue",
    metadata: { source: "goal", goalID },
  }) as unknown as SessionMessage.Info

const assistant = (
  content: SessionMessage.AssistantContent[],
  extra: Partial<SessionMessage.Assistant> = {},
): SessionMessage.Info =>
  ({
    id: messageID,
    type: "assistant",
    agent: "code",
    model: { providerID: "test", modelID: "test" },
    time: { created: DateTime.makeUnsafe(0) },
    content,
    ...extra,
  }) as unknown as SessionMessage.Info

const tool = (name: string, state: SessionMessage.ToolState): SessionMessage.AssistantContent => ({
  type: "tool",
  id: "call-1",
  name,
  state,
  time: { created: DateTime.makeUnsafe(0) },
})

const ok = { status: "completed", input: {}, content: [{ type: "text", text: "ok" }] } as SessionMessage.ToolState

describe("goal state", () => {
  it.effect("parses command controls and the delimiter", () =>
    Effect.sync(() => {
      expect(parse("")).toEqual({ kind: "status" })
      expect(parse("pause")).toEqual({ kind: "pause" })
      expect(parse("resume")).toEqual({ kind: "resume" })
      expect(parse("clear")).toEqual({ kind: "clear" })
      expect(parse("fix the tests")).toEqual({ kind: "start", text: "fix the tests" })
      expect(parse("-- pause the workers")).toEqual({ kind: "start", text: "pause the workers" })
    }),
  )

  it.effect("counts only real tool calls after the goal prompt", () =>
    Effect.sync(() => {
      const messages = [
      userMessage("goal-1"),
      assistant([
        tool("goal_report", ok),
        tool("shell", { status: "completed", input: {}, content: [{ type: "text", text: "ok" }], metadata: { exit: 0 } }),
        tool("question", ok),
      ]),
    ]
      expect(evaluate(messages, "goal-1")).toMatchObject({ success: 1, failure: 0, preempted: false })
    }),
  )

  it.effect("treats a failed tool as a failure and a real user prompt as preemption", () =>
    Effect.sync(() => {
      const messages = [
      userMessage("goal-1"),
      assistant([tool("shell", { status: "error", input: {}, error: { name: "Unknown" } as never })]),
      { id: "msg_user", type: "user", time: { created: DateTime.makeUnsafe(0) }, text: "hi", files: [] } as unknown as SessionMessage.Info,
    ]
      expect(evaluate(messages, "goal-1")).toMatchObject({ success: 0, failure: 1, preempted: true })
    }),
  )
})

describe("goal plugin", () => {
  it.effect("starts a goal and continues after a successful turn", () =>
    Effect.gen(function* () {
      const captured: Captured = { writes: {}, synthetic: [], changed: [], tools: {} }
      const messages: SessionMessage.Info[] = []
      yield* start(captured, messages)
      expect(captured.command).toBeDefined()
      expect(captured.idle).toBeDefined()
      expect(Object.keys(captured.tools).sort()).toEqual(["goal", "goal_report"])

      yield* captured.command!({
        sessionID,
        prompt: { text: "Ship the release" } as PromptInput.Prompt,
        delivery: "steer",
      })
      const started = read(captured.writes[PREFIX + sessionID])!
      expect(started).toMatchObject({ text: "Ship the release", status: "active" })
      expect(captured.synthetic).toHaveLength(1)
      expect(captured.synthetic[0]?.text).toContain("A session goal was set")

      messages.push(userMessage(started.id), assistant([tool("shell", ok)]))
      yield* captured.idle!({ sessionID, background: [] })
      expect(captured.synthetic).toHaveLength(2)
      expect(captured.synthetic[1]?.metadata).toMatchObject({ source: "goal", goalID: started.id })
    }),
  )

  it.effect("refuses goal control from the running goal turn", () =>
    Effect.gen(function* () {
      const captured: Captured = { writes: {}, synthetic: [], changed: [], tools: {} }
      yield* start(captured, [])
      yield* captured.command!({
        sessionID,
        prompt: { text: "Ship the release" } as PromptInput.Prompt,
        delivery: "steer",
      })
      const failure = yield* Effect.exit(
        captured.tools["goal"]!.execute({ action: "start", objective: "Again" }, context),
      )
      expect(failure._tag).toBe("Failure")
    }),
  )

  it.effect("settles complete on a report from the last turn", () =>
    Effect.gen(function* () {
      const captured: Captured = { writes: {}, synthetic: [], changed: [], tools: {} }
      yield* seed(captured)
      const messages = [
        userMessage("goal-1"),
        assistant([tool("shell", ok)]),
        assistant(
          [tool("goal_report", { ...ok, input: { status: "complete", reason: "Tests pass" } } as SessionMessage.ToolState)],
          { finish: "stop" },
        ),
      ]
      yield* start(captured, messages)
      yield* captured.tools["goal_report"]!.execute({ status: "complete", reason: "Tests pass" }, context)
      yield* captured.idle!({ sessionID, background: [] })
      expect(read(captured.writes[PREFIX + sessionID])).toMatchObject({
        status: "complete",
        reason: "Reported by the working model, not independently verified: Tests pass",
      })
    }),
  )

  it.effect("reads the goal through the registered RPC handler", () =>
    Effect.gen(function* () {
      const captured: Captured = { writes: {}, synthetic: [], changed: [], tools: {} }
      yield* seed(captured)
      yield* start(captured)
      expect(yield* captured.get!({ sessionID })).toMatchObject({
        id: "goal-1",
        text: "Ship the release",
        status: "active",
      })
      const empty: Captured = { writes: {}, synthetic: [], changed: [], tools: {} }
      yield* KiloGoalPlugin.effect(hostFor(empty))
      expect(yield* empty.get!({ sessionID })).toBeNull()
    }),
  )

  it.effect("keeps a user pause when a late report arrives", () =>
    Effect.gen(function* () {
      const captured: Captured = { writes: {}, synthetic: [], changed: [], tools: {} }
      yield* seed(captured)
      const messages = [
        userMessage("goal-1"),
        assistant([tool("shell", ok)]),
        assistant([tool("goal_report", { ...ok, input: { status: "complete", reason: "Tests pass" } } as SessionMessage.ToolState)]),
      ]
      yield* start(captured, messages)
      yield* captured.tools["goal_report"]!.execute({ status: "complete", reason: "Tests pass" }, context)
      yield* captured.command!({
        sessionID,
        prompt: { text: "pause" } as PromptInput.Prompt,
        delivery: "steer",
      })
      yield* captured.idle!({ sessionID, background: [] })
      expect(read(captured.writes[PREFIX + sessionID])).toMatchObject({
        status: "paused",
        reason: "Paused by the user",
      })
    }),
  )

  it.effect("pauses when a turn makes no progress", () =>
    Effect.gen(function* () {
      const captured: Captured = { writes: {}, synthetic: [], changed: [], tools: {} }
      yield* seed(captured)
      yield* start(captured, [userMessage("goal-1"), assistant([])])
      yield* captured.idle!({ sessionID, background: [] })
      expect(read(captured.writes[PREFIX + sessionID])).toMatchObject({
        status: "paused",
        reason: "No successful action or explicit completion report. Review the conversation before resuming.",
      })
    }),
  )

  it.effect("marks a goal waiting while background work runs and continues after", () =>
    Effect.gen(function* () {
      const captured: Captured = { writes: {}, synthetic: [], changed: [], tools: {} }
      yield* seed(captured)
      yield* start(captured, [userMessage("goal-1"), assistant([tool("shell", ok)])])
      yield* captured.idle!({
        sessionID,
        background: [{ kind: "shell", sessionID, shellID: "shell-1" as never, command: "bun test" }],
      })
      expect(read(captured.writes[PREFIX + sessionID])).toMatchObject({ status: "waiting" })
      yield* captured.idle!({ sessionID, background: [] })
      expect(read(captured.writes[PREFIX + sessionID])).toMatchObject({ status: "active" })
      expect(captured.synthetic).toHaveLength(1)
    }),
  )
})