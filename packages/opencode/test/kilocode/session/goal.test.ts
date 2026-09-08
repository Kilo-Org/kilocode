import path from "path"
import { pathToFileURL } from "node:url"
import { expect, spyOn, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Latch, Stream } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Agent } from "@/agent/agent"
import * as MCP from "@/mcp"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import type { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionRunState } from "@/session/run-state"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Goal } from "@/kilocode/session/goal/runner"
import { GoalPolicy } from "@/kilocode/session/goal/policy"
import { GoalState } from "@/kilocode/session/goal/state"
import { SessionDrain } from "@/kilocode/session/drain"
import { KiloSessionContinuation } from "@/kilocode/session/continuation"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import { Suggestion } from "@/kilocode/suggestion"
import { TestInstance } from "../../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../lib/effect"
import { httpError, reply, TestLLMServer } from "../../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      SessionStatus.node,
      SessionRunState.node,
      SessionDrain.node,
      Agent.node,
      MCP.node,
      BackgroundJob.node,
      Command.node,
      EventV2Bridge.node,
      Permission.node,
      Question.node,
      FSUtil.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  ),
)

const objective = "Improve the validation workflow"
const retained = { review: { branch: "feature" } }

const shell = (command = "pwd") => reply().tool("bash", { command, description: "Check the validation workspace" })

const setup = Effect.fnUntraced(function* (cfg: Partial<Config.Info> = {}) {
  const llm = yield* TestLLMServer
  const fs = yield* FSUtil.Service
  const instance = yield* TestInstance
  const model = {
    name: "Test Model",
    tool_call: true,
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 100000, output: 10000 },
  }
  yield* fs.writeWithDirs(
    path.join(instance.directory, "opencode.json"),
    JSON.stringify({
      model: "test/test-model",
      small_model: "test/test-model",
      enabled_providers: ["test"],
      formatter: false,
      lsp: false,
      ...cfg,
      provider: {
        test: {
          name: "Test",
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test-key", baseURL: llm.url },
          models: { "test-model": model, "selected-model": model },
        },
      },
    }),
  )
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const status = yield* SessionStatus.Service
  const session = yield* sessions.create({ title: "Goal validation", metadata: retained })
  const command = (args: string, messageID?: MessageID) =>
    awaitWithTimeout(
      prompt.command({
        sessionID: session.id,
        messageID,
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
    metadata.pipe(Effect.map((value) => (GoalState.read(value)?.active === false ? true : undefined))),
    "goal did not pause",
    "10 seconds",
  )
  const wait = (count: number) => awaitWithTimeout(llm.wait(count), "goal request did not arrive", "15 seconds")
  return { llm, sessions, prompt, status, session, command, metadata, idle, paused, wait }
})

for (const status of ["complete", "blocked"] as const) {
  it.instance(
    `persists explicit root ${status} report after its tool response finishes`,
    Effect.gen(function* () {
      const reason = status === "complete" ? "The tests passed." : "Required credentials are missing."
      const run = yield* setup()
      yield* run.llm.push(reply().tool("goal_report", { status, reason }), reply().text("Final report").stop())
      yield* run.command(objective)
      yield* run.paused
      const goal = GoalState.read(yield* run.metadata)
      expect(goal).toMatchObject({
        text: objective,
        status,
        active: false,
        reason: expect.stringContaining(reason),
      })
      const hits = yield* run.llm.hits
      expect(hits).toHaveLength(2)
      expect(hits.at(-1)?.body.model).toBe("test-model")
      expect(JSON.stringify(hits.at(-1)?.body.messages)).toContain("Report recorded for this turn")
      const messages = yield* run.sessions.messages({ sessionID: run.session.id })
      expect(
        messages
          .flatMap((message) => message.parts)
          .some((part) => part.type === "tool" && part.tool === "goal_report" && part.state.status === "completed"),
      ).toBe(true)
      const store = yield* InstanceStore.Service
      const instance = yield* TestInstance
      yield* store.reload({ directory: instance.directory })
      expect(GoalState.read(yield* run.metadata)).toEqual(goal)
      yield* run.command("pause")
      expect(GoalState.read(yield* run.metadata)).toEqual(goal)
      yield* run.command("clear")
      expect(yield* run.metadata).toEqual(retained)
    }),
  )
}

for (const action of ["stop", "pause", "clear", "replace"] as const) {
  it.instance(
    `discards a pending root report after ${action}`,
    Effect.gen(function* () {
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(gate.resolve))
      const run = yield* setup()
      yield* run.llm.push(
        reply().tool("goal_report", { status: "complete", reason: "Old report" }),
        reply().wait(gate.promise).text("Done").stop(),
        reply().hang(),
      )
      yield* run.command(objective)
      yield* run.wait(2)
      expect(GoalState.read(yield* run.metadata)?.status).toBe("active")
      const message = (yield* run.sessions.messages({ sessionID: run.session.id }))
        .flatMap((message) => message.parts)
        .find((part) => part.type === "tool" && part.tool === "goal_report")?.messageID
      if (!message) throw new Error("Report tool response missing")
      if (action === "stop") yield* run.prompt.cancel(run.session.id)
      if (action === "pause" || action === "clear") yield* run.command(action)
      if (action === "replace") yield* run.command("New objective")
      expect(GoalPolicy.report(run.session.id, message, { status: "complete", reason: "Stale report" })).toBe(false)
      gate.resolve()
      const goal = GoalState.read(yield* run.metadata)
      if (action === "clear") expect(goal).toBeUndefined()
      if (action === "stop" || action === "pause") expect(goal?.status).toBe("paused")
      if (action === "replace") expect(goal).toMatchObject({ text: "New objective", status: "active" })
      expect(goal?.reason ?? "").not.toContain("Old report")
      yield* run.prompt.cancel(run.session.id)
    }),
  )
}

it.instance(
  "pauses without an explicit tool report even when text claims completion",
  Effect.gen(function* () {
    const run = yield* setup()
    yield* run.llm.text("Goal complete. All work is done.")
    yield* run.command(objective)
    yield* run.paused
    expect(GoalState.read(yield* run.metadata)).toMatchObject({
      status: "paused",
      reason: expect.stringContaining("No successful action"),
    })
    expect(yield* run.llm.hits).toHaveLength(1)
  }),
)

it.instance(
  "restarts a complete goal only after explicit resume and clears the old report",
  Effect.gen(function* () {
    const run = yield* setup()
    yield* run.llm.push(
      reply().tool("goal_report", { status: "complete", reason: "Tests passed" }),
      reply().text("Done").stop(),
      reply().hang(),
    )
    yield* run.command(objective)
    yield* run.paused
    expect(GoalState.read(yield* run.metadata)?.status).toBe("complete")
    yield* run.command("resume")
    yield* run.wait(3)
    expect(GoalState.read(yield* run.metadata)).toEqual({ text: objective, active: true, status: "active" })
    yield* run.prompt.cancel(run.session.id)
    expect(GoalState.read(yield* run.metadata)?.status).toBe("paused")
  }),
)

it.instance(
  "does not accept a Goal report from ordinary chat",
  Effect.gen(function* () {
    const run = yield* setup()
    yield* run.llm.push(
      reply().tool("goal_report", { status: "complete", reason: "Not a Goal" }),
      reply().text("Done").stop(),
    )
    yield* run.prompt.prompt({ sessionID: run.session.id, parts: [{ type: "text", text: "Ordinary work" }] })
    expect(JSON.stringify((yield* run.llm.hits).at(0)?.body.tools)).not.toContain('"goal_report"')
    expect(GoalState.read(yield* run.metadata)).toBeUndefined()
    const parts = (yield* run.sessions.messages({ sessionID: run.session.id })).flatMap((message) => message.parts)
    expect(
      parts.some((part) => part.type === "tool" && part.tool === "goal_report" && part.state.status === "completed"),
    ).toBe(false)
  }),
)

it.instance(
  "does not complete a Goal when work fails after a report",
  Effect.gen(function* () {
    const run = yield* setup({ permission: { bash: "allow" } })
    yield* run.llm.push(
      reply().tool("goal_report", { status: "complete", reason: "Premature report" }),
      shell("exit 1"),
      reply().text("Failed").stop(),
    )
    yield* run.command(objective)
    yield* run.paused
    expect(GoalState.read(yield* run.metadata)).toMatchObject({
      status: "paused",
      reason: expect.stringContaining("Work failed"),
    })
  }),
)

it.instance(
  "keeps Goal report permission rejection as a blocker",
  Effect.gen(function* () {
    const run = yield* setup({ permission: { goal_report: "ask" } })
    const permissions = yield* Permission.Service
    yield* run.llm.push(
      reply().tool("goal_report", { status: "complete", reason: "Tests passed" }),
      reply().text("Blocked").stop(),
    )
    yield* run.command(objective)
    const request = yield* pollWithTimeout(
      permissions
        .list()
        .pipe(
          Effect.map((items) =>
            items.find((item) => item.sessionID === run.session.id && item.permission === "goal_report"),
          ),
        ),
      "Goal report did not request permission",
      "10 seconds",
    )
    yield* permissions.reply({ requestID: request.id, reply: "reject" })
    yield* run.paused
    expect(GoalState.read(yield* run.metadata)?.status).toBe("blocked")
  }),
)

for (const reason of ["", "   ", "x".repeat(2001)]) {
  it.instance(
    `rejects invalid Goal report reason of length ${reason.length}`,
    Effect.gen(function* () {
      const run = yield* setup()
      yield* run.llm.push(reply().tool("goal_report", { status: "complete", reason }), reply().text("Done").stop())
      yield* run.command(objective)
      yield* run.paused
      expect(GoalState.read(yield* run.metadata)?.status).toBe("paused")
    }),
  )
}

for (const state of ["ordinary", "pause", "clear", "completed"] as const) {
  it.instance(
    `excludes only questions during goals and restores them for ${state} chat`,
    Effect.gen(function* () {
      const run = yield* setup()
      const question = yield* Question.Service
      if (state !== "ordinary") {
        yield* run.llm.push(state === "completed" ? reply().text("Goal completed").stop() : reply().hang())
        yield* run.command(objective)
        yield* run.wait(1)
        if (state === "completed") yield* run.paused
        if (state !== "completed") {
          expect(GoalPolicy.available(run.session.id, "question")).toBe(false)
          yield* run.command(state)
        }
        yield* run.idle
      }
      yield* run.llm.push(
        reply().tool("question", {
          questions: [
            { header: "Scope", question: "Which scope?", options: [{ label: "Small", description: "Small scope" }] },
          ],
        }),
        reply().text("Scope selected").stop(),
      )
      const work = yield* run.prompt
        .prompt({
          sessionID: run.session.id,
          parts: [{ type: "text", text: "Help select the scope" }],
        })
        .pipe(Effect.forkChild)
      const pending = yield* pollWithTimeout(
        question.list().pipe(Effect.map((items) => items.find((item) => item.sessionID === run.session.id))),
        "chat question was not requested",
      )
      expect(GoalPolicy.available(run.session.id, "question")).toBe(true)
      const hits = yield* run.llm.hits
      const tools = hits.at(-1)?.body.tools
      expect(tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: "question" }) })]),
      )
      if (state !== "ordinary") {
        expect(
          (hits.at(0)?.body.tools as { function: { name: string } }[]).filter(
            (tool) => tool.function.name !== "goal_report",
          ),
        ).toEqual((tools as { function: { name: string } }[]).filter((tool) => tool.function.name !== "question"))
        expect(JSON.stringify(hits.at(0)?.body.tools)).toContain('"goal_report"')
      }
      yield* question.reply({ requestID: pending.id, answers: [["Small"]] })
      yield* Fiber.join(work)
    }),
    30_000,
  )
}

it.instance(
  "restricts foreground goal delegates without restricting independent child prompts",
  Effect.gen(function* () {
    const run = yield* setup({ agent: { general: { model: "test/selected-model" } } })
    yield* run.llm.pushMatch(
      ({ body }) => body.model === "test-model",
      reply().tool("task", { description: "Check scope", prompt: "Inspect the scope", subagent_type: "general" }),
    )
    yield* run.llm.pushMatch(({ body }) => body.model === "selected-model", reply().hang(), reply().hang())
    yield* run.command(objective)
    yield* run.wait(2)
    const child = (yield* run.sessions.children(run.session.id)).at(0)
    if (!child) throw new Error("Goal did not create a child")
    expect(GoalPolicy.available(child.id, "question")).toBe(false)
    expect(GoalPolicy.available(child.id, "goal_report")).toBe(false)
    expect(JSON.stringify((yield* run.llm.hits).at(1)?.body.tools)).not.toContain('"goal_report"')
    yield* run.command("pause")
    yield* run.idle
    const work = yield* run.prompt
      .prompt({ sessionID: child.id, parts: [{ type: "text", text: "Independent work" }] })
      .pipe(Effect.forkChild)
    yield* run.wait(3)
    expect(GoalPolicy.available(child.id, "question")).toBe(true)
    expect(GoalPolicy.available(child.id, "goal_report")).toBe(false)
    yield* run.prompt.cancel(child.id)
    yield* Fiber.await(work)
  }),
  30_000,
)

it.instance(
  "does not execute an unadvertised question during a goal",
  Effect.gen(function* () {
    const run = yield* setup()
    const question = yield* Question.Service
    yield* run.llm.push(
      reply().tool("question", {
        questions: [
          { header: "Scope", question: "Which scope?", options: [{ label: "Small", description: "Small scope" }] },
        ],
      }),
      reply().text("Cannot proceed safely").stop(),
    )
    yield* run.command(objective)
    yield* run.wait(2)
    yield* run.paused
    expect(yield* question.list()).toEqual([])
    const parts = (yield* run.sessions.messages({ sessionID: run.session.id })).flatMap((message) => message.parts)
    expect(
      parts.some((part) => part.type === "tool" && part.tool === "question" && part.state.status === "completed"),
    ).toBe(false)
  }),
  30_000,
)

it.instance(
  "starts a multiline composer objective with image and file attachments in the same session",
  Effect.gen(function* () {
    const run = yield* setup()
    const text = "Implement this design\n\nKeep the file requirements."
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="
    yield* run.llm.text("Waiting for clarification")
    yield* run.prompt.command({
      sessionID: run.session.id,
      agent: "code",
      command: "goal",
      arguments: `-- ${text}`,
      model: "test/test-model",
      parts: [
        { type: "file", mime: "image/png", url: image, filename: "design.png" },
        {
          type: "file",
          mime: "text/plain",
          url: `data:text/plain;base64,${Buffer.from("Use accessible controls").toString("base64")}`,
          filename: "requirements.txt",
        },
      ],
    })
    yield* run.wait(1)
    yield* run.paused
    expect(yield* run.metadata).toMatchObject({ ...retained, "kilo.goal": { text, active: false, status: "paused" } })
    const body = JSON.stringify((yield* run.llm.hits).at(-1)?.body)
    expect(body).toContain("Implement this design\\n\\nKeep the file requirements.")
    expect(body).toContain("Use accessible controls")
    expect(body).toContain(image)
    const messages = yield* run.sessions.messages({ sessionID: run.session.id })
    expect(messages.every((message) => message.info.sessionID === run.session.id)).toBe(true)
    expect(
      messages
        .flatMap((message) => message.parts)
        .some((part) => part.type === "file" && part.filename === "design.png"),
    ).toBe(true)
  }),
  30_000,
)

it.instance(
  "rejects invalid goal attachments before acknowledging submission",
  Effect.gen(function* () {
    const run = yield* setup()
    const result = yield* run.prompt
      .command({
        sessionID: run.session.id,
        agent: "code",
        command: "goal",
        arguments: `-- ${objective}`,
        model: "test/test-model",
        parts: [
          { type: "file", mime: "image/png", url: "data:image/png;base64,bm90LWFuLWltYWdl", filename: "invalid.png" },
        ],
      })
      .pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    expect(GoalState.read(yield* run.metadata)).toBeUndefined()
    expect(yield* run.llm.hits).toHaveLength(0)
  }),
  30_000,
)

for (const kind of ["image", "file"] as const) {
  it.instance(
    `invalid replacement ${kind} preserves the objective and held execution`,
    Effect.gen(function* () {
      const run = yield* setup()
      const instance = yield* TestInstance
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(gate.resolve))
      yield* run.llm.push(reply().wait(gate.promise).text("Original execution finished").stop())
      yield* run.command(objective)
      yield* run.wait(1)
      const base = KiloSessionPromptQueue.active(run.session.id)
      const before = yield* run.sessions.messages({ sessionID: run.session.id })
      const metadata = yield* run.metadata
      const selection = yield* run.sessions.get(run.session.id)
      const result = yield* run.prompt
        .command({
          sessionID: run.session.id,
          agent: "ask",
          model: "test/selected-model",
          command: "goal",
          arguments: "-- Invalid replacement",
          parts: [
            kind === "image"
              ? {
                  type: "file",
                  mime: "image/png",
                  url: "data:image/png;base64,bm90LWFuLWltYWdl",
                  filename: "invalid.png",
                }
              : {
                  type: "file",
                  mime: "text/plain",
                  url: pathToFileURL(path.join(instance.directory, "missing.txt")).href,
                  filename: "missing.txt",
                },
          ],
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      expect(yield* run.metadata).toEqual(metadata)
      expect(GoalState.active(run.session.id)).toBe(true)
      expect(KiloSessionPromptQueue.active(run.session.id)).toBe(base)
      expect((yield* run.status.get(run.session.id)).type).toBe("busy")
      const after = yield* run.sessions.messages({ sessionID: run.session.id })
      expect(after.map((message) => message.info.id)).toEqual(before.map((message) => message.info.id))
      expect(after.filter((message) => message.info.role === "user").map((message) => message.parts)).toEqual(
        before.filter((message) => message.info.role === "user").map((message) => message.parts),
      )
      expect(yield* run.sessions.get(run.session.id)).toMatchObject({ agent: selection.agent, model: selection.model })
      gate.resolve()
      yield* run.paused
      const last = (yield* run.sessions.messages({ sessionID: run.session.id })).at(-1)
      expect(last?.info.role === "assistant" && last.info.error).toBeUndefined()
      expect(last?.parts).toContainEqual(expect.objectContaining({ type: "text", text: "Original execution finished" }))
      expect(yield* run.llm.hits).toHaveLength(1)
    }),
    30_000,
  )
}

it.instance(
  "preserves interruption during replacement attachment admission",
  Effect.gen(function* () {
    const run = yield* setup()
    yield* run.llm.push(reply().hang())
    yield* run.command(objective)
    yield* run.wait(1)
    const mcp = yield* MCP.Service
    using read = spyOn(mcp, "readResource").mockReturnValue(Effect.interrupt)
    const result = yield* run.prompt
      .command({
        sessionID: run.session.id,
        command: "goal",
        arguments: "-- Replacement",
        parts: [
          {
            type: "file",
            mime: "text/plain",
            url: "mcp://fixture/context",
            filename: "context.txt",
            source: {
              type: "resource",
              clientName: "fixture",
              uri: "fixture://context",
              text: { value: "context", start: 0, end: 7 },
            },
          },
        ],
      })
      .pipe(Effect.exit)
    expect(read).toHaveBeenCalledTimes(1)
    expect(Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)).toBe(true)
    expect(GoalState.read(yield* run.metadata)).toMatchObject({ text: objective, active: true })
    yield* run.prompt.cancel(run.session.id)
  }),
  30_000,
)

for (const action of ["replace", "stop"] as const) {
  it.instance(
    `fences valid attachment preparation against ${action}`,
    Effect.gen(function* () {
      const run = yield* setup()
      yield* run.llm.push(reply().hang(), reply().hang())
      yield* run.command(objective)
      yield* run.wait(1)
      const agents = yield* Agent.Service
      const ready = yield* Latch.make()
      const release = yield* Latch.make()
      const get = agents.get
      const stub = spyOn(agents, "get").mockImplementationOnce((name) =>
        ready.open.pipe(Effect.andThen(release.await), Effect.andThen(get(name))),
      )
      yield* Effect.addFinalizer(() => release.open.pipe(Effect.andThen(Effect.sync(() => stub.mockRestore()))))
      const id = MessageID.ascending()
      const pending = yield* run.prompt
        .command({
          sessionID: run.session.id,
          messageID: id,
          agent: "code",
          model: "test/test-model",
          command: "goal",
          arguments: "-- Prepared replacement",
          parts: [
            { type: "file", mime: "text/plain", url: "data:text/plain;base64,Y29udGV4dA==", filename: "context.txt" },
          ],
        })
        .pipe(Effect.forkChild)
      yield* awaitWithTimeout(ready.await, "replacement did not reach preparation")
      expect(GoalState.read(yield* run.metadata)).toMatchObject({ text: objective, active: true })
      expect((yield* run.status.get(run.session.id)).type).toBe("busy")
      if (action === "stop") yield* awaitWithTimeout(run.prompt.cancel(run.session.id), "Stop waited for admission")
      yield* release.open
      const exit = yield* awaitWithTimeout(Fiber.await(pending), "replacement did not settle")
      if (action === "stop") {
        expect(Exit.hasInterrupts(exit)).toBe(true)
        expect(GoalState.read(yield* run.metadata)).toMatchObject({ text: objective, active: false })
        expect(
          (yield* run.sessions.messages({ sessionID: run.session.id })).some((message) => message.info.id === id),
        ).toBe(false)
        expect(yield* run.llm.hits).toHaveLength(1)
        return
      }
      expect(Exit.isSuccess(exit)).toBe(true)
      yield* run.wait(2)
      expect(GoalState.read(yield* run.metadata)).toMatchObject({ text: "Prepared replacement", active: true })
      expect(JSON.stringify((yield* run.llm.hits).at(-1)?.body)).toContain("context")
      yield* run.prompt.cancel(run.session.id)
    }),
    30_000,
  )
}

for (const text of ["pause", "resume", "clear"]) {
  it.instance(
    `accepts the literal composer objective ${text}`,
    Effect.gen(function* () {
      const run = yield* setup()
      yield* run.llm.text("Please clarify")
      yield* run.command(`-- ${text}`)
      yield* run.wait(1)
      yield* run.paused
      expect(yield* run.metadata).toMatchObject({ ...retained, "kilo.goal": { text, active: false, status: "paused" } })
    }),
  )
}

it.instance(
  "runs two successful goal cycles and cancels the idle gap",
  Effect.gen(function* () {
    const { llm, sessions, prompt, session, command, metadata, idle, wait } = yield* setup()
    yield* llm.push(
      shell(),
      reply().text("First step complete").stop(),
      shell(),
      reply().text("Second step complete").stop(),
    )
    const ack = yield* command(objective)
    expect(ack.info).toMatchObject({
      role: "assistant",
      finish: "stop",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    yield* wait(2)
    yield* idle
    expect(yield* metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: objective, active: true, status: "active" },
    })
    yield* wait(4)
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
    expect(yield* metadata).toMatchObject({ ...retained, "kilo.goal": { text: objective, active: false } })
    yield* Effect.sleep("5200 millis")
    expect(yield* llm.hits).toHaveLength(4)
  }),
  30_000,
)

for (const disposed of [false, true]) {
  it.instance(
    disposed
      ? "disposes an active goal observer without scheduling another request"
      : "cancels an active goal stream without scheduling another request",
    Effect.gen(function* () {
      const { llm, sessions, prompt, status, session, command, metadata } = yield* setup()
      yield* llm.text("Ready")
      yield* prompt.prompt({ sessionID: session.id, parts: [{ type: "text", text: "Initialize the test" }] })
      const events = yield* EventV2Bridge.Service
      const listen = events.listen
      let observers = 0
      const stub = spyOn(events, "listen").mockImplementation((subscriber) =>
        listen(subscriber).pipe(
          Effect.map((off) => {
            observers++
            return off.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  observers--
                }),
              ),
            )
          }),
        ),
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => stub.mockRestore()))
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
      expect(observers).toBeGreaterThan(0)
      if (disposed) {
        const store = yield* InstanceStore.Service
        const instance = yield* TestInstance
        yield* awaitWithTimeout(store.reload({ directory: instance.directory }), "active goal prevented disposal")
      }
      if (!disposed) yield* prompt.cancel(session.id)
      yield* pollWithTimeout(
        Effect.sync(() => (observers === 0 ? true : undefined)),
        "goal observer survived Stop or disposal",
      )
      expect((yield* status.get(session.id)).type).toBe("idle")
      expect(yield* metadata).toMatchObject({
        ...retained,
        "kilo.goal": { text: objective, active: false, status: "paused" },
      })
      const stopped = (yield* sessions.messages({ sessionID: session.id })).at(-1)
      expect(stopped?.info.role === "assistant" && MessageV2.AbortedError.isInstance(stopped.info.error)).toBe(true)
      yield* Effect.sleep("5200 millis")
      expect(yield* llm.hits).toHaveLength(2)
    }),
    30_000,
  )
}

it.instance(
  "pauses a working goal when a human prompt arrives",
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
    expect(yield* metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: objective, active: false, status: "paused" },
    })
    expect(JSON.stringify((yield* llm.hits).at(-1)?.body)).toContain("Answer this instead")
    yield* Effect.sleep("5200 millis")
    expect(yield* llm.hits).toHaveLength(2)
  }),
  30_000,
)

for (const kind of ["permission", "suggestion"] as const) {
  it.instance(
    `failed goal replacement and resume preserve the pending ${kind} and original turn`,
    Effect.gen(function* () {
      const run = yield* setup()
      const permission = yield* Permission.Service
      const state = yield* SessionRunState.Service
      yield* run.sessions.setPermission({
        sessionID: run.session.id,
        permission: [{ permission: "bash", pattern: "*", action: "ask" }],
      })
      yield* run.llm.push(
        kind === "permission"
          ? shell()
          : reply().tool("suggest", {
              suggest: "Continue validation",
              actions: [{ label: "Continue", prompt: "Continue the current objective" }],
            }),
      )
      yield* run.command(objective)
      const list = Effect.gen(function* () {
        if (kind === "permission") return yield* permission.list()
        return yield* Effect.promise(() => Suggestion.list())
      })
      const request = yield* pollWithTimeout(
        list.pipe(Effect.map((items) => items.find((item) => item.sessionID === run.session.id))),
        "goal attention did not arrive",
      )
      const before = yield* run.sessions.messages({ sessionID: run.session.id })
      const base = KiloSessionPromptQueue.active(run.session.id)
      expect(base).toBeDefined()
      for (const args of ["Replace the current objective", "resume"]) {
        const exit = yield* run.command(args).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit))
          expect(String(Cause.squash(exit.cause))).toContain("Resolve pending questions and permissions")
        expect(yield* run.metadata).toMatchObject({
          ...retained,
          "kilo.goal": { text: objective, active: true, status: "active" },
        })
        const pending = yield* list
        expect(pending).toHaveLength(1)
        expect(pending.at(0)).toEqual(request)
        expect(KiloSessionPromptQueue.active(run.session.id)).toBe(base)
        expect(yield* run.sessions.messages({ sessionID: run.session.id })).toEqual(before)
        const busy = yield* state.assertNotBusy(run.session.id).pipe(Effect.exit)
        expect(Exit.isFailure(busy) && Cause.squash(busy.cause) instanceof Session.BusyError).toBe(true)
        expect(yield* run.llm.hits).toHaveLength(1)
      }
      if ("permission" in request) yield* permission.reply({ requestID: request.id, reply: "reject" })
      if ("actions" in request) {
        yield* run.llm.text("Suggestion dismissed")
        yield* Effect.promise(() => Suggestion.dismiss(request.id))
      }
      yield* run.paused
      expect(yield* list).toEqual([])
    }),
    30_000,
  )
}

for (const idle of [false, true]) {
  it.instance(
    `unknown command preserves a goal's ${idle ? "idle gap" : "active turn"} without hiding owned errors`,
    Effect.gen(function* () {
      const run = yield* setup()
      const events = yield* EventV2Bridge.Service
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(gate.resolve))
      if (idle) gate.resolve()
      yield* run.llm.push(
        shell(),
        reply().wait(gate.promise).text("Validation checked").stop(),
        shell(),
        httpError(400, { error: { message: 'Command not found: "gaol".', type: "invalid_request_error" } }),
      )
      yield* run.command(objective)
      yield* run.wait(2)
      if (idle)
        yield* pollWithTimeout(
          Effect.sync(() => (!KiloSessionPromptQueue.active(run.session.id) ? true : undefined)),
          "goal did not reach its idle gap",
        )
      const base = KiloSessionPromptQueue.active(run.session.id)
      expect(!!base).toBe(!idle)
      const before = yield* run.sessions.messages({ sessionID: run.session.id })
      const feedback = yield* events.subscribe(Session.Event.Error).pipe(
        Stream.filter((event) => event.data.sessionID === run.session.id),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      )
      const exit = yield* run.prompt
        .command({ sessionID: run.session.id, command: "gaol", arguments: "" })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      const errors = yield* awaitWithTimeout(Fiber.join(feedback), "unknown command did not report its error")
      expect(errors.at(0)?.data.error).toMatchObject({
        name: "UnknownError",
        data: { message: expect.stringContaining('Command not found: "gaol"') },
      })
      expect(KiloSessionPromptQueue.active(run.session.id)).toBe(base)
      expect((yield* run.sessions.messages({ sessionID: run.session.id })).map((message) => message.info.id)).toEqual(
        before.map((message) => message.info.id),
      )
      expect((yield* run.status.get(run.session.id)).type).toBe(idle ? "idle" : "busy")
      expect(yield* run.metadata).toMatchObject({
        ...retained,
        "kilo.goal": { text: objective, active: true, status: "active" },
      })
      gate.resolve()
      yield* run.wait(4)
      yield* run.paused
      const last = (yield* run.sessions.messages({ sessionID: run.session.id })).at(-1)
      expect(last?.info.role === "assistant" && last.info.error?.name).toBe("APIError")
      expect(yield* run.llm.hits).toHaveLength(4)
    }),
    30_000,
  )
}

it.instance(
  "does not let a command stopped during lookup pause a newer goal",
  Effect.gen(function* () {
    const run = yield* setup({ command: { check: { template: "Check validation" } } })
    const commands = yield* Command.Service
    const ready = yield* Latch.make()
    const release = yield* Latch.make()
    const get = commands.get
    const stub = spyOn(commands, "get").mockImplementation((name) =>
      name === "check" ? ready.open.pipe(Effect.andThen(release.await), Effect.andThen(get(name))) : get(name),
    )
    yield* Effect.addFinalizer(() => release.open.pipe(Effect.andThen(Effect.sync(() => stub.mockRestore()))))
    const pending = yield* run.prompt
      .command({ sessionID: run.session.id, command: "check", arguments: "" })
      .pipe(Effect.forkChild)
    yield* awaitWithTimeout(ready.await, "command did not reach lookup")
    yield* run.prompt.cancel(run.session.id)
    yield* run.llm.hang
    yield* run.command(objective)
    yield* run.wait(1)
    yield* release.open
    expect(Exit.hasInterrupts(yield* Fiber.await(pending))).toBe(true)
    expect(yield* run.metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: objective, active: true, status: "active" },
    })
    expect(yield* run.llm.hits).toHaveLength(1)
    yield* run.prompt.cancel(run.session.id)
  }),
)

for (const busy of [true, false]) {
  it.instance(
    busy ? "busy shell rejection preserves an active goal" : "an admitted shell disarms goal repetition",
    Effect.gen(function* () {
      const run = yield* setup()
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(gate.resolve))
      if (!busy) gate.resolve()
      yield* run.llm.push(shell(), reply().wait(gate.promise).text("Validation checked").stop(), reply().hang())
      yield* run.command(objective)
      yield* run.wait(2)
      if (!busy) yield* run.idle
      const base = KiloSessionPromptQueue.active(run.session.id)
      const before = yield* run.sessions.messages({ sessionID: run.session.id })
      const exit = yield* run.prompt
        .shell({ sessionID: run.session.id, agent: "code", command: "pwd" })
        .pipe(Effect.exit)
      if (busy) {
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof Session.BusyError).toBe(true)
        expect(yield* run.metadata).toMatchObject({
          ...retained,
          "kilo.goal": { text: objective, active: true, status: "active" },
        })
        expect(KiloSessionPromptQueue.active(run.session.id)).toBe(base)
        expect((yield* run.sessions.messages({ sessionID: run.session.id })).map((message) => message.info.id)).toEqual(
          before.map((message) => message.info.id),
        )
        expect((yield* run.status.get(run.session.id)).type).toBe("busy")
        gate.resolve()
        yield* run.wait(3)
        yield* run.prompt.cancel(run.session.id)
        return
      }
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit))
        expect(exit.value.parts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "tool", state: expect.objectContaining({ status: "completed" }) }),
          ]),
        )
      yield* run.paused
      yield* run.idle
      yield* Effect.sleep("5200 millis")
      expect(yield* run.llm.hits).toHaveLength(2)
    }),
    30_000,
  )
}

it.instance(
  "pauses after a non-retryable model error",
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
    expect(yield* metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: objective, active: false, status: "paused" },
    })
    const status = yield* control("")
    expect(status.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("paused") })]),
    )
    expect(yield* llm.hits).toHaveLength(0)
    yield* llm.hang
    yield* command("resume")
    yield* wait(1)
    const fork = yield* sessions.fork({ sessionID: session.id })
    expect(fork.metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: objective, active: false, status: "paused" },
    })
    expect((yield* sessions.get(fork.id)).metadata).toEqual(fork.metadata)
    expect(yield* metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: objective, active: true, status: "active" },
    })
    yield* control("")
    yield* control("pause")
    expect(yield* metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: objective, active: false, status: "paused" },
    })
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
  Effect.gen(function* () {
    const { llm, command, metadata, idle, wait } = yield* setup()
    const instance = yield* TestInstance
    const store = yield* InstanceStore.Service
    yield* llm.push(shell(), reply().text("Goal step complete").stop())
    yield* command(objective)
    yield* wait(2)
    yield* idle
    expect(yield* metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: objective, active: true, status: "active" },
    })
    yield* awaitWithTimeout(store.reload({ directory: instance.directory }), "goal prevented instance disposal")
    expect(yield* metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: objective, active: false, status: "paused" },
    })
    yield* Effect.sleep("5200 millis")
    expect(yield* llm.hits).toHaveLength(2)
  }),
  30_000,
)

for (const kind of ["archived", "reverted", "busy"] as const) {
  it.instance(
    `rejects goal start and resume on a ${kind} session without cancelling its turn`,
    Effect.gen(function* () {
      const run = yield* setup()
      yield* run.llm.hang
      yield* run.command(objective)
      yield* run.wait(1)
      const base = KiloSessionPromptQueue.active(run.session.id)
      if (!base) throw new Error("Goal turn did not start")
      if (kind === "archived") yield* run.sessions.setArchived({ sessionID: run.session.id, time: Date.now() })
      if (kind === "reverted")
        yield* run.sessions.setRevert({ sessionID: run.session.id, revert: { messageID: base }, summary: undefined })
      if (kind === "busy")
        yield* run.prompt.prompt({
          sessionID: run.session.id,
          noReply: true,
          parts: [{ type: "text", text: "Keep the goal paused" }],
        })
      const metadata = yield* run.metadata
      const before = yield* run.sessions.messages({ sessionID: run.session.id })
      for (const args of ["Replace the objective", "resume"]) {
        const exit = yield* run.command(args).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit))
          expect(String(Cause.squash(exit.cause))).toContain(
            kind === "busy" ? "Stop the current response" : "Restore this session",
          )
        expect(yield* run.metadata).toEqual(metadata)
        expect(KiloSessionPromptQueue.active(run.session.id)).toBe(base)
        expect((yield* run.status.get(run.session.id)).type).toBe("busy")
        expect((yield* run.sessions.messages({ sessionID: run.session.id })).map((message) => message.info.id)).toEqual(
          before.map((message) => message.info.id),
        )
        expect(yield* run.llm.hits).toHaveLength(1)
      }
      yield* run.prompt.cancel(run.session.id)
    }),
  )
}

it.instance(
  "rechecks descendant attention after goal replacement cancellation",
  Effect.gen(function* () {
    const run = yield* setup()
    const state = yield* SessionRunState.Service
    const question = yield* Question.Service
    const child = yield* run.sessions.create({ parentID: run.session.id })
    yield* run.llm.hang
    yield* run.command(objective)
    yield* run.wait(1)
    const ready = yield* Latch.make()
    const release = yield* Latch.make()
    const cancel = state.cancel
    const stub = spyOn(state, "cancel").mockImplementation((id, opts) =>
      id === run.session.id
        ? cancel(id, opts).pipe(Effect.andThen(ready.open), Effect.andThen(release.await))
        : cancel(id, opts),
    )
    yield* Effect.addFinalizer(() => release.open.pipe(Effect.andThen(Effect.sync(() => stub.mockRestore()))))
    const replacement = yield* run.command("Replace the objective").pipe(Effect.forkChild)
    yield* awaitWithTimeout(ready.await, "replacement did not finish cancelling its old turn")
    const pending = yield* question
      .ask({
        sessionID: child.id,
        questions: [
          { header: "Validation", question: "Continue?", options: [{ label: "Yes", description: "Continue" }] },
        ],
      })
      .pipe(Effect.forkChild)
    const request = yield* pollWithTimeout(
      question.list().pipe(Effect.map((items) => items.find((item) => item.sessionID === child.id))),
      "child question did not arrive",
    )
    const before = yield* run.sessions.messages({ sessionID: run.session.id })
    yield* release.open
    const exit = yield* awaitWithTimeout(Fiber.await(replacement), "replacement did not recheck admission")
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit))
      expect(String(Cause.squash(exit.cause))).toContain("Resolve pending questions and permissions")
    expect(yield* run.metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: objective, active: false, status: "paused" },
    })
    expect(yield* run.sessions.messages({ sessionID: run.session.id })).toEqual(before)
    expect(yield* question.list()).toEqual([request])
    expect(yield* run.llm.hits).toHaveLength(1)
    yield* question.reject(request.id)
    expect(Exit.isFailure(yield* Fiber.await(pending))).toBe(true)
  }),
)

it.instance(
  "does not rearm a pending goal start after clear",
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
  Effect.gen(function* () {
    const { llm, prompt, session, command, metadata, wait } = yield* setup()
    yield* llm.hang
    yield* command(objective)
    yield* wait(1)
    yield* llm.hang
    yield* command("Review the validation results")
    yield* wait(2)
    expect(yield* metadata).toMatchObject({
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
    expect(yield* metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: "Review the validation results", active: false },
    })
    yield* Effect.sleep("5200 millis")
    expect(yield* llm.hits).toHaveLength(2)
  }),
  30_000,
)

for (const stage of ["model", "acknowledgement"] as const) {
  it.instance(
    `cancels goal ${stage} intake before a newer Ask input`,
    Effect.gen(function* () {
      const run = yield* setup()
      const agents = yield* Agent.Service
      const ready = yield* Latch.make()
      const release = yield* Latch.make()
      const get = agents.get
      const update = run.sessions.updateMessage
      const stub =
        stage === "model"
          ? spyOn(agents, "get").mockImplementationOnce((name) =>
              ready.open.pipe(Effect.andThen(release.await), Effect.andThen(get(name))),
            )
          : spyOn(run.sessions, "updateMessage").mockImplementation((info) =>
              info.role === "assistant"
                ? ready.open.pipe(Effect.andThen(release.await), Effect.andThen(update(info)))
                : update(info),
            )
      yield* Effect.addFinalizer(() => release.open.pipe(Effect.andThen(Effect.sync(() => stub.mockRestore()))))
      const id = MessageID.ascending()
      const start = yield* run.command(objective, id).pipe(Effect.forkChild)
      yield* awaitWithTimeout(ready.await, "goal intake did not reach its write gate")
      stub.mockRestore()
      yield* awaitWithTimeout(run.prompt.cancel(run.session.id, "session"), "Stop waited for pending goal intake")
      const human = yield* run.prompt.prompt({
        sessionID: run.session.id,
        agent: "ask",
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("selected-model") },
        noReply: true,
        parts: [{ type: "text", text: "Explain without making changes" }],
      })
      const before = yield* run.sessions.messages({ sessionID: run.session.id })
      yield* release.open
      expect(Exit.hasInterrupts(yield* Fiber.await(start))).toBe(true)
      expect(yield* run.sessions.messages({ sessionID: run.session.id })).toEqual(before)
      expect(before.at(-1)?.info.id).toBe(human.info.id)
      expect(yield* run.sessions.get(run.session.id)).toMatchObject({
        agent: "ask",
        model: { providerID: "test", id: "selected-model" },
      })
      if (stage === "model") expect(before.some((message) => message.info.id === id)).toBe(false)
      expect(yield* run.llm.hits).toHaveLength(0)
    }),
  )
}

it.instance(
  "does not let an older Pause restore Clear or pause a newer start",
  Effect.gen(function* () {
    const run = yield* setup()
    const drain = yield* SessionDrain.Service
    const state = yield* SessionRunState.Service
    const child = yield* run.sessions.create({ parentID: run.session.id })
    yield* drain.link(child.id, run.session.id)
    const finish = yield* drain.hold(child.id)
    yield* Effect.addFinalizer(() => Effect.sync(finish))
    yield* run.command(objective)
    const ready = yield* Latch.make()
    const release = yield* Latch.make()
    const cancel = state.cancel
    const stub = spyOn(state, "cancel").mockImplementationOnce((...args) =>
      ready.open.pipe(Effect.andThen(release.await), Effect.andThen(cancel(...args))),
    )
    yield* Effect.addFinalizer(() => release.open.pipe(Effect.andThen(Effect.sync(() => stub.mockRestore()))))
    const pause = yield* run.command("pause").pipe(Effect.forkChild)
    yield* awaitWithTimeout(ready.await, "Pause did not reach cancellation")
    yield* run.command("clear")
    expect(yield* run.metadata).toEqual(retained)
    const next = yield* run.command("Continue the newer objective").pipe(Effect.forkChild({ startImmediately: true }))
    yield* release.open
    expect(Exit.hasInterrupts(yield* Fiber.await(pause))).toBe(true)
    yield* awaitWithTimeout(Fiber.join(next), "newer start did not finish after cancellation")
    expect(yield* run.metadata).toMatchObject({
      ...retained,
      "kilo.goal": { text: "Continue the newer objective", active: true },
    })
    yield* run.prompt.cancel(run.session.id, "session")
    expect(yield* run.llm.hits).toHaveLength(0)
  }),
)

it.instance(
  "clears an in-flight goal metadata commit before the stale writer resumes",
  Effect.gen(function* () {
    const run = yield* setup()
    const ready = yield* Latch.make()
    const release = yield* Latch.make()
    const update = run.sessions.setMetadata
    const stub = spyOn(run.sessions, "setMetadata").mockImplementationOnce((input) =>
      ready.open.pipe(Effect.andThen(release.await), Effect.andThen(update(input))),
    )
    yield* Effect.addFinalizer(() => release.open.pipe(Effect.andThen(Effect.sync(() => stub.mockRestore()))))
    const start = yield* run.command(objective).pipe(Effect.forkChild)
    yield* awaitWithTimeout(ready.await, "goal start did not reach metadata commit")
    yield* awaitWithTimeout(run.command("clear"), "Clear waited for stale goal metadata")
    expect(yield* run.metadata).toEqual(retained)
    yield* release.open
    expect(Exit.hasInterrupts(yield* Fiber.await(start))).toBe(true)
    expect(yield* run.metadata).toEqual(retained)
    expect(yield* run.sessions.messages({ sessionID: run.session.id })).toEqual([])
    expect(yield* run.llm.hits).toHaveLength(0)
  }),
)

it.instance(
  "preserves unrelated metadata changed during goal preflight",
  Effect.gen(function* () {
    const run = yield* setup()
    const permission = yield* Permission.Service
    const ready = yield* Latch.make()
    const release = yield* Latch.make()
    const list = permission.list
    const stub = spyOn(permission, "list").mockImplementationOnce(() =>
      ready.open.pipe(Effect.andThen(release.await), Effect.andThen(list())),
    )
    yield* Effect.addFinalizer(() => release.open.pipe(Effect.andThen(Effect.sync(() => stub.mockRestore()))))
    yield* run.llm.hang
    const start = yield* run.command(objective).pipe(Effect.forkChild)
    yield* awaitWithTimeout(ready.await, "goal preflight did not pause")
    const metadata = { ...retained, review: { branch: "updated" }, extra: "preserved" }
    yield* run.sessions.setMetadata({ sessionID: run.session.id, metadata })
    yield* release.open
    yield* Fiber.join(start)
    expect(yield* run.metadata).toMatchObject({
      ...metadata,
      "kilo.goal": { text: objective, active: true, status: "active" },
    })
    yield* run.prompt.cancel(run.session.id)
  }),
)

it.instance(
  "releases stopped goal drain waiters without cancelling background child work",
  Effect.gen(function* () {
    const run = yield* setup()
    const drain = yield* SessionDrain.Service
    const jobs = yield* BackgroundJob.Service
    const child = yield* run.sessions.create({ parentID: run.session.id })
    yield* drain.link(child.id, run.session.id)
    const ready = yield* Latch.make()
    yield* jobs.start({
      id: child.id,
      type: "task",
      metadata: { parentSessionId: run.session.id, sessionId: child.id, background: true },
      run: drain.track(child.id, ready.open.pipe(Effect.andThen(Effect.never))),
    })
    yield* awaitWithTimeout(ready.await, "background child did not start")
    const wait = drain.wait
    let waiting = 0
    const stub = spyOn(drain, "wait").mockImplementation((id) =>
      id !== run.session.id
        ? wait(id)
        : Effect.acquireUseRelease(
            Effect.sync(() => {
              waiting++
            }),
            () => wait(id),
            () =>
              Effect.sync(() => {
                waiting--
              }),
          ),
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => stub.mockRestore()))
    for (const args of [objective, "resume", "resume"]) {
      yield* run.command(args)
      yield* pollWithTimeout(
        Effect.sync(() => (waiting === 1 ? true : undefined)),
        "goal did not wait for its child",
      )
      yield* run.prompt.cancel(run.session.id, "session")
      yield* pollWithTimeout(
        Effect.sync(() => (waiting === 0 ? true : undefined)),
        "paused goal retained a drain waiter",
      )
      expect((yield* jobs.get(child.id))?.status).toBe("running")
    }
    yield* run.command("clear")
    expect(waiting).toBe(0)
    expect(yield* run.metadata).toEqual(retained)
    expect((yield* jobs.get(child.id))?.status).toBe("running")
    yield* jobs.cancel(child.id)
    yield* drain.wait(run.session.id)
    expect(yield* run.llm.hits).toHaveLength(0)
  }),
)

for (const text of ["No further action is needed.", "Run gh auth login before I can continue."]) {
  it.instance(
    `pauses a text-only goal response: ${text}`,
    Effect.gen(function* () {
      const run = yield* setup()
      yield* run.llm.text(text)
      yield* run.command(objective)
      yield* run.paused
      const last = (yield* run.sessions.messages({ sessionID: run.session.id })).at(-1)
      expect(last?.info).toMatchObject({ role: "assistant", finish: "stop" })
      yield* Effect.sleep("5200 millis")
      expect(yield* run.llm.hits).toHaveLength(1)
    }),
    30_000,
  )
}

for (const child of [false, true]) {
  it.instance(
    `does not count an independent ${child ? "child" : "session"}'s successful actions as goal progress`,
    Effect.gen(function* () {
      const run = yield* setup()
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(gate.resolve))
      yield* run.llm.hold("No action in this goal", gate.promise)
      yield* run.command(objective)
      yield* run.wait(1)
      const other = yield* run.sessions.create({
        title: "Unrelated work",
        parentID: child ? run.session.id : undefined,
      })
      yield* run.llm.push(shell(), reply().text("Other work finished").stop())
      yield* run.prompt.prompt({ sessionID: other.id, parts: [{ type: "text", text: "Inspect the workspace" }] })
      gate.resolve()
      yield* run.paused
      expect(yield* run.llm.hits).toHaveLength(3)
    }),
    30_000,
  )
}

for (const kind of ["exit", "tool", "recovered"] as const) {
  it.instance(
    `evaluates earlier ${kind} failures across the whole goal turn`,
    Effect.gen(function* () {
      const run = yield* setup()
      yield* run.sessions.setPermission({
        sessionID: run.session.id,
        permission: [{ permission: "bash", pattern: "*", action: "allow" }],
      })
      const steps =
        kind === "tool"
          ? [reply().tool("read", { filePath: "missing-goal-file.txt" })]
          : kind === "exit"
            ? [shell(), shell("exit 1")]
            : [shell("exit 1"), shell()]
      yield* run.llm.push(...steps, reply().text("Turn finished").stop(), reply().hang())
      yield* run.command(objective)
      yield* run.wait(steps.length + 1)
      yield* run.idle
      const messages = yield* run.sessions.messages({ sessionID: run.session.id })
      expect(messages.at(-1)?.parts.some((part) => part.type === "tool")).toBe(false)
      expect(
        messages
          .flatMap((message) => message.parts)
          .some(
            (part) =>
              part.type === "tool" &&
              (part.state.status === "error" || (part.state.status === "completed" && part.state.metadata.exit === 1)),
          ),
      ).toBe(true)
      if (kind === "recovered") {
        yield* run.wait(steps.length + 2)
        yield* run.prompt.cancel(run.session.id)
        return
      }
      yield* run.paused
      yield* Effect.sleep("5200 millis")
      expect(yield* run.llm.hits).toHaveLength(steps.length + 1)
    }),
    30_000,
  )
}

it.instance(
  "does not clear a rejected permission after an unrelated successful action",
  Effect.gen(function* () {
    const run = yield* setup({ experimental: { continue_loop_on_deny: true } })
    const permission = yield* Permission.Service
    yield* run.sessions.setPermission({
      sessionID: run.session.id,
      permission: [{ permission: "bash", pattern: "*", action: "ask" }],
    })
    yield* run.llm.push(
      shell(),
      reply().tool("read", { filePath: "opencode.json" }),
      reply().text("Unrelated read completed").stop(),
    )
    yield* run.command(objective)
    const pending = yield* pollWithTimeout(
      permission.list().pipe(Effect.map((items) => items.find((item) => item.sessionID === run.session.id))),
      "permission was not requested",
    )
    yield* permission.reply({ requestID: pending.id, reply: "reject" })
    yield* run.wait(3)
    yield* run.paused
    const last = (yield* run.sessions.messages({ sessionID: run.session.id })).at(-1)
    expect(last?.parts).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Unrelated read completed" })]))
    expect(yield* run.llm.hits).toHaveLength(3)
  }),
  30_000,
)

for (const kind of ["replay", "continue", "stop"] as const) {
  it.instance(
    `preserves goal ownership and Stop fencing through compaction ${kind}`,
    Effect.gen(function* () {
      const run = yield* setup({
        compaction: { auto: true, threshold_percent: 70, tail_turns: 0, preserve_recent_tokens: 0 },
      })
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(gate.resolve))
      if (kind !== "continue")
        yield* run.prompt.prompt({
          sessionID: run.session.id,
          noReply: true,
          parts: [{ type: "text", text: "x".repeat(240_000) }],
        })
      yield* run.llm.push(
        ...(kind === "continue" ? [shell().usage({ input: 95000, output: 10 })] : []),
        reply().wait(gate.promise).text("The goal is to improve the validation workflow.").stop(),
        shell(),
        reply().text("Validation checked").stop(),
        reply().hang(),
      )
      yield* run.command(objective)
      yield* run.wait(kind === "continue" ? 2 : 1)
      if (kind === "stop") {
        yield* run.prompt.cancel(run.session.id)
        gate.resolve()
        yield* run.paused
        yield* Effect.sleep("5200 millis")
        expect(yield* run.llm.hits).toHaveLength(1)
        return
      }
      gate.resolve()
      const count = kind === "continue" ? 4 : 3
      yield* run.wait(count)
      yield* run.idle
      const messages = yield* run.sessions.messages({ sessionID: run.session.id })
      expect(messages.some((message) => message.info.role === "assistant" && message.info.summary)).toBe(true)
      const original = messages.find((message) =>
        message.parts.some(
          (part) =>
            part.type === "text" &&
            part.synthetic &&
            part.text.startsWith("Continue working toward this session goal:"),
        ),
      )
      const last = messages.at(-1)?.info
      expect(last?.role === "assistant" && last.parentID).not.toBe(original?.info.id)
      expect(yield* run.metadata).toMatchObject({
        ...retained,
        "kilo.goal": { text: objective, active: true, status: "active" },
      })
      yield* run.wait(count + 1)
      expect(JSON.stringify((yield* run.llm.hits).at(-1)?.body)).toContain(objective)
      yield* run.prompt.cancel(run.session.id)
    }),
    30_000,
  )
}

for (const failed of [true, false]) {
  it.instance(
    `${failed ? "pauses terminal" : "continues recovered"} child compaction errors after successful tools`,
    Effect.gen(function* () {
      const run = yield* setup({
        agent: { general: { model: "test/selected-model" } },
        compaction: { auto: true, threshold_percent: 70, tail_turns: 0, preserve_recent_tokens: 0 },
      })
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(gate.resolve))
      const overflow = httpError(400, {
        error: { message: "maximum context length exceeded", code: "context_length_exceeded" },
      })
      yield* run.llm.pushMatch(
        ({ body }) => body.model === "selected-model",
        shell().wait(gate.promise).usage({ input: 95000, output: 10 }).stop(),
        overflow,
        ...(failed
          ? [overflow]
          : [
              reply().text("Chunk summary").stop(),
              reply().text("Recovered summary").stop(),
              shell(),
              reply().text("Child finished").stop(),
            ]),
      )
      yield* run.llm.pushMatch(
        ({ body }) => body.model === "test-model",
        reply().tool("task", {
          description: "Check validation",
          prompt: "Inspect the workspace",
          subagent_type: "general",
          background: true,
        }),
        reply().text("Waiting for the child").stop(),
        reply().text("Child result received").stop(),
        reply().hang(),
      )
      yield* run.command(objective)
      yield* run.wait(3)
      yield* run.idle
      gate.resolve()
      const count = failed ? 6 : 9
      yield* run.wait(count)
      yield* run.idle
      const child = (yield* run.sessions.children(run.session.id)).at(0)
      if (!child) throw new Error("Goal did not create a child")
      const messages = yield* run.sessions.messages({ sessionID: child.id })
      expect(
        messages.some(
          (message) =>
            message.info.role === "assistant" &&
            message.info.finish === "stop" &&
            message.parts.some(
              (part) => part.type === "tool" && part.state.status === "completed" && part.state.metadata.exit === 0,
            ),
        ),
      ).toBe(true)
      const summary = messages.findLast((message) => message.info.role === "assistant" && message.info.summary)?.info
      if (summary?.role !== "assistant") throw new Error("Child has no compaction outcome")
      expect(summary.finish).toBe(failed ? "error" : "stop")
      expect(summary.error?.name).toBe(failed ? "ContextOverflowError" : undefined)
      if (!failed) {
        yield* run.wait(count + 1)
        yield* run.prompt.cancel(run.session.id)
        return
      }
      yield* run.paused
      yield* Effect.sleep("5200 millis")
      expect(yield* run.llm.hits).toHaveLength(count)
    }),
    30_000,
  )
}

for (const kind of ["success", "delivery-error", "independent-child"] as const) {
  it.instance(
    `evaluates delayed background ${kind} before continuing`,
    Effect.gen(function* () {
      const run = yield* setup({ permission: { bash: "allow" }, agent: { general: { model: "test/selected-model" } } })
      const gate = Promise.withResolvers<void>()
      const finish = Promise.withResolvers<void>()
      if (kind !== "independent-child") finish.resolve()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          gate.resolve()
          finish.resolve()
        }),
      )
      yield* run.llm.pushMatch(
        ({ body }) => body.model === "selected-model",
        shell(kind === "independent-child" ? "exit 1" : "pwd"),
        reply().wait(gate.promise).text("Child validation finished").stop(),
      )
      yield* run.llm.pushMatch(
        ({ body }) => body.model === "test-model",
        reply().tool("task", {
          description: "Check validation",
          prompt: "Inspect the workspace",
          subagent_type: "general",
          background: true,
        }),
        reply().text("Waiting for the child").stop(),
        ...(kind === "delivery-error"
          ? [httpError(400, { error: { message: "Delivery failed", type: "invalid_request_error" } })]
          : [reply().wait(finish.promise).text("Child result received").stop(), reply().hang()]),
      )
      yield* run.command(objective)
      yield* run.wait(4)
      yield* run.idle
      expect(yield* run.metadata).toMatchObject({
        ...retained,
        "kilo.goal": { text: objective, active: true, status: "active" },
      })
      const delegated = (yield* run.sessions.children(run.session.id)).at(0)
      if (!delegated) throw new Error("Goal did not create a child")
      expect(GoalPolicy.available(delegated.id, "question")).toBe(false)
      expect(GoalPolicy.available(delegated.id, "plan_exit")).toBe(true)
      gate.resolve()
      if (kind === "success") {
        yield* run.wait(6)
        yield* run.prompt.cancel(run.session.id)
        return
      }
      if (kind === "independent-child") {
        yield* run.wait(5)
        const child = (yield* run.sessions.children(run.session.id)).at(0)
        if (!child) throw new Error("Goal did not create a child")
        const parts = (yield* run.sessions.messages({ sessionID: child.id })).flatMap((message) => message.parts)
        expect(
          parts.some(
            (part) => part.type === "tool" && part.state.status === "completed" && part.state.metadata.exit === 1,
          ),
        ).toBe(true)
        yield* run.llm.pushMatch(
          ({ body }) => body.model === "selected-model",
          shell(),
          reply().text("Unrelated child work finished").stop(),
        )
        yield* run.prompt.prompt({ sessionID: child.id, parts: [{ type: "text", text: "Inspect unrelated work" }] })
        finish.resolve()
      }
      yield* run.paused
      if (kind === "delivery-error") {
        const last = (yield* run.sessions.messages({ sessionID: run.session.id })).at(-1)
        expect(last?.info.role === "assistant" && last.info.error).toBeTruthy()
      }
      yield* Effect.sleep("5200 millis")
      expect(yield* run.llm.hits).toHaveLength(kind === "independent-child" ? 7 : 5)
    }),
    30_000,
  )
}

for (const override of [
  { template: "Custom workflow: $ARGUMENTS", description: "Run a custom workflow" },
  { agent: "ask", model: "test/selected-model", variant: "focused" },
]) {
  it.instance(
    `rejects reserved goal ${"template" in override ? "templates" : "execution overrides"} in listing and dispatch`,
    Effect.gen(function* () {
      const run = yield* setup({ command: { goal: override } })
      const commands = yield* Command.Service
      for (const effect of [commands.list().pipe(Effect.asVoid), run.command(objective).pipe(Effect.asVoid)]) {
        const exit = yield* Effect.exit(effect)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(String(Cause.squash(exit.cause))).toContain("/goal command is reserved")
      }
      expect(yield* run.metadata).toEqual(retained)
      expect(yield* run.sessions.messages({ sessionID: run.session.id })).toEqual([])
      expect(yield* run.llm.hits).toHaveLength(0)
    }),
  )
}

test("distinguishes successful actions from failed work, bookkeeping, and hard blockers", () => {
  const part = {
    id: PartID.ascending(),
    messageID: MessageID.ascending(),
    sessionID: SessionID.create(),
    type: "tool",
    tool: "read",
    callID: "action",
    state: {
      status: "completed",
      input: {},
      output: "Result",
      title: "Action",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  } satisfies MessageV2.ToolPart
  expect(Goal.action(part)).toBe("success")
  for (const tool of ["suggest", "question", "todowrite", "board_post", "board_read"])
    expect(Goal.action({ ...part, tool })).toBe("none")
  expect(Goal.action({ ...part, tool: "plan_exit" })).toBe("blocked")
  for (const metadata of [{ dismissed: true }, { interrupted: true }, { approval: { rule: { action: "deny" } } }])
    expect(Goal.action({ ...part, state: { ...part.state, metadata } })).toBe("blocked")
  for (const exit of [1, null, undefined])
    expect(Goal.action({ ...part, tool: "bash", state: { ...part.state, metadata: { exit } } })).toBe("failed")
  expect(Goal.action({ ...part, tool: "bash", state: { ...part.state, metadata: { exit: 0 } } })).toBe("success")
  expect(Goal.action({ ...part, tool: "task", state: { ...part.state, metadata: { background: true } } })).toBe("none")
})
