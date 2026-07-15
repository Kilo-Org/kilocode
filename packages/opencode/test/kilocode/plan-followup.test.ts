import { describe, expect, spyOn, test } from "bun:test"
import { Effect } from "effect"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Agent } from "../../src/agent/agent"
import { GlobalBus } from "../../src/bus/global"
import { TuiEvent } from "../../src/cli/cmd/tui/event"
import { Identifier } from "../../src/id/id"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { EventV2 } from "@opencode-ai/core/event"
import { formatTodos, generateHandover, PlanFollowup, PlanFollowupRuntime } from "../../src/kilocode/plan-followup"
import { Instance } from "../../src/kilocode/instance"
import { Provider } from "../../src/provider/provider"
import { Question } from "../../src/question"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { AppRuntime } from "../../src/effect/app-runtime"
import { makeRuntime } from "../../src/effect/run-service"
import { SessionStatus } from "../../src/session/status"
import { Todo } from "../../src/session/todo"
import path from "path"
import fs from "fs/promises"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

Log.init({ print: false })
process.env.KILO_CLIENT = "cli"

function subscribe<D extends EventV2.Definition>(
  definition: D,
  callback: (event: { properties: EventV2.Data<D> }) => void,
) {
  const directory = Instance.directory
  const handler = (event: { directory?: string; payload?: { type?: string; properties?: unknown } }) => {
    if (event.directory !== directory || event.payload?.type !== definition.type) return
    callback({ properties: event.payload.properties as EventV2.Data<D> })
  }
  GlobalBus.on("event", handler)
  return () => GlobalBus.off("event", handler)
}

const runtime = makeRuntime(Question.Service, Question.defaultLayer)
const question = {
  ask(input: Parameters<Question.Interface["ask"]>[0]) {
    return runtime.runPromise((svc) => svc.ask(input))
  },
  list() {
    return runtime.runPromise((svc) => svc.list())
  },
  reply(input: Parameters<Question.Interface["reply"]>[0]) {
    return runtime.runPromise((svc) => svc.reply(input))
  },
  reject(requestID: Parameters<Question.Interface["reject"]>[0]) {
    return runtime.runPromise((svc) => svc.reject(requestID))
  },
}

const todo = {
  update(input: Parameters<Todo.Interface["update"]>[0]) {
    return AppRuntime.runPromise(Todo.Service.use((svc) => svc.update(input)))
  },
  get(sessionID: SessionID) {
    return AppRuntime.runPromise(Todo.Service.use((svc) => svc.get(sessionID)))
  },
}

const session = makeRuntime(Session.Service, Session.defaultLayer)
const store = {
  create: (input?: Parameters<Session.Interface["create"]>[0]) =>
    session.runPromise((svc) => svc.create(input)),
  get: (id: SessionID) =>
    session.runPromise((svc) => svc.get(id)),
  messages: (input: Parameters<Session.Interface["messages"]>[0]) =>
    session.runPromise((svc) => svc.messages(input)),
  updateMessage: <T extends MessageV2.Info>(msg: T) =>
    session.runPromise((svc) => svc.updateMessage(msg)),
  updatePart: <T extends MessageV2.Part>(part: T) =>
    session.runPromise((svc) => svc.updatePart(part)),
}

const model = {
  providerID: ProviderV2.ID.make("openai"),
  modelID: ModelV2.ID.make("gpt-4"),
}

const saved = {
  providerID: ProviderV2.ID.make("openai"),
  modelID: ModelV2.ID.make("gpt-5"),
}

const savedVar = "high"

const config = {
  providerID: ProviderV2.ID.make("openai"),
  modelID: ModelV2.ID.make("gpt-4.1"),
}

const configVar = "max"
const planVar = "medium"

const statePath = path.join(Global.Path.state, "model.json")
const savedKey = `${saved.providerID}/${saved.modelID}`

async function withInstance(fn: () => Promise<void>) {
  await using tmp = await tmpdir({ git: true })
  await fs.rm(statePath, { force: true }).catch(() => {})
  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      await fs.rm(statePath, { force: true }).catch(() => {})
      try {
        await fn()
      } finally {
        await fs.rm(statePath, { force: true }).catch(() => {})
      }
    },
  })
}

async function seed(input: {
  text: string
  variant?: string
  tools?: Array<{ tool: string; input: Record<string, unknown>; output: string }>
}) {
  const session = await store.create({})
  const user = await store.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: session.id,
    time: {
      created: Date.now(),
    },
    agent: "plan",
    model: input.variant ? { ...model, variant: input.variant } : model,
  })
  await store.updatePart({
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
    time: {
      created: Date.now(),
    },
    parentID: user.id,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "plan",
    agent: "plan",
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
      cache: {
        read: 0,
        write: 0,
      },
    },
    finish: "end_turn",
  }
  await store.updateMessage(assistant)
  await store.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID: session.id,
    type: "text",
    text: input.text,
  })

  for (const t of input.tools ?? []) {
    await store.updatePart({
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

  const messages = await store.messages({ sessionID: session.id })
  return {
    sessionID: session.id,
    messages,
  }
}

async function latestUser(sessionID: SessionID) {
  const messages = await store.messages({ sessionID })
  return messages
    .slice()
    .reverse()
    .find((item) => item.info.role === "user")
}

async function sessions() {
  return session.runPromise((svc) => svc.list())
}

async function waitQuestion(sessionID: string) {
  for (let i = 0; i < 50; i++) {
    const list = await question.list()
    const item = list.find((q) => q.sessionID === sessionID)
    if (item) return item
    await Bun.sleep(10)
  }
}

async function writeState(input: {
  model?: Record<string, { providerID: string; modelID: string }>
  variant?: Record<string, string | undefined>
}) {
  await fs.mkdir(Global.Path.state, { recursive: true })
  await fs.writeFile(statePath, JSON.stringify(input))
}

const fakeAgent: Agent.Info = {
  name: "compaction",
  mode: "subagent",
  permission: [],
  options: {},
}

const fakeModel = {
  id: "gpt-4",
  providerID: "openai",
  limit: { context: 128000, input: 0 },
  api: { id: "openai", npm: "@ai-sdk/openai" },
  capabilities: {},
} as Provider.Model

function full(input: { providerID: string; modelID: string }, vars: string[]) {
  return {
    ...fakeModel,
    id: input.modelID,
    providerID: input.providerID,
    variants: Object.fromEntries(vars.map((item) => [item, {}])),
  } as Provider.Model
}

const savedFull = full(saved, [savedVar, "low"])
const savedConfigFull = full(saved, [configVar, "low"])
const configFull = full(config, [configVar, "low"])

function mockHandoverDeps(text: string, opts?: { agent?: Agent.Info | null }) {
  const agentSpy = spyOn(PlanFollowupRuntime, "agent").mockResolvedValue(
    (opts?.agent === null ? undefined : (opts?.agent ?? fakeAgent)) as any,
  )
  const modelSpy = spyOn(PlanFollowupRuntime, "model").mockResolvedValue(fakeModel)
  const handoverSpy = spyOn(PlanFollowupRuntime, "handover").mockResolvedValue(text)
  return {
    agentSpy,
    modelSpy,
    handoverSpy,
    [Symbol.dispose]() {
      agentSpy.mockRestore()
      modelSpy.mockRestore()
      handoverSpy.mockRestore()
    },
  }
}

describe("plan follow-up", () => {
  test("ask - returns break when dismissed", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "1. Step one\n2. Step two" })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reject(item.id)

      await expect(pending).resolves.toBe("break")
    }))

  test("ask - emits a single-select question with the canonical answers and custom enabled on CLI", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "1. Build" })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      const q = item.questions[0]
      expect(q).toBeDefined()
      if (!q) return

      // On CLI the main prompt input is hidden while a blocking question is active, so
      // "Type your own answer" must remain available — i.e. custom must not be false.
      expect(q.custom).not.toBe(false)
      expect(q.multiple).not.toBe(true)
      expect(q.options.map((item) => item.label)).toEqual([
        PlanFollowup.ANSWER_NEW_SESSION,
        PlanFollowup.ANSWER_CONTINUE,
        PlanFollowup.ANSWER_KEEP_REFINING,
      ])

      await question.reject(item.id)
      await expect(pending).resolves.toBe("break")
    }))

  test("ask - follow-up options carry modes so the picker updates immediately", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "1. Build" })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      const q = item.questions[0]
      expect(q).toBeDefined()
      if (!q) return

      const continueOpt = q.options.find((o) => o.label === PlanFollowup.ANSWER_CONTINUE)
      expect(continueOpt?.mode).toBe("code")

      const refineOpt = q.options.find((o) => o.label === PlanFollowup.ANSWER_KEEP_REFINING)
      expect(refineOpt?.mode).toBe("plan")

      // Start new session should not carry a mode (it opens a new session — the
      // current picker is irrelevant once the session switches).
      const newOpt = q.options.find((o) => o.label === PlanFollowup.ANSWER_NEW_SESSION)
      expect(newOpt?.mode).toBeUndefined()

      await question.reject(item.id)
      await expect(pending).resolves.toBe("break")
    }))

  test("ask - hides custom answer row on VS Code where the main prompt input handles typed replies", () =>
    withInstance(async () => {
      const prev = process.env.KILO_CLIENT
      try {
        process.env.KILO_CLIENT = "vscode"
        const seeded = await seed({ text: "1. Build" })
        const pending = PlanFollowup.ask({
          question,
          sessionID: seeded.sessionID,
          messages: seeded.messages,
          abort: AbortSignal.any([]),
        })

        const item = await waitQuestion(seeded.sessionID)
        expect(item).toBeDefined()
        if (!item) return
        const q = item.questions[0]
        expect(q).toBeDefined()
        if (!q) return

        // On VS Code the dock's main prompt input already accepts free text as a reply,
        // so the "Type your own answer" row is redundant and must be hidden.
        expect(q.custom).toBe(false)

        await question.reject(item.id)
        await expect(pending).resolves.toBe("break")
      } finally {
        process.env.KILO_CLIENT = prev
      }
    }))

  test("ask - emits i18n keys alongside the canonical English labels", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "1. Build" })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      const q = item.questions[0]
      expect(q).toBeDefined()
      if (!q) return

      // i18n keys for question-level strings
      expect(q.questionKey).toBe("plan.followup.question")
      expect(q.headerKey).toBe("plan.followup.header")

      // i18n keys for option labels — order matters: newSession is first, continue second.
      expect(q.options.map((o) => o.labelKey)).toEqual([
        "plan.followup.answer.newSession",
        "plan.followup.answer.continue",
        "plan.followup.answer.keepRefining",
      ])
      expect(q.options.map((o) => o.descriptionKey)).toEqual([
        "plan.followup.answer.newSession.description",
        "plan.followup.answer.continue.description",
        "plan.followup.answer.keepRefining.description",
      ])

      // Canonical English labels stay on the wire — the server still matches on `label`,
      // so translating the UI must not change the reply format.
      expect(q.options.map((o) => o.label)).toEqual([
        PlanFollowup.ANSWER_NEW_SESSION,
        PlanFollowup.ANSWER_CONTINUE,
        PlanFollowup.ANSWER_KEEP_REFINING,
      ])

      await question.reject(item.id)
      await expect(pending).resolves.toBe("break")
    }))

  test("ask - returns continue and creates code message on Continue here", () =>
    withInstance(async () => {
      const get = spyOn(PlanFollowupRuntime, "agent").mockImplementation(async (name: string) => {
        if (name === "code") {
          return {
            name: "code",
            mode: "primary",
            permission: [],
            options: {},
            model: saved,
            variant: configVar,
          } as any
        }
        return undefined as any
      })
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockResolvedValue(savedConfigFull)
      using _ = {
        [Symbol.dispose]() {
          get.mockRestore()
          modelSpy.mockRestore()
        },
      }
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })

      await expect(pending).resolves.toBe("continue")

      const user = await latestUser(seeded.sessionID)
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") return
      expect(user.info.agent).toBe("code")
      expect(user.info.model).toEqual({ ...saved, variant: configVar })

      const part = user.parts.find((item) => item.type === "text")
      expect(part?.type).toBe("text")
      if (!part || part.type !== "text") return
      expect(part.text).toBe("Implement the plan above.")
      expect(part.synthetic).toBe(true)
    }))

  test("ask - returns continue and creates plan message on Keep refining", () =>
    withInstance(async () => {
      const track = spyOn(Telemetry, "trackPlanFollowup").mockImplementation(() => {})
      using _ = {
        [Symbol.dispose]() {
          track.mockRestore()
        },
      }
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_KEEP_REFINING]],
      })

      await expect(pending).resolves.toBe("continue")
      expect(track).toHaveBeenCalledWith(seeded.sessionID, "keep_refining")

      const user = await latestUser(seeded.sessionID)
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") return
      expect(user.info.agent).toBe("plan")

      const part = user.parts.find((item) => item.type === "text")
      expect(part?.type).toBe("text")
      if (!part || part.type !== "text") return
      expect(part.text).toBe("Continue refining the plan. Do not implement yet.")
      expect(part.synthetic).toBe(true)
    }))

  test("ask - returns continue and creates plan message for custom text", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [["Add rollback support too"]],
      })

      await expect(pending).resolves.toBe("continue")

      const user = await latestUser(seeded.sessionID)
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") return
      expect(user.info.agent).toBe("plan")

      const part = user.parts.find((item) => item.type === "text")
      expect(part?.type).toBe("text")
      if (!part || part.type !== "text") return
      expect(part.text).toBe("Add rollback support too")
      expect(part.synthetic).toBe(true)
    }))

  test("ask - retargets prompt queue so injected message is visible in scope", () =>
    withInstance(async () => {
      const { KiloSessionPromptQueue } = await import("../../src/kilocode/session/prompt-queue")
      const seeded = await seed({ text: "1. Refactor\n2. Ship" })

      // Simulate the prompt queue having a target set (like during a running loop)
      const original = seeded.messages.find((m) => m.info.role === "user")!.info.id
      KiloSessionPromptQueue.retarget(seeded.sessionID, original)

      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })

      await expect(pending).resolves.toBe("continue")

      // The injected user message must be visible when scoped
      const all = await store.messages({ sessionID: seeded.sessionID })
      const scoped = KiloSessionPromptQueue.scope(seeded.sessionID, all)
      const injected = scoped.findLast((m) => m.info.role === "user")
      expect(injected).toBeDefined()
      const part = injected!.parts.find((p) => p.type === "text")
      expect(part?.type === "text" && part.text).toBe("Implement the plan above.")
    }))

  test("ask - creates a new session on Start new session with handover and todos", () =>
    withInstance(async () => {
      const get = spyOn(PlanFollowupRuntime, "agent").mockImplementation(async (name: string) => {
        if (name === "code") {
          return {
            name: "code",
            mode: "primary",
            permission: [],
            options: {},
            model: saved,
            variant: configVar,
          } as any
        }
        if (name === "compaction") return fakeAgent as any
        return undefined as any
      })
      using _file = {
        [Symbol.dispose]() {
          get.mockRestore()
        },
      }
      const loop = spyOn(PlanFollowupRuntime, "loop").mockResolvedValue({
        info: {
          id: MessageID.make("msg_test"),
          role: "assistant",
          sessionID: SessionID.make("ses_test"),
          time: {
            created: Date.now(),
          },
          parentID: MessageID.make("msg_parent"),
          modelID: ModelV2.ID.make("test"),
          providerID: ProviderV2.ID.make("test"),
          mode: "code",
          agent: "code",
          path: {
            cwd: "/tmp",
            root: "/tmp",
          },
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
        parts: [],
      })
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockImplementation(
        async (providerID: string, modelID: string) => {
          if (providerID === saved.providerID && modelID === saved.modelID) return savedConfigFull
          return fakeModel
        },
      )
      const handoverSpy = spyOn(PlanFollowupRuntime, "handover").mockResolvedValue(
        "## Discoveries\n\nFound REST endpoints in src/api.ts\n\n## Relevant Files\n\n- src/api.ts: REST endpoints\n- src/db.ts: Database layer",
      )
      using _mocks = {
        handoverSpy,
        [Symbol.dispose]() {
          modelSpy.mockRestore()
          handoverSpy.mockRestore()
        },
      }
      using _loop = {
        [Symbol.dispose]() {
          loop.mockRestore()
        },
      }
      const seeded = await seed({
        text: "1. Add API\n2. Add tests",
      })

      await todo.update({
        sessionID: seeded.sessionID,
        todos: [
          { content: "Add API endpoint", status: "completed", priority: "high" },
          { content: "Write tests", status: "pending", priority: "medium" },
        ],
      })

      const before = await sessions()
      const created: SessionID[] = []
      const unsub = subscribe(TuiEvent.SessionSelect, (event) => {
        created.push(event.properties.sessionID)
      })

      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_NEW_SESSION]],
      })

      await expect(pending).resolves.toBe("break")
      unsub()

      const after = await sessions()
      const prev = new Set(before.map((item) => item.id))
      const added = after.filter((item) => !prev.has(item.id))
      expect(added).toHaveLength(1)
      expect(created).toHaveLength(1)
      expect(loop).toHaveBeenCalledTimes(1)
      expect(_mocks.handoverSpy).toHaveBeenCalledTimes(1)

      const newSessionID = created[0]
      const next = added[0]
      if (!newSessionID || !next) throw new Error("expected follow-up session")
      expect(next.id).toBe(newSessionID)
      expect(next.parentID).toBeUndefined()
      const planPath = Session.plan(await store.get(seeded.sessionID), Instance.current)
      const messages = await store.messages({ sessionID: newSessionID })
      const user = messages.find((item) => item.info.role === "user")
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") throw new Error("expected seeded user message")
      expect(user.info.agent).toBe("code")
      expect(user.info.model).toEqual({ ...saved, variant: configVar })

      const part = user.parts.find((item) => item.type === "text")
      expect(part?.type).toBe("text")
      if (!part || part.type !== "text") throw new Error("expected text part")
      expect(part.text).toContain(`Plan file: ${planPath}`)
      expect(part.text).toContain("Read this file first and treat it as the source of truth for implementation.")
      expect(part.text).not.toContain("Implement the following plan:")
      expect(part.text).not.toContain("1. Add API\n2. Add tests")
      expect(part.text).toContain("## Handover from Planning Session")
      expect(part.text).toContain("Found REST endpoints in src/api.ts")
      expect(part.text).toContain("## Todo List")
      expect(part.text).toContain("[x] Add API endpoint")
      expect(part.text).toContain("[ ] Write tests")
      expect(part.synthetic).toBe(false)

      const newTodos = await todo.get(newSessionID)
      expect(newTodos).toHaveLength(2)
      expect(newTodos).toContainEqual({ content: "Add API endpoint", status: "completed", priority: "high" })
      expect(newTodos).toContainEqual({ content: "Write tests", status: "pending", priority: "medium" })
    }))

  test("ask - creates a new session in the planning session directory when the current instance differs", () =>
    withInstance(async () => {
      await using other = await tmpdir({ git: true })
      const get = spyOn(PlanFollowupRuntime, "agent").mockImplementation(async () => undefined as any)
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockResolvedValue(fakeModel)
      const handoverSpy = spyOn(PlanFollowupRuntime, "handover").mockResolvedValue("")
      const loop = spyOn(PlanFollowupRuntime, "loop").mockResolvedValue({
        info: {
          id: MessageID.make("msg_test"),
          role: "assistant",
          sessionID: SessionID.make("ses_test"),
          time: { created: Date.now() },
          parentID: MessageID.make("msg_parent"),
          modelID: ModelV2.ID.make("test"),
          providerID: ProviderV2.ID.make("test"),
          mode: "code",
          agent: "code",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
        parts: [],
      } as MessageV2.WithParts)
      using _mocks = {
        [Symbol.dispose]() {
          get.mockRestore()
          modelSpy.mockRestore()
          handoverSpy.mockRestore()
          loop.mockRestore()
        },
      }

      const dir = other.path

      const seeded = await provideTestInstance({
        directory: dir,
        fn: async () => seed({ text: "1. Add API\n2. Add tests" }),
      })

      const before = await provideTestInstance({
        directory: dir,
        fn: async () => sessions(),
      })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return

      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_NEW_SESSION]],
      })

      await expect(pending).resolves.toBe("break")
      const after = await provideTestInstance({
        directory: dir,
        fn: async () => sessions(),
      })

      const prev = new Set(before.map((item) => item.id))
      const added = after.filter((item) => !prev.has(item.id))
      expect(added).toHaveLength(1)
      const next = added[0]
      if (!next) throw new Error("expected follow-up session")
      expect(next?.directory).toBe(dir)
      expect(next?.parentID).toBeUndefined()

      if (next) {
        const planPath = await provideTestInstance({
          directory: dir,
          fn: async () => Session.plan(await store.get(seeded.sessionID), Instance.current),
        })
        const messages = await store.messages({ sessionID: next.id })
        const user = messages.find((item) => item.info.role === "user")
        if (!user || user.info.role !== "user") throw new Error("expected user message")
        const part = user.parts.find((item) => item.type === "text")
        if (!part || part.type !== "text") throw new Error("expected text part")
        expect(part.text).toContain(`Plan file: ${planPath}`)
      }
    }))

  test("ask - prefers saved code variant over configured code variant", () =>
    withInstance(async () => {
      await writeState({
        model: { code: saved },
        variant: { [savedKey]: savedVar },
      })
      const get = spyOn(PlanFollowupRuntime, "agent").mockImplementation(async (name: string) => {
        if (name === "code") {
          return {
            name: "code",
            mode: "primary",
            permission: [],
            options: {},
            model: config,
            variant: configVar,
          } as any
        }
        return undefined as any
      })
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockImplementation(
        async (providerID: string, modelID: string) => {
          if (providerID === saved.providerID && modelID === saved.modelID) return savedFull
          if (providerID === config.providerID && modelID === config.modelID) return configFull
          throw new Error(`unexpected model lookup ${providerID}/${modelID}`)
        },
      )
      using _ = {
        [Symbol.dispose]() {
          get.mockRestore()
          modelSpy.mockRestore()
        },
      }
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })

      await expect(pending).resolves.toBe("continue")

      const user = await latestUser(seeded.sessionID)
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") return
      expect(user.info.agent).toBe("code")
      expect(user.info.model).toEqual({ ...saved, variant: savedVar })
    }))

  test("ask - falls back to configured code model when saved CLI code model is unavailable", () =>
    withInstance(async () => {
      await writeState({ model: { code: { providerID: ProviderV2.ID.make("missing"), modelID: ModelV2.ID.make("ghost") } } })
      const get = spyOn(PlanFollowupRuntime, "agent").mockImplementation(async (name: string) => {
        if (name === "code") {
          return {
            name: "code",
            mode: "primary",
            permission: [],
            options: {},
            model: config,
            variant: configVar,
          } as any
        }
        return undefined as any
      })
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockImplementation(
        async (providerID: string, modelID: string) => {
          if (providerID === "missing" && modelID === "ghost") throw new Error("missing model")
          return configFull
        },
      )
      using _ = {
        [Symbol.dispose]() {
          get.mockRestore()
          modelSpy.mockRestore()
        },
      }
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })

      await expect(pending).resolves.toBe("continue")

      const user = await latestUser(seeded.sessionID)
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") return
      expect(user.info.agent).toBe("code")
      expect(user.info.model).toEqual({ ...config, variant: configVar })
    }))

  test("ask - falls back to planning model when no saved or configured code model exists", () =>
    withInstance(async () => {
      const get = spyOn(PlanFollowupRuntime, "agent").mockImplementation(async (name: string) => {
        if (name === "code") return undefined as any
        return undefined as any
      })
      using _ = {
        [Symbol.dispose]() {
          get.mockRestore()
        },
      }
      const seeded = await seed({ text: "1. Build\n2. Test", variant: planVar })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })

      await expect(pending).resolves.toBe("continue")

      const user = await latestUser(seeded.sessionID)
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") return
      expect(user.info.agent).toBe("code")
      expect(user.info.model).toEqual({ ...model, variant: planVar })
    }))

  test("ask - new session omits handover section when LLM returns empty", () =>
    withInstance(async () => {
      const loop = spyOn(PlanFollowupRuntime, "loop").mockResolvedValue({
        info: {
          id: MessageID.make("msg_test"),
          role: "assistant",
          sessionID: SessionID.make("ses_test"),
          time: { created: Date.now() },
          parentID: MessageID.make("msg_parent"),
          modelID: ModelV2.ID.make("test"),
          providerID: ProviderV2.ID.make("test"),
          mode: "code",
          agent: "code",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
        parts: [],
      })
      using _mocks = mockHandoverDeps("")
      using _loop = {
        [Symbol.dispose]() {
          loop.mockRestore()
        },
      }
      const seeded = await seed({ text: "1. Add API\n2. Add tests" })
      const created: SessionID[] = []
      const unsub = subscribe(TuiEvent.SessionSelect, (event) => {
        created.push(event.properties.sessionID)
      })

      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_NEW_SESSION]],
      })

      await expect(pending).resolves.toBe("break")
      unsub()

      const newSessionID = created[0]
      if (!newSessionID) throw new Error("expected follow-up session")
      const messages = await store.messages({ sessionID: newSessionID })
      const user = messages.find((item) => item.info.role === "user")
      if (!user || user.info.role !== "user") throw new Error("expected user message")
      const part = user.parts.find((item) => item.type === "text")
      if (!part || part.type !== "text") throw new Error("expected text part")
      expect(part.text).toContain("Plan file:")
      expect(part.text).toContain("Read this file first and treat it as the source of truth for implementation.")
      expect(part.text).not.toContain("Implement the following plan:")
      expect(part.text).not.toContain("1. Add API\n2. Add tests")
      expect(part.text).not.toContain("## Handover from Planning Session")
      expect(part.text).not.toContain("## Todo List")
    }))

  test("ask - new session references plan file without copying planning transcript", () =>
    withInstance(async () => {
      using _mocks = mockHandoverDeps("## Discoveries\n\nUse the saved plan file as the source of truth.")
      const loop = spyOn(PlanFollowupRuntime, "loop").mockResolvedValue({
        info: {
          id: MessageID.make("msg_test"),
          role: "assistant",
          sessionID: SessionID.make("ses_test"),
          time: { created: Date.now() },
          parentID: MessageID.make("msg_parent"),
          modelID: ModelV2.ID.make("test"),
          providerID: ProviderV2.ID.make("test"),
          mode: "code",
          agent: "code",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [],
      } as MessageV2.WithParts)
      using _loop = {
        [Symbol.dispose]() {
          loop.mockRestore()
        },
      }

      const transcript = "I inspected plan-followup.ts and found the session handoff path."
      const seeded = await seed({
        text: `${transcript}\n\nThis is visible planning chat, not implementation input.`,
        tools: [
          {
            tool: "plan_exit",
            input: {},
            output: "Plan is ready. Ending planning turn.",
          },
        ],
      })
      const user = seeded.messages.find((m) => m.info.role === "user")?.info
      if (!user || user.role !== "user") throw new Error("expected seeded user message")

      await store.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        sessionID: seeded.sessionID,
        time: { created: Date.now() + 1 },
        parentID: user.id,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: "plan",
        agent: "plan",
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "end_turn",
      } satisfies MessageV2.Assistant)

      const messages = await store.messages({ sessionID: seeded.sessionID })
      const created: SessionID[] = []
      const unsub = subscribe(TuiEvent.SessionSelect, (event) => {
        created.push(event.properties.sessionID)
      })
      using _bus = {
        [Symbol.dispose]() {
          unsub()
        },
      }

      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_NEW_SESSION]],
      })

      await expect(pending).resolves.toBe("break")

      const id = created[0]
      if (!id) throw new Error("expected follow-up session")
      const plan = Session.plan(await store.get(seeded.sessionID), Instance.current)
      const next = await store.messages({ sessionID: id })
      const msg = next.find((m) => m.info.role === "user")
      const part = msg?.parts.find((p) => p.type === "text")
      expect(part?.type).toBe("text")
      if (part?.type !== "text") return

      expect(part.text).toContain(`Plan file: ${plan}`)
      expect(part.text).toContain("Read this file first and treat it as the source of truth for implementation.")
      expect(part.text).toContain("## Handover from Planning Session")
      expect(part.text).toContain("Use the saved plan file as the source of truth.")
      expect(part.text).not.toContain("Implement the following plan:")
      expect(part.text).not.toContain(transcript)
      expect(part.text).not.toContain("This is visible planning chat")
    }))

  test("ask - fires session.created before generateHandover resolves on Start new session", () =>
    withInstance(async () => {
      // Regression guard: the VS Code extension gates `session.created` SSE events
      // behind a 30-second pendingFollowup TTL. If startNew awaits the handover
      // LLM call before creating the session, a slow LLM response expires the TTL
      // and the webview never learns about the new session. This test asserts the
      // session is created *before* the handover resolves, guaranteeing the SSE
      // event fires while the TTL is still fresh.
      const seeded = await seed({ text: "1. Build" })

      let createdAt: number | undefined
      let handoverResolvedAt: number | undefined
      const unsub = subscribe(Session.Event.Created, (event) => {
        // Ignore the seeded planning session; we only care about the follow-up.
        if (event.properties.info.id === seeded.sessionID) return
        if (createdAt === undefined) createdAt = performance.now()
      })

      const deferred = Promise.withResolvers<string>()
      const agentSpy = spyOn(PlanFollowupRuntime, "agent").mockResolvedValue(fakeAgent as any)
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockResolvedValue(fakeModel)
      const handoverSpy = spyOn(PlanFollowupRuntime, "handover").mockImplementation(() =>
        deferred.promise.then((text) => {
          handoverResolvedAt = performance.now()
          return text
        }),
      )
      const loop = spyOn(PlanFollowupRuntime, "loop").mockResolvedValue({
        info: {
          id: MessageID.make("msg_test"),
          role: "assistant",
          sessionID: SessionID.make("ses_test"),
          time: { created: Date.now() },
          parentID: MessageID.make("msg_parent"),
          modelID: ModelV2.ID.make("test"),
          providerID: ProviderV2.ID.make("test"),
          mode: "code",
          agent: "code",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
        parts: [],
      } as MessageV2.WithParts)
      using _ = {
        [Symbol.dispose]() {
          agentSpy.mockRestore()
          modelSpy.mockRestore()
          handoverSpy.mockRestore()
          loop.mockRestore()
          unsub()
        },
      }

      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_NEW_SESSION]],
      })

      // Poll until session.created fires. With the fix, this happens promptly
      // because Session.create runs before generateHandover. Without the fix,
      // startNew would still be blocked on the deferred LLM stream.
      for (let i = 0; i < 100; i++) {
        if (createdAt !== undefined) break
        await Bun.sleep(10)
      }
      expect(createdAt).toBeDefined()
      // Handover must still be pending; if it had resolved, the race is open.
      expect(handoverResolvedAt).toBeUndefined()

      deferred.resolve("## Discoveries\n\nexample")
      await expect(pending).resolves.toBe("break")

      expect(handoverResolvedAt).toBeDefined()
      expect(createdAt!).toBeLessThan(handoverResolvedAt!)
    }))

  test("ask - injects plan-file message before generateHandover resolves on Start new session", () =>
    withInstance(async () => {
      // Regression guard: the plan-file handoff must appear in the new session tab
      // immediately after the tab switch without waiting for the slow handover LLM
      // call. The handover is then appended to the same part in-place.
      const seeded = await seed({ text: "1. Build" })

      let followup: SessionID | undefined
      const unsub = subscribe(Session.Event.Created, (event) => {
        if (event.properties.info.id === seeded.sessionID) return
        if (!followup) followup = event.properties.info.id
      })

      const deferred = Promise.withResolvers<string>()
      const agentSpy = spyOn(PlanFollowupRuntime, "agent").mockResolvedValue(fakeAgent as any)
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockResolvedValue(fakeModel)
      const handoverSpy = spyOn(PlanFollowupRuntime, "handover").mockImplementation(() => deferred.promise)
      const loop = spyOn(PlanFollowupRuntime, "loop").mockResolvedValue({
        info: {
          id: MessageID.make("msg_test"),
          role: "assistant",
          sessionID: SessionID.make("ses_test"),
          time: { created: Date.now() },
          parentID: MessageID.make("msg_parent"),
          modelID: ModelV2.ID.make("test"),
          providerID: ProviderV2.ID.make("test"),
          mode: "code",
          agent: "code",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [],
      } as MessageV2.WithParts)
      using _ = {
        [Symbol.dispose]() {
          agentSpy.mockRestore()
          modelSpy.mockRestore()
          handoverSpy.mockRestore()
          loop.mockRestore()
          unsub()
        },
      }

      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_NEW_SESSION]],
      })

      // Poll until the plan text lands. Handover is still pending because
      // deferred has not resolved yet.
      for (let i = 0; i < 100; i++) {
        if (followup) {
          const msgs = await store.messages({ sessionID: followup })
          const user = msgs.find((m) => m.info.role === "user")
          const part = user?.parts.find((p) => p.type === "text")
          if (part?.type === "text" && part.text.includes("Read this file first")) break
        }
        await Bun.sleep(10)
      }

      expect(followup).toBeDefined()
      if (!followup) return
      const initial = await store.messages({ sessionID: followup })
      const initialUser = initial.find((m) => m.info.role === "user")
      const initialPart = initialUser?.parts.find((p) => p.type === "text")
      expect(initialPart?.type).toBe("text")
      if (initialPart?.type !== "text") return
      expect(initialPart.text).toContain("Plan file:")
      expect(initialPart.text).toContain("Read this file first and treat it as the source of truth for implementation.")
      expect(initialPart.text).not.toContain("Implement the following plan:")
      expect(initialPart.text).not.toContain("1. Build")
      // Handover is still deferred — must not be present yet.
      expect(initialPart.text).not.toContain("## Handover from Planning Session")

      deferred.resolve("## Discoveries\n\nexample")
      await expect(pending).resolves.toBe("break")

      // Same part ID updated in-place — handover section now present.
      const final = await store.messages({ sessionID: followup })
      const finalUser = final.find((m) => m.info.role === "user")
      const finalPart = finalUser?.parts.find((p) => p.type === "text")
      if (finalPart?.type !== "text") return
      expect(finalPart.id).toBe(initialPart.id)
      expect(finalPart.text).toContain("Read this file first and treat it as the source of truth for implementation.")
      expect(finalPart.text).not.toContain("Implement the following plan:")
      expect(finalPart.text).toContain("## Handover from Planning Session")
      expect(finalPart.text).toContain("example")
    }))

  test("ask - marks new session busy while handover is pending and clears on abort", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "1. Build" })

      let followup: SessionID | undefined
      const states: Array<{ sessionID: SessionID; type: string }> = []
      const created = subscribe(Session.Event.Created, (event) => {
        if (event.properties.info.id === seeded.sessionID) return
        if (!followup) followup = event.properties.info.id
      })
      const status = subscribe(SessionStatus.Event.Status, (event) => {
        states.push({ sessionID: event.properties.sessionID, type: event.properties.status.type })
      })

      const deferred = Promise.withResolvers<string>()
      const agentSpy = spyOn(PlanFollowupRuntime, "agent").mockResolvedValue(fakeAgent as any)
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockResolvedValue(fakeModel)
      const handoverSpy = spyOn(PlanFollowupRuntime, "handover").mockImplementation(() => deferred.promise)
      const loop = spyOn(PlanFollowupRuntime, "loop").mockResolvedValue({
        info: {
          id: MessageID.make("msg_test"),
          role: "assistant",
          sessionID: SessionID.make("ses_test"),
          time: { created: Date.now() },
          parentID: MessageID.make("msg_parent"),
          modelID: ModelV2.ID.make("test"),
          providerID: ProviderV2.ID.make("test"),
          mode: "code",
          agent: "code",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [],
      } as MessageV2.WithParts)
      using _ = {
        [Symbol.dispose]() {
          agentSpy.mockRestore()
          modelSpy.mockRestore()
          handoverSpy.mockRestore()
          loop.mockRestore()
          created()
          status()
        },
      }

      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [[PlanFollowup.ANSWER_NEW_SESSION]],
      })

      for (let i = 0; i < 100; i++) {
        if (followup && states.some((x) => x.sessionID === followup && x.type === "busy")) break
        await Bun.sleep(10)
      }

      expect(followup).toBeDefined()
      if (!followup) return
      const sid = followup
      expect(states.some((x) => x.sessionID === sid && x.type === "busy")).toBe(true)

      const { SessionPrompt } = await import("../../src/session/prompt")
      await Effect.runPromise(
        SessionPrompt.Service.use((svc) => svc.cancel(sid)).pipe(
          Effect.provide(SessionPrompt.defaultLayer),
          Effect.scoped,
        ),
      )
      deferred.resolve("## Discoveries\n\nexample")
      await expect(pending).resolves.toBe("break")

      expect(states.some((x) => x.sessionID === followup && x.type === "idle")).toBe(true)
      expect(loop).not.toHaveBeenCalled()
    }))

  test("ask - returns break when assistant text is empty", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "   " })
      const result = await PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      expect(result).toBe("break")
      expect(await question.list()).toHaveLength(0)
    }))

  test("ask - returns break when already aborted", () =>
    withInstance(async () => {
      const abort = new AbortController()
      abort.abort()

      const result = await PlanFollowup.ask({
        question,
        sessionID: SessionID.make("ses_test"),
        messages: [],
        abort: abort.signal,
      })

      expect(result).toBe("break")
    }))

  test("ask - returns break when aborted while question is pending", () =>
    withInstance(async () => {
      const abort = new AbortController()
      const seeded = await seed({ text: "1. Step one\n2. Step two" })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: abort.signal,
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return

      abort.abort()

      await expect(pending).resolves.toBe("break")
      expect(await question.list()).toHaveLength(0)
    }))

  test("ask - returns break for blank custom answer", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const pending = PlanFollowup.ask({
        question,
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const item = await waitQuestion(seeded.sessionID)
      expect(item).toBeDefined()
      if (!item) return
      await question.reply({
        requestID: item.id,
        answers: [["   "]],
      })

      await expect(pending).resolves.toBe("break")
      expect((await store.messages({ sessionID: seeded.sessionID })).length).toBe(2)
    }))

  test("formatTodos - returns empty string for no todos", () => {
    expect(formatTodos([])).toBe("")
  })

  test("formatTodos - formats todos with status icons", () => {
    const todos: Todo.Info[] = [
      { content: "Set up project", status: "completed", priority: "high" },
      { content: "Write code", status: "in_progress", priority: "high" },
      { content: "Add tests", status: "pending", priority: "medium" },
      { content: "Dropped task", status: "cancelled", priority: "low" },
    ]
    const result = formatTodos(todos)
    expect(result).toBe("- [x] Set up project\n- [~] Write code\n- [ ] Add tests\n- [-] Dropped task")
  })

  test("generateHandover - returns empty string on LLM stream failure", () =>
    withInstance(async () => {
      const agentSpy = spyOn(PlanFollowupRuntime, "agent").mockResolvedValue(fakeAgent)
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockResolvedValue(fakeModel)
      const handoverSpy = spyOn(PlanFollowupRuntime, "handover").mockRejectedValue(new Error("provider unavailable"))
      using _ = {
        [Symbol.dispose]() {
          agentSpy.mockRestore()
          modelSpy.mockRestore()
          handoverSpy.mockRestore()
        },
      }
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const result = await generateHandover({ messages: seeded.messages, model })
      expect(result).toBe("")
    }))

  test("generateHandover - returns empty string on text stream rejection", () =>
    withInstance(async () => {
      const agentSpy = spyOn(PlanFollowupRuntime, "agent").mockResolvedValue(fakeAgent)
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockResolvedValue(fakeModel)
      const handoverSpy = spyOn(PlanFollowupRuntime, "handover").mockRejectedValue(new Error("stream aborted"))
      using _ = {
        [Symbol.dispose]() {
          agentSpy.mockRestore()
          modelSpy.mockRestore()
          handoverSpy.mockRestore()
        },
      }
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const result = await generateHandover({ messages: seeded.messages, model })
      expect(result).toBe("")
    }))

  test("generateHandover - uses fallback agent when compaction agent is not configured", () =>
    withInstance(async () => {
      using mocks = mockHandoverDeps("## Discoveries\n\nFallback works", { agent: null })
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const result = await generateHandover({ messages: seeded.messages, model })
      expect(result).toBe("## Discoveries\n\nFallback works")
      expect(mocks.agentSpy).toHaveBeenCalledWith("compaction")
      expect(mocks.handoverSpy).toHaveBeenCalledTimes(1)
    }))

  test("generateHandover - returns LLM output on success", () =>
    withInstance(async () => {
      using mocks = mockHandoverDeps("## Discoveries\n\nKey finding here")
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const result = await generateHandover({ messages: seeded.messages, model })
      expect(result).toBe("## Discoveries\n\nKey finding here")
      expect(mocks.handoverSpy).toHaveBeenCalledTimes(1)
    }))
})
