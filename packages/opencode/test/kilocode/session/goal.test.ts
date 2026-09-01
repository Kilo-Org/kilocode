import path from "path"
import { expect, spyOn, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Latch, Stream } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionRunState } from "@/session/run-state"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Goal } from "@/kilocode/session/goal"
import { KiloSessionContinuation } from "@/kilocode/session/continuation"
import { TestInstance } from "../../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../lib/effect"
import { reply, TestLLMServer } from "../../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      SessionStatus.node,
      SessionRunState.node,
      EventV2Bridge.node,
      Permission.node,
      FSUtil.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  ),
)

const objective = "Improve the validation workflow"
const retained = { review: { branch: "feature" } }

const setup = Effect.fnUntraced(function* () {
  const llm = yield* TestLLMServer
  const fs = yield* FSUtil.Service
  const instance = yield* TestInstance
  yield* fs.writeWithDirs(
    path.join(instance.directory, "opencode.json"),
    JSON.stringify({
      model: "test/test-model",
      small_model: "test/test-model",
      enabled_providers: ["test"],
      formatter: false,
      lsp: false,
      provider: {
        test: {
          name: "Test",
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test-key", baseURL: llm.url },
          models: {
            "test-model": {
              name: "Test Model",
              tool_call: true,
              limit: { context: 100000, output: 10000 },
            },
            "selected-model": {
              name: "Selected Model",
              tool_call: true,
              limit: { context: 100000, output: 10000 },
            },
          },
        },
      },
    }),
  )
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const status = yield* SessionStatus.Service
  const session = yield* sessions.create({ title: "Goal validation", metadata: retained })
  const command = (args: string) =>
    awaitWithTimeout(
      prompt.command({
        sessionID: session.id,
        command: "goal",
        arguments: args,
        agent: "code",
        model: "test/test-model",
      }),
      "goal command waited for autonomous work",
      "10 seconds",
    )
  const metadata = sessions.get(session.id).pipe(Effect.map((value) => value.metadata))
  const idle = pollWithTimeout(
    status.get(session.id).pipe(Effect.map((value) => (value.type === "idle" ? true : undefined))),
    "goal response did not finish",
    "10 seconds",
  )
  const paused = pollWithTimeout(
    metadata.pipe(
      Effect.map((value) => {
        const goal = value?.["kilo.goal"]
        return goal && typeof goal === "object" && "active" in goal && goal.active === false ? goal : undefined
      }),
    ),
    "goal did not pause",
    "10 seconds",
  )
  const wait = (count: number) => awaitWithTimeout(llm.wait(count), "goal request did not arrive", "15 seconds")
  return { llm, sessions, prompt, status, session, command, metadata, idle, paused, wait }
})

it.instance(
  "runs two successful goal cycles and cancels the idle gap",
  () =>
    Effect.gen(function* () {
      const { llm, sessions, prompt, session, command, metadata, idle, wait } = yield* setup()
      yield* llm.push(reply().text("First step complete").stop(), reply().text("Second step complete").stop())
      const ack = yield* command(objective)
      expect(ack.info).toMatchObject({
        role: "assistant",
        finish: "stop",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      yield* wait(1)
      yield* idle
      expect(yield* metadata).toEqual({ ...retained, "kilo.goal": { text: objective, active: true } })
      yield* wait(2)
      yield* idle
      const messages = yield* sessions.messages({ sessionID: session.id })
      expect(messages.flatMap((message) => message.parts).filter((part) => part.type === "text")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: `/goal ${objective}`, ignored: true }),
          expect.objectContaining({ text: "First step complete" }),
          expect.objectContaining({ text: "Second step complete" }),
        ]),
      )
      for (const hit of yield* llm.hits) expect(JSON.stringify(hit.body)).toContain(objective)
      yield* prompt.cancel(session.id)
      expect(yield* metadata).toEqual({ ...retained, "kilo.goal": { text: objective, active: false } })
      yield* Effect.sleep("5200 millis")
      expect(yield* llm.hits).toHaveLength(2)
    }),
  30_000,
)

it.instance(
  "cancels an active goal stream without scheduling another request",
  () =>
    Effect.gen(function* () {
      const { llm, sessions, prompt, status, session, command, metadata } = yield* setup()
      const events = yield* EventV2Bridge.Service
      const received = yield* events.subscribe(MessageV2.Event.PartDelta).pipe(
        Stream.filter((event) => event.data.sessionID === session.id && event.data.delta === "Working on the goal"),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* llm.push(reply().text("Working on the goal").hang())
      yield* command(objective)
      yield* awaitWithTimeout(Fiber.join(received), "goal stream did not start", "10 seconds")
      expect((yield* status.get(session.id)).type).toBe("busy")
      yield* prompt.cancel(session.id)
      expect((yield* status.get(session.id)).type).toBe("idle")
      expect(yield* metadata).toEqual({ ...retained, "kilo.goal": { text: objective, active: false } })
      const stopped = (yield* sessions.messages({ sessionID: session.id })).at(-1)
      expect(stopped?.info.role === "assistant" && MessageV2.AbortedError.isInstance(stopped.info.error)).toBe(true)
      yield* Effect.sleep("5200 millis")
      expect(yield* llm.hits).toHaveLength(1)
    }),
  30_000,
)

it.instance(
  "pauses a working goal when a human prompt arrives",
  () =>
    Effect.gen(function* () {
      const { llm, prompt, session, command, metadata, paused, wait } = yield* setup()
      const gate = Promise.withResolvers<void>()
      yield* llm.push(reply().wait(gate.promise).text("Goal step complete").stop(), reply().text("Human reply").stop())
      yield* command(objective)
      yield* wait(1)
      const human = yield* prompt
        .prompt({
          sessionID: session.id,
          agent: "code",
          model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
          parts: [{ type: "text", text: "Answer this instead" }],
        })
        .pipe(Effect.forkChild)
      yield* paused
      gate.resolve()
      const response = yield* awaitWithTimeout(Fiber.join(human), "human prompt did not finish", "10 seconds")
      expect(response.parts).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Human reply" })]))
      expect(yield* metadata).toEqual({ ...retained, "kilo.goal": { text: objective, active: false } })
      expect(JSON.stringify((yield* llm.hits).at(-1)?.body)).toContain("Answer this instead")
      yield* Effect.sleep("5200 millis")
      expect(yield* llm.hits).toHaveLength(2)
    }),
  30_000,
)

it.instance(
  "pauses after a non-retryable model error",
  () =>
    Effect.gen(function* () {
      const { llm, sessions, session, command, paused, wait } = yield* setup()
      yield* llm.error(400, { error: { message: "Invalid goal request", type: "invalid_request_error" } })
      yield* command(objective)
      yield* wait(1)
      yield* paused
      const failed = (yield* sessions.messages({ sessionID: session.id })).at(-1)
      expect(failed?.info.role === "assistant" && failed.info.error).toBeTruthy()
      yield* Effect.sleep("5200 millis")
      expect(yield* llm.hits).toHaveLength(1)
    }),
  30_000,
)

it.instance(
  "pauses after a tool permission is rejected",
  () =>
    Effect.gen(function* () {
      const { llm, sessions, session, command, paused } = yield* setup()
      const permission = yield* Permission.Service
      yield* sessions.setPermission({
        sessionID: session.id,
        permission: [{ permission: "bash", pattern: "*", action: "ask" }],
      })
      yield* llm.tool("bash", { command: "pwd", description: "Check the workspace" })
      yield* command(objective)
      const pending = yield* pollWithTimeout(
        permission.list().pipe(Effect.map((items) => items.find((item) => item.sessionID === session.id))),
        "goal permission did not arrive",
        "10 seconds",
      )
      yield* permission.reply({ requestID: pending.id, reply: "reject" })
      yield* paused
      const messages = yield* sessions.messages({ sessionID: session.id })
      expect(
        messages
          .flatMap((message) => message.parts)
          .some((part) => part.type === "tool" && part.state.status === "error"),
      ).toBe(true)
      expect(yield* permission.list()).toHaveLength(0)
      yield* Effect.sleep("5200 millis")
      expect(yield* llm.hits).toHaveLength(1)
    }),
  30_000,
)

it.instance(
  "preserves metadata and paused forks while goal controls leave the transcript and model unchanged",
  () =>
    Effect.gen(function* () {
      const { llm, sessions, session, command, metadata, wait } = yield* setup()
      const selected = {
        agent: "ask",
        model: {
          providerID: ProviderV2.ID.make("test"),
          id: ModelV2.ID.make("selected-model"),
          variant: "focused",
        },
      }
      const ids = new Set<string>()
      const control = Effect.fnUntraced(function* (args: string) {
        yield* sessions.setAgentModel({ sessionID: session.id, ...selected, time: Date.now() })
        const before = yield* sessions.messages({ sessionID: session.id })
        const target = KiloSessionContinuation.target(before)
        if (before.length) expect(target).toBeDefined()
        for (const message of before) ids.add(message.info.id)
        const ack = yield* command(args)
        const after = yield* sessions.messages({ sessionID: session.id })
        expect(after.map((message) => message.info.id)).toEqual(before.map((message) => message.info.id))
        expect(KiloSessionContinuation.target(after)).toBe(target)
        expect(yield* sessions.get(session.id)).toMatchObject(selected)
        expect(ack.info.role).toBe("assistant")
        expect(ids.has(ack.info.id)).toBe(false)
        ids.add(ack.info.id)
        return ack
      })
      yield* sessions.setMetadata({
        sessionID: session.id,
        metadata: { ...retained, "kilo.goal": { text: objective, active: true } },
      })
      expect(yield* metadata).toEqual({ ...retained, "kilo.goal": { text: objective, active: false } })
      const status = yield* control("")
      expect(status.parts).toEqual(
        expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("paused") })]),
      )
      expect(yield* llm.hits).toHaveLength(0)
      yield* llm.hang
      yield* command("resume")
      yield* wait(1)
      const fork = yield* sessions.fork({ sessionID: session.id })
      expect(fork.metadata).toEqual({ ...retained, "kilo.goal": { text: objective, active: false } })
      expect((yield* sessions.get(fork.id)).metadata).toEqual(fork.metadata)
      expect(yield* metadata).toEqual({ ...retained, "kilo.goal": { text: objective, active: true } })
      yield* control("")
      yield* control("pause")
      expect(yield* metadata).toEqual({ ...retained, "kilo.goal": { text: objective, active: false } })
      yield* control("")
      expect(yield* llm.hits).toHaveLength(1)
      yield* llm.hang
      yield* command("resume")
      yield* wait(2)
      yield* control("clear")
      expect(yield* metadata).toEqual(retained)
      yield* Effect.sleep("5200 millis")
      expect(yield* llm.hits).toHaveLength(2)
    }),
  30_000,
)

it.instance(
  "keeps the goal paused after its instance is reloaded",
  () =>
    Effect.gen(function* () {
      const { llm, command, metadata, idle, wait } = yield* setup()
      const instance = yield* TestInstance
      const store = yield* InstanceStore.Service
      yield* llm.text("Goal step complete")
      yield* command(objective)
      yield* wait(1)
      yield* idle
      yield* awaitWithTimeout(store.reload({ directory: instance.directory }), "goal prevented instance disposal")
      expect(yield* metadata).toEqual({ ...retained, "kilo.goal": { text: objective, active: false } })
      yield* Effect.sleep("5200 millis")
      expect(yield* llm.hits).toHaveLength(1)
    }),
  30_000,
)

it.instance(
  "does not rearm a pending goal start after clear",
  () =>
    Effect.gen(function* () {
      const { llm, command, metadata } = yield* setup()
      const permission = yield* Permission.Service
      const ready = yield* Latch.make()
      const release = yield* Latch.make()
      const list = permission.list
      const stub = spyOn(permission, "list").mockImplementationOnce(() =>
        ready.open.pipe(Effect.andThen(release.await), Effect.andThen(list())),
      )
      yield* Effect.addFinalizer(() => release.open.pipe(Effect.andThen(Effect.sync(() => stub.mockRestore()))))
      const start = yield* command(objective).pipe(Effect.forkChild)
      yield* awaitWithTimeout(ready.await, "goal start did not reach permission preflight")
      yield* command("clear")
      expect(yield* metadata).toEqual(retained)
      yield* release.open
      const exit = yield* awaitWithTimeout(Fiber.await(start), "cleared goal start did not settle")
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(yield* metadata).toEqual(retained)
      yield* Effect.sleep("5200 millis")
      expect(yield* llm.hits).toHaveLength(0)
    }),
  30_000,
)

it.instance(
  "allows normal goal replacement but does not rearm a replacement after Stop",
  () =>
    Effect.gen(function* () {
      const { llm, prompt, session, command, metadata, wait } = yield* setup()
      yield* llm.hang
      yield* command(objective)
      yield* wait(1)
      yield* llm.hang
      yield* command("Review the validation results")
      yield* wait(2)
      expect(yield* metadata).toEqual({
        ...retained,
        "kilo.goal": { text: "Review the validation results", active: true },
      })
      expect(JSON.stringify((yield* llm.hits).at(-1)?.body)).toContain("Review the validation results")
      const state = yield* SessionRunState.Service
      const ready = yield* Latch.make()
      const release = yield* Latch.make()
      const cancel = state.cancel
      const stub = spyOn(state, "cancel").mockImplementationOnce((...args) =>
        ready.open.pipe(Effect.andThen(release.await), Effect.andThen(cancel(...args))),
      )
      yield* Effect.addFinalizer(() => release.open.pipe(Effect.andThen(Effect.sync(() => stub.mockRestore()))))
      const replacement = yield* command("This replacement must not run").pipe(Effect.forkChild)
      yield* awaitWithTimeout(ready.await, "replacement did not reach internal cancellation")
      yield* awaitWithTimeout(prompt.cancel(session.id), "external Stop waited for the blocked replacement")
      yield* release.open
      const exit = yield* awaitWithTimeout(Fiber.await(replacement), "stopped replacement did not settle")
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(yield* metadata).toEqual({
        ...retained,
        "kilo.goal": { text: "Review the validation results", active: false },
      })
      yield* Effect.sleep("5200 millis")
      expect(yield* llm.hits).toHaveLength(2)
    }),
  30_000,
)

test("continues successful goal stops but rejects plan handoffs and dismissed suggestions", () => {
  const session = SessionID.create()
  const parent = MessageID.ascending()
  const message = MessageID.ascending()
  const info = {
    id: message,
    sessionID: session,
    parentID: parent,
    role: "assistant",
    agent: "code",
    mode: "code",
    providerID: ProviderV2.ID.make("test"),
    modelID: ModelV2.ID.make("test-model"),
    path: { cwd: "/workspace", root: "/workspace" },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, completed: 2 },
    finish: "stop",
  } satisfies MessageV2.Assistant
  const part = {
    id: PartID.ascending(),
    messageID: message,
    sessionID: session,
    type: "tool",
    tool: "suggest",
    callID: "suggestion",
    state: {
      status: "completed",
      input: {},
      output: "Suggestion accepted",
      title: "Suggestion",
      metadata: { dismissed: false },
      time: { start: 1, end: 2 },
    },
  } satisfies MessageV2.ToolPart
  expect(Goal.completed({ info, parts: [] })).toBe(true)
  expect(Goal.completed({ info, parts: [part] })).toBe(true)
  expect(Goal.completed({ info, parts: [{ ...part, tool: "plan_exit" }] })).toBe(false)
  expect(
    Goal.completed({
      info,
      parts: [{ ...part, state: { ...part.state, metadata: { dismissed: true } } }],
    }),
  ).toBe(false)
})
