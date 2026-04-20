import { describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { TuiEvent } from "../../src/cli/cmd/tui/event"
import { Identifier } from "../../src/id/id"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { formatTodos, generateHandover, PlanFollowup, PlanFollowupRuntime } from "../../src/kilocode/plan-followup"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Todo } from "../../src/session/todo"
import { Global } from "../../src/global"
import { Log } from "../../src/util/log"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })
process.env.KILO_CLIENT = "cli"

const question = {
  list() {
    return AppRuntime.runPromise(Question.Service.use((svc) => svc.list()))
  },
  reply(input: Parameters<Question.Interface["reply"]>[0]) {
    return AppRuntime.runPromise(Question.Service.use((svc) => svc.reply(input)))
  },
  reject(requestID: Parameters<Question.Interface["reject"]>[0]) {
    return AppRuntime.runPromise(Question.Service.use((svc) => svc.reject(requestID)))
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

const model = {
  providerID: ProviderID.make("openai"),
  modelID: ModelID.make("gpt-4"),
}

const saved = {
  providerID: ProviderID.make("openai"),
  modelID: ModelID.make("gpt-5"),
}

const savedVar = "high"

const config = {
  providerID: ProviderID.make("openai"),
  modelID: ModelID.make("gpt-4.1"),
}

const configVar = "max"
const planVar = "medium"

const statePath = path.join(Global.Path.state, "model.json")
const savedKey = `${saved.providerID}/${saved.modelID}`

async function withInstance(fn: () => Promise<void>) {
  await using tmp = await tmpdir({ git: true })
  await fs.rm(statePath, { force: true }).catch(() => {})
  await Instance.provide({
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
  const session = await Session.create({})
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: session.id,
    time: {
      created: Date.now(),
    },
    agent: "plan",
    model: input.variant ? { ...model, variant: input.variant } : model,
  })
  await Session.updatePart({
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
  await Session.updateMessage(assistant)
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID: session.id,
    type: "text",
    text: input.text,
  })

  for (const t of input.tools ?? []) {
    await Session.updatePart({
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

  const messages = await Session.messages({ sessionID: session.id })
  return {
    sessionID: session.id,
    messages,
  }
}

async function latestUser(sessionID: SessionID) {
  const messages = await Session.messages({ sessionID })
  return messages
    .slice()
    .reverse()
    .find((item) => item.info.role === "user")
}

async function sessions() {
  return Array.fromAsync(Session.list())
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
  const llmSpy = spyOn(LLM, "stream").mockResolvedValue({
    text: Promise.resolve(text),
  } as any)
  return {
    agentSpy,
    modelSpy,
    llmSpy,
    [Symbol.dispose]() {
      agentSpy.mockRestore()
      modelSpy.mockRestore()
      llmSpy.mockRestore()
    },
  }
}

describe("plan follow-up", () => {
  test("ask - returns break when dismissed", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "1. Step one\n2. Step two" })
      const pending = PlanFollowup.ask({
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

  test("ask - returns continue and creates plan message for custom text", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const pending = PlanFollowup.ask({
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
          modelID: ModelID.make("test"),
          providerID: ProviderID.make("test"),
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
      const llmSpy = spyOn(LLM, "stream").mockResolvedValue({
        text: Promise.resolve(
          "## Discoveries\n\nFound REST endpoints in src/api.ts\n\n## Relevant Files\n\n- src/api.ts: REST endpoints\n- src/db.ts: Database layer",
        ),
      } as any)
      using _mocks = {
        llmSpy,
        [Symbol.dispose]() {
          modelSpy.mockRestore()
          llmSpy.mockRestore()
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
      const unsub = Bus.subscribe(TuiEvent.SessionSelect, (event) => {
        created.push(event.properties.sessionID)
      })

      const pending = PlanFollowup.ask({
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
      expect(_mocks.llmSpy).toHaveBeenCalledTimes(1)

      const newSessionID = created[0]
      const next = added[0]
      if (!newSessionID || !next) throw new Error("expected follow-up session")
      expect(next.id).toBe(newSessionID)
      expect(next.parentID).toBeUndefined()
      const planPath = Session.plan(await Session.get(seeded.sessionID))
      const messages = await Session.messages({ sessionID: newSessionID })
      const user = messages.find((item) => item.info.role === "user")
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") throw new Error("expected seeded user message")
      expect(user.info.agent).toBe("code")
      expect(user.info.model).toEqual({ ...saved, variant: configVar })

      const part = user.parts.find((item) => item.type === "text")
      expect(part?.type).toBe("text")
      if (!part || part.type !== "text") throw new Error("expected text part")
      expect(part.text).toContain("Implement the following plan:")
      expect(part.text).toContain(`Plan file: ${planPath}`)
      expect(part.text).toContain("1. Add API\n2. Add tests")
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
      const llmSpy = spyOn(LLM, "stream").mockResolvedValue({
        text: Promise.resolve(""),
      } as any)
      const loop = spyOn(PlanFollowupRuntime, "loop").mockResolvedValue({
        info: {
          id: MessageID.make("msg_test"),
          role: "assistant",
          sessionID: SessionID.make("ses_test"),
          time: { created: Date.now() },
          parentID: MessageID.make("msg_parent"),
          modelID: ModelID.make("test"),
          providerID: ProviderID.make("test"),
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
          llmSpy.mockRestore()
          loop.mockRestore()
        },
      }

      const dir = other.path

      const seeded = await Instance.provide({
        directory: dir,
        fn: async () => seed({ text: "1. Add API\n2. Add tests" }),
      })

      const before = await Instance.provide({
        directory: dir,
        fn: async () => sessions(),
      })
      const pending = PlanFollowup.ask({
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
      const after = await Instance.provide({
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
        const planPath = await Instance.provide({
          directory: dir,
          fn: async () => Session.plan(await Session.get(seeded.sessionID)),
        })
        const messages = await Session.messages({ sessionID: next.id })
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
      await writeState({ model: { code: { providerID: ProviderID.make("missing"), modelID: ModelID.make("ghost") } } })
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
          modelID: ModelID.make("test"),
          providerID: ProviderID.make("test"),
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
      const unsub = Bus.subscribe(TuiEvent.SessionSelect, (event) => {
        created.push(event.properties.sessionID)
      })

      const pending = PlanFollowup.ask({
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
      const messages = await Session.messages({ sessionID: newSessionID })
      const user = messages.find((item) => item.info.role === "user")
      if (!user || user.info.role !== "user") throw new Error("expected user message")
      const part = user.parts.find((item) => item.type === "text")
      if (!part || part.type !== "text") throw new Error("expected text part")
      expect(part.text).toContain("Implement the following plan:")
      expect(part.text).not.toContain("## Handover from Planning Session")
      expect(part.text).not.toContain("## Todo List")
    }))

  test("ask - returns break when assistant text is empty", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "   " })
      const result = await PlanFollowup.ask({
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
      expect((await Session.messages({ sessionID: seeded.sessionID })).length).toBe(2)
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

  test("generateHandover - returns empty string on LLM.stream failure", () =>
    withInstance(async () => {
      const agentSpy = spyOn(PlanFollowupRuntime, "agent").mockResolvedValue(fakeAgent)
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockResolvedValue(fakeModel)
      const llmSpy = spyOn(LLM, "stream").mockRejectedValue(new Error("provider unavailable"))
      using _ = {
        [Symbol.dispose]() {
          agentSpy.mockRestore()
          modelSpy.mockRestore()
          llmSpy.mockRestore()
        },
      }
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const result = await generateHandover({ messages: seeded.messages, model })
      expect(result).toBe("")
    }))

  test("generateHandover - returns empty string on stream.text rejection", () =>
    withInstance(async () => {
      const agentSpy = spyOn(PlanFollowupRuntime, "agent").mockResolvedValue(fakeAgent)
      const modelSpy = spyOn(PlanFollowupRuntime, "model").mockResolvedValue(fakeModel)
      const textPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("stream aborted")), 0)
      })
      textPromise.catch(() => {})
      const llmSpy = spyOn(LLM, "stream").mockResolvedValue({
        text: textPromise,
      } as any)
      using _ = {
        [Symbol.dispose]() {
          agentSpy.mockRestore()
          modelSpy.mockRestore()
          llmSpy.mockRestore()
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
      expect(mocks.llmSpy).toHaveBeenCalledTimes(1)
    }))

  test("generateHandover - returns LLM output on success", () =>
    withInstance(async () => {
      using mocks = mockHandoverDeps("## Discoveries\n\nKey finding here")
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const result = await generateHandover({ messages: seeded.messages, model })
      expect(result).toBe("## Discoveries\n\nKey finding here")
      expect(mocks.llmSpy).toHaveBeenCalledTimes(1)
    }))
})
