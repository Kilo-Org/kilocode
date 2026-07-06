import { describe, expect, test } from "bun:test"
import { AsyncResource } from "async_hooks"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { Identifier } from "../../src/id/id"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/kilocode/instance"
import { provideTestInstance } from "../fixture/fixture"
import { PlanFollowup } from "../../src/kilocode/plan-followup"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { makeRuntime } from "../../src/effect/run-service"
import { Question } from "../../src/question"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const sessions = {
  create: (input?: Parameters<Session.Interface["create"]>[0]) =>
    Effect.runPromise(Session.Service.use((svc) => svc.create(input)).pipe(Effect.provide(Session.defaultLayer))),
  get: (id: SessionID) =>
    Effect.runPromise(Session.Service.use((svc) => svc.get(id)).pipe(Effect.provide(Session.defaultLayer))),
  messages: (input: Parameters<Session.Interface["messages"]>[0]) =>
    Effect.runPromise(Session.Service.use((svc) => svc.messages(input)).pipe(Effect.provide(Session.defaultLayer))),
  updateMessage: <T extends MessageV2.Info>(msg: T) =>
    Effect.runPromise(Session.Service.use((svc) => svc.updateMessage(msg)).pipe(Effect.provide(Session.defaultLayer))),
  updatePart: <T extends MessageV2.Part>(part: T) =>
    Effect.runPromise(Session.Service.use((svc) => svc.updatePart(part)).pipe(Effect.provide(Session.defaultLayer))),
}

const runtime = makeRuntime(Question.Service, Question.defaultLayer)
const questions = {
  ask(input: Parameters<Question.Interface["ask"]>[0]) {
    return runtime.runPromise((svc) => svc.ask(input))
  },
  list() {
    return runtime.runPromise((svc) => svc.list())
  },
  reject(requestID: Parameters<Question.Interface["reject"]>[0]) {
    return runtime.runPromise((svc) => svc.reject(requestID))
  },
  reply(input: Parameters<Question.Interface["reply"]>[0]) {
    return runtime.runPromise((svc) => svc.reply(input))
  },
}

const model = {
  providerID: ProviderID.make("openai"),
  modelID: ModelID.make("gpt-4"),
}

async function withInstance(fn: () => Promise<void>) {
  await using tmp = await tmpdir({ git: true })
  await provideTestInstance({ directory: tmp.path, fn })
}

async function seed(input: {
  text?: string
  agent?: string
  tools?: Array<{ tool: string; input: Record<string, unknown>; output: string }>
  finish?: string
}) {
  const session = await sessions.create({})
  const user = await sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: session.id,
    time: { created: Date.now() },
    agent: input.agent ?? "plan",
    model,
  })
  await sessions.updatePart({
    id: PartID.ascending(),
    messageID: user.id,
    sessionID: session.id,
    type: "text",
    text: "Create a plan",
  })

  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: session.id,
    time: { created: Date.now() },
    parentID: user.id,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: input.agent ?? "plan",
    agent: input.agent ?? "plan",
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    finish: (input.finish as MessageV2.Assistant["finish"]) ?? "end_turn",
  }
  await sessions.updateMessage(assistant)
  if (input.text !== undefined) {
    await sessions.updatePart({
      id: PartID.ascending(),
      messageID: assistant.id,
      sessionID: session.id,
      type: "text",
      text: input.text,
    })
  }

  for (const t of input.tools ?? []) {
    await sessions.updatePart({
      id: PartID.ascending(),
      messageID: assistant.id,
      sessionID: session.id,
      type: "tool",
      callID: Identifier.ascending("tool"),
      tool: t.tool,
      state: {
        status: "completed",
        input: t.input,
        output: t.output,
        title: t.tool,
        metadata: {},
        time: { start: Date.now(), end: Date.now() },
      },
    } satisfies MessageV2.ToolPart)
  }

  const messages = await sessions.messages({ sessionID: session.id })
  return { sessionID: session.id, messages }
}

async function waitQuestion(sessionID: string) {
  for (let i = 0; i < 50; i++) {
    const list = await questions.list()
    const question = list.find((item) => item.sessionID === sessionID)
    if (question) return question
    await Bun.sleep(10)
  }
}

function userMessage(input: { sessionID: SessionID; agent: string; text: string }) {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "user",
      sessionID: input.sessionID,
      time: { created: Date.now() },
      agent: input.agent,
      model,
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text: input.text,
      },
    ],
  } satisfies MessageV2.WithParts
}

function content(message: MessageV2.WithParts) {
  return message.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

describe("plan_exit detection", () => {
  test("PlanFollowup.ask triggers when plan_exit tool is present", () =>
    withInstance(async () => {
      const seeded = await seed({
        text: "Here is the plan",
        tools: [
          {
            tool: "plan_exit",
            input: {},
            output: "Plan is ready at .kilo/plans/plan.md. Ending planning turn.",
          },
        ],
      })
      expect(SessionPrompt.shouldAskPlanFollowup({ messages: seeded.messages, abort: AbortSignal.any([]) })).toBe(true)

      const pending = PlanFollowup.ask({
        question: questions,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const question = await waitQuestion(seeded.sessionID)
      expect(question).toBeDefined()
      if (!question) return
      expect(question.questions[0].header).toBe("Implement")
      await questions.reject(question.id)
      await expect(pending).resolves.toBe("break")
    }))

  test("KiloSessionPrompt resolves plan follow-up through the supplied question service", () =>
    withInstance(async () => {
      const seeded = await seed({
        text: "Here is the plan",
        tools: [
          {
            tool: "plan_exit",
            input: {},
            output: "Plan is ready. Ending planning turn.",
          },
        ],
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const question = yield* Question.Service
          const pending = KiloSessionPrompt.askPlanFollowup({
            sessionID: seeded.sessionID,
            messages: seeded.messages,
            abort: AbortSignal.any([]),
            question,
          })
          const item = yield* Effect.gen(function* () {
            for (let i = 0; i < 50; i++) {
              const request = (yield* question.list()).find((entry) => entry.sessionID === seeded.sessionID)
              if (request) return request
              yield* Effect.sleep("10 millis")
            }
            throw new Error("timed out waiting for listener-local plan follow-up question")
          })
          yield* question.reply({ requestID: item.id, answers: [[PlanFollowup.ANSWER_CONTINUE]] })
          return yield* Effect.promise(() => pending)
        }).pipe(Effect.provide(Question.defaultLayer)),
      )

      expect(result).toBe("continue")
    }))

  test("KiloSessionPrompt cleans listener-local plan follow-up when aborted outside instance context", () => {
    const outside = new AsyncResource("plan-followup-abort-test")
    return withInstance(async () => {
      const seeded = await seed({
        text: "Here is the plan",
        tools: [
          {
            tool: "plan_exit",
            input: {},
            output: "Plan is ready. Ending planning turn.",
          },
        ],
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const question = yield* Question.Service
          const abort = new AbortController()
          const pending = KiloSessionPrompt.askPlanFollowup({
            sessionID: seeded.sessionID,
            messages: seeded.messages,
            abort: abort.signal,
            question,
          })
          yield* Effect.gen(function* () {
            for (let i = 0; i < 50; i++) {
              const request = (yield* question.list()).find((entry) => entry.sessionID === seeded.sessionID)
              if (request) return request
              yield* Effect.sleep("10 millis")
            }
            throw new Error("timed out waiting for listener-local plan follow-up question")
          })
          outside.runInAsyncScope(() => abort.abort())
          const action = yield* Effect.promise(() =>
            Promise.race([pending, Bun.sleep(1_000).then(() => "timeout" as const)]),
          )
          expect(yield* question.list()).toEqual([])
          return action
        }).pipe(Effect.provide(Question.defaultLayer)),
      )

      expect(result).toBe("break")
    }).finally(() => outside.emitDestroy())
  })

  test("PlanFollowup skips prompt when aborted while resolving the plan", () =>
    withInstance(async () => {
      const seeded = await seed({
        text: "Here is the plan",
        tools: [
          {
            tool: "plan_exit",
            input: {},
            output: "Plan is ready. Ending planning turn.",
          },
        ],
      })
      const abort = new AbortController()
      const pending = PlanFollowup.ask({
        question: questions,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: abort.signal,
      })
      abort.abort()

      const result = await Promise.race([pending, Bun.sleep(1_000).then(() => "timeout" as const)])
      const list = () => questions.list().then((qs) => qs.filter((q) => q.sessionID === seeded.sessionID))
      try {
        expect(result).toBe("break")
        expect(await list()).toEqual([])
      } finally {
        for (const item of await list()) {
          await questions.reject(item.id)
        }
      }
    }))

  test("JetBrains client enables plan follow-up with custom answer", () =>
    withInstance(async () => {
      const prev = process.env.KILO_CLIENT
      try {
        process.env.KILO_CLIENT = "jetbrains"
        const seeded = await seed({
          text: "Here is the plan",
          tools: [
            {
              tool: "plan_exit",
              input: {},
              output: "Plan is ready. Ending planning turn.",
            },
          ],
        })

        expect(SessionPrompt.shouldAskPlanFollowup({ messages: seeded.messages, abort: AbortSignal.any([]) })).toBe(
          true,
        )

        const pending = PlanFollowup.ask({
          question: questions,
          sessionID: seeded.sessionID,
          messages: seeded.messages,
          abort: AbortSignal.any([]),
        })

        const question = await waitQuestion(seeded.sessionID)
        expect(question).toBeDefined()
        if (!question) return
        expect(question.questions[0].question).toBe("Ready to implement?")
        expect(question.questions[0].header).toBe("Implement")
        expect(question.questions[0].custom).toBe(true)
        expect(question.questions[0].options.map((item) => item.label)).toEqual([
          PlanFollowup.ANSWER_NEW_SESSION,
          PlanFollowup.ANSWER_CONTINUE,
          PlanFollowup.ANSWER_KEEP_REFINING,
        ])
        expect(question.questions[0].options.find((item) => item.label === PlanFollowup.ANSWER_CONTINUE)?.mode).toBe(
          "code",
        )
        expect(
          question.questions[0].options.find((item) => item.label === PlanFollowup.ANSWER_KEEP_REFINING)?.mode,
        ).toBe("plan")
        await questions.reject(question.id)
        await expect(pending).resolves.toBe("break")
      } finally {
        if (prev === undefined) delete process.env.KILO_CLIENT
        else process.env.KILO_CLIENT = prev
      }
    }))

  test("PlanFollowup.ask triggers and continue works with plan_exit", () =>
    withInstance(async () => {
      const seeded = await seed({
        text: "Here is the plan",
        tools: [
          {
            tool: "plan_exit",
            input: {},
            output: "Plan is ready. Ending planning turn.",
          },
        ],
      })

      const pending = PlanFollowup.ask({
        question: questions,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const question = await waitQuestion(seeded.sessionID)
      expect(question).toBeDefined()
      if (!question) return
      await questions.reply({
        requestID: question.id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })

      await expect(pending).resolves.toBe("continue")

      const messages = await sessions.messages({ sessionID: seeded.sessionID })
      const user = messages
        .slice()
        .reverse()
        .find((m) => m.info.role === "user")
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") return
      expect(user.info.agent).toBe("code")
    }))

  test("plan agent completion without plan_exit does NOT trigger PlanFollowup", () =>
    withInstance(async () => {
      const seeded = await seed({
        text: "Here is a partial plan, I have questions",
      })
      expect(SessionPrompt.shouldAskPlanFollowup({ messages: seeded.messages, abort: AbortSignal.any([]) })).toBe(false)
      const list = await questions.list()
      expect(list).toHaveLength(0)
    }))

  test("plan_exit with non-completed status does NOT trigger", () =>
    withInstance(async () => {
      const session = await sessions.create({})
      const user = await sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: session.id,
        time: { created: Date.now() },
        agent: "plan",
        model,
      })
      await sessions.updatePart({
        id: PartID.ascending(),
        messageID: user.id,
        sessionID: session.id,
        type: "text",
        text: "Create a plan",
      })

      const assistant: MessageV2.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        sessionID: session.id,
        time: { created: Date.now() },
        parentID: user.id,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: "plan",
        agent: "plan",
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: {
          total: 0,
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        finish: "end_turn",
      }
      await sessions.updateMessage(assistant)
      await sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID: session.id,
        type: "text",
        text: "Here is the plan",
      })
      await sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID: session.id,
        type: "tool",
        callID: Identifier.ascending("tool"),
        tool: "plan_exit",
        state: {
          status: "error",
          error: "Something went wrong",
          time: { start: Date.now(), end: Date.now() },
          metadata: {},
          input: {},
        },
      } satisfies MessageV2.ToolPart)

      const messages = await sessions.messages({ sessionID: session.id })

      // Verify the tool part IS present but errored (not completed)
      const toolPart = messages.flatMap((msg) => msg.parts).find((p) => p.type === "tool" && p.tool === "plan_exit")
      expect(toolPart).toBeDefined()
      expect(toolPart!.type === "tool" && toolPart!.state.status).toBe("error")

      // Use the shared predicate — errored plan_exit should not trigger
      expect(SessionPrompt.shouldAskPlanFollowup({ messages, abort: AbortSignal.any([]) })).toBe(false)

      // Confirm no questions were posted
      const list = await questions.list()
      expect(list).toHaveLength(0)
    }))

  test("plan_exit on earlier assistant message triggers when later message has text only", () =>
    withInstance(async () => {
      const session = await sessions.create({})
      // Use explicit timestamps to ensure deterministic message ordering
      const now = Date.now()
      const user = await sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: session.id,
        time: { created: now },
        agent: "plan",
        model,
      })
      await sessions.updatePart({
        id: PartID.ascending(),
        messageID: user.id,
        sessionID: session.id,
        type: "text",
        text: "Create a plan",
      })

      // First assistant message: has plan_exit tool, finish = tool-calls
      const assistant1: MessageV2.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        sessionID: session.id,
        time: { created: now + 1 },
        parentID: user.id,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: "plan",
        agent: "plan",
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "tool-calls",
      }
      await sessions.updateMessage(assistant1)
      await sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistant1.id,
        sessionID: session.id,
        type: "tool",
        callID: Identifier.ascending("tool"),
        tool: "plan_exit",
        state: {
          status: "completed",
          input: {},
          output: "Plan is ready. Ending planning turn.",
          title: "plan_exit",
          metadata: {},
          time: { start: now + 1, end: now + 1 },
        },
      } satisfies MessageV2.ToolPart)

      // Second assistant message: text only, finish = end_turn (this is what lastAssistantMsg would point to)
      const assistant2: MessageV2.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        sessionID: session.id,
        time: { created: now + 2 },
        parentID: user.id,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: "plan",
        agent: "plan",
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "end_turn",
      }
      await sessions.updateMessage(assistant2)
      await sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistant2.id,
        sessionID: session.id,
        type: "text",
        text: "The plan is complete. I've called plan_exit.",
      })

      const messages = await sessions.messages({ sessionID: session.id })
      expect(SessionPrompt.shouldAskPlanFollowup({ messages, abort: AbortSignal.any([]) })).toBe(true)
    }))

  test("PlanFollowup.ask falls back to plan file for tool-only plan_exit turns", () =>
    withInstance(async () => {
      const seeded = await seed({
        tools: [
          {
            tool: "plan_exit",
            input: {},
            output: "Plan is ready. Ending planning turn.",
          },
        ],
      })

      const session = await sessions.get(seeded.sessionID)
      const plan = Session.plan(session, Instance.current)
      await fs.mkdir(path.dirname(plan), { recursive: true })
      await Bun.write(plan, "Do implementation step 1")

      const pending = PlanFollowup.ask({
        question: questions,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const question = await waitQuestion(seeded.sessionID)
      expect(question).toBeDefined()
      if (!question) return
      await questions.reply({
        requestID: question.id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })
      await expect(pending).resolves.toBe("continue")
    }))

  test("plan reminder reuses custom plan_exit path when refining", () =>
    withInstance(async () => {
      const seeded = await seed({
        tools: [
          {
            tool: "plan_exit",
            input: { path: ".plans/fix.md" },
            output: "Plan is ready at .plans/fix.md. Ending planning turn.",
          },
        ],
      })
      const file = path.join(Instance.worktree, ".plans", "fix.md")
      await fs.mkdir(path.dirname(file), { recursive: true })
      await Bun.write(file, "Do implementation step 1")

      const session = await sessions.get(seeded.sessionID)
      const id = MessageID.ascending()
      const user: MessageV2.WithParts = {
        info: {
          id,
          role: "user",
          sessionID: seeded.sessionID,
          time: { created: Date.now() },
          agent: "Architect",
          model,
        },
        parts: [
          {
            id: PartID.ascending(),
            messageID: id,
            sessionID: seeded.sessionID,
            type: "text",
            text: "Continue refining",
          },
        ],
      }
      await KiloSessionPrompt.insertPlanReminders({
        agent: { name: "Architect", options: {} },
        session,
        userMessage: user,
        messages: [...seeded.messages, user],
      })

      const part = user.parts.at(-1)
      const text = part?.type === "text" ? part.text : ""
      expect(text).toContain("The current saved plan file is")
      expect(text.replaceAll(path.sep, "/")).toContain(".plans/fix.md")
      expect(text).toContain("Project/user instructions about plan location")
      expect(text).not.toContain("No plan file exists yet")
    }))

  test("native plan reminder creates the default plan directory", () =>
    withInstance(async () => {
      const session = await sessions.create({})
      const dir = path.dirname(Session.plan(session, Instance.current))
      await expect(fs.stat(dir).then(() => true, () => false)).resolves.toBe(false)

      const id = MessageID.ascending()
      const user: MessageV2.WithParts = {
        info: {
          id,
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "plan",
          model,
        },
        parts: [
          {
            id: PartID.ascending(),
            messageID: id,
            sessionID: session.id,
            type: "text",
            text: "Create a plan.",
          },
        ],
      }

      await KiloSessionPrompt.insertPlanReminders({
        agent: { name: "plan", options: {} },
        session,
        userMessage: user,
        messages: [user],
      })

      await expect(fs.stat(dir).then((stat) => stat.isDirectory())).resolves.toBe(true)
    }))

  test("native plan reminder keeps in-chat approval for clients without follow-up support", () =>
    withInstance(async () => {
      const prev = process.env.KILO_CLIENT
      try {
        const session = await sessions.create({})

        process.env.KILO_CLIENT = "vscode"
        const supported = userMessage({ sessionID: session.id, agent: "plan", text: "Create a plan." })
        await KiloSessionPrompt.insertPlanReminders({
          agent: { name: "plan", options: {} },
          session,
          userMessage: supported,
          messages: [supported],
        })
        const supportedText = content(supported)
        expect(supportedText).toContain("client follow-up after plan_exit asks whether to implement")
        expect(supportedText).not.toContain("Finalize and save the plan")

        process.env.KILO_CLIENT = "acp"
        const acp = userMessage({ sessionID: session.id, agent: "plan", text: "Create a plan." })
        await KiloSessionPrompt.insertPlanReminders({
          agent: { name: "plan", options: {} },
          session,
          userMessage: acp,
          messages: [acp],
        })
        const text = content(acp)
        expect(text).toContain("Finalize and save the plan")
        expect(text).toContain("Continue refining")
        expect(text).not.toContain("client follow-up after plan_exit asks")
      } finally {
        if (prev === undefined) delete process.env.KILO_CLIENT
        else process.env.KILO_CLIENT = prev
      }
    }))

  test("native plan reminder prefers project plan path instructions over fallback", () =>
    withInstance(async () => {
      const session = await sessions.create({})
      const id = MessageID.ascending()
      const user: MessageV2.WithParts = {
        info: {
          id,
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "plan",
          model,
        },
        parts: [
          {
            id: PartID.ascending(),
            messageID: id,
            sessionID: session.id,
            type: "text",
            text: "Create a plan. AGENTS says plans go in plans/.",
          },
        ],
      }

      await KiloSessionPrompt.insertPlanReminders({
        agent: { name: "plan", options: {} },
        session,
        userMessage: user,
        messages: [user],
      })

      const part = user.parts.at(-1)
      const text = part?.type === "text" ? part.text : ""
      expect(text).toContain(`${session.time.created}-<concise-kebab-case-suffix>.md`)
      expect(text).toContain(`${session.time.created}-database-cache-plan.md`)
      expect(text).toContain("plans/ or .plans/")
      expect(text).not.toContain(Session.plan(session, Instance.current))
    }))

  test("native plan reminder reuses custom plan_exit path when refining", () =>
    withInstance(async () => {
      const seeded = await seed({
        tools: [
          {
            tool: "plan_exit",
            input: { path: ".plans/fix.md" },
            output: "Plan is ready at .plans/fix.md. Ending planning turn.",
          },
        ],
      })
      const file = path.join(Instance.worktree, ".plans", "fix.md")
      await fs.mkdir(path.dirname(file), { recursive: true })
      await Bun.write(file, "Do implementation step 1")

      const session = await sessions.get(seeded.sessionID)
      const id = MessageID.ascending()
      const user: MessageV2.WithParts = {
        info: {
          id,
          role: "user",
          sessionID: seeded.sessionID,
          time: { created: Date.now() },
          agent: "plan",
          model,
        },
        parts: [
          {
            id: PartID.ascending(),
            messageID: id,
            sessionID: seeded.sessionID,
            type: "text",
            text: "Continue refining",
          },
        ],
      }
      await KiloSessionPrompt.insertPlanReminders({
        agent: { name: "plan", options: {} },
        session,
        userMessage: user,
        messages: [...seeded.messages, user],
      })

      const text = content(user)
      expect(text).toContain("The current saved plan file is")
      expect(text.replaceAll(path.sep, "/")).toContain(".plans/fix.md")
      expect(text).not.toContain(`${session.time.created}-<concise-kebab-case-suffix>.md`)
      expect(text).not.toContain("No plan file exists yet")
    }))

  test("architect reminder prefers project plan path instructions over fallback", () =>
    withInstance(async () => {
      const session = await sessions.create({})
      const id = MessageID.ascending()
      const user: MessageV2.WithParts = {
        info: {
          id,
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "Architect",
          model,
        },
        parts: [
          {
            id: PartID.ascending(),
            messageID: id,
            sessionID: session.id,
            type: "text",
            text: "Create a plan. AGENTS says plans go in plans/.",
          },
        ],
      }

      await KiloSessionPrompt.insertPlanReminders({
        agent: { name: "Architect", options: {} },
        session,
        userMessage: user,
        messages: [user],
      })

      const part = user.parts.at(-1)
      const text = part?.type === "text" ? part.text : ""
      expect(text).toContain(`${session.time.created}-<concise-kebab-case-suffix>.md`)
      expect(text).toContain("plans/ or .plans/")
      expect(text).not.toContain("Default to")
      expect(text).not.toContain("A fallback plan file exists")
    }))

  test("PlanFollowup.ask shows prompt when plan text is on earlier assistant and last assistant is empty", () =>
    withInstance(async () => {
      const session = await sessions.create({})
      // Use explicit timestamps to ensure deterministic message ordering
      const now = Date.now()
      const user = await sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: session.id,
        time: { created: now },
        agent: "plan",
        model,
      })
      await sessions.updatePart({
        id: PartID.ascending(),
        messageID: user.id,
        sessionID: session.id,
        type: "text",
        text: "Create a plan",
      })

      // First assistant message: has plan text + plan_exit tool
      const assistant1: MessageV2.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        sessionID: session.id,
        time: { created: now + 1 },
        parentID: user.id,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: "plan",
        agent: "plan",
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "tool-calls",
      }
      await sessions.updateMessage(assistant1)
      await sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistant1.id,
        sessionID: session.id,
        type: "text",
        text: "Here is the detailed plan:\n\n## Step 1\nDo something\n\n## Step 2\nDo something else",
      })
      await sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistant1.id,
        sessionID: session.id,
        type: "tool",
        callID: Identifier.ascending("tool"),
        tool: "plan_exit",
        state: {
          status: "completed",
          input: {},
          output: "Plan is ready. Ending planning turn.",
          title: "plan_exit",
          metadata: {},
          time: { start: now + 1, end: now + 1 },
        },
      } satisfies MessageV2.ToolPart)

      // Second assistant message: empty (LLM follow-up after tool result)
      const assistant2: MessageV2.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        sessionID: session.id,
        time: { created: now + 2 },
        parentID: user.id,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: "plan",
        agent: "plan",
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "end_turn",
      }
      await sessions.updateMessage(assistant2)

      const messages = await sessions.messages({ sessionID: session.id })

      // shouldAskPlanFollowup should detect plan_exit on the earlier message
      expect(SessionPrompt.shouldAskPlanFollowup({ messages, abort: AbortSignal.any([]) })).toBe(true)

      // PlanFollowup.ask should find plan text from the earlier assistant and show prompt
      const pending = PlanFollowup.ask({
        question: questions,
        sessionID: session.id,
        messages,
        abort: AbortSignal.any([]),
      })

      const question = await waitQuestion(session.id)
      expect(question).toBeDefined()
      if (!question) return
      expect(question.questions[0].header).toBe("Implement")
      await questions.reply({
        requestID: question.id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })
      await expect(pending).resolves.toBe("continue")
    }))
})
