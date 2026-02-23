import { describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { TuiEvent } from "../../src/cli/cmd/tui/event"
import { Identifier } from "../../src/id/id"
import { formatTodos, generateHandover, PlanFollowup } from "../../src/kilocode/plan-followup"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { Todo } from "../../src/session/todo"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const model = {
  providerID: "openai",
  modelID: "gpt-4",
}

async function withInstance(fn: () => Promise<void>) {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({ directory: tmp.path, fn })
}

async function seed(input: {
  text: string
  tools?: Array<{ tool: string; input: Record<string, unknown>; output: string }>
}) {
  const session = await Session.create({})
  const user = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: session.id,
    time: {
      created: Date.now(),
    },
    agent: "plan",
    model,
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: user.id,
    sessionID: session.id,
    type: "text",
    text: "Create a plan",
  })

  const assistant: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
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
    id: Identifier.ascending("part"),
    messageID: assistant.id,
    sessionID: session.id,
    type: "text",
    text: input.text,
  })

  for (const t of input.tools ?? []) {
    await Session.updatePart({
      id: Identifier.ascending("part"),
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

async function latestUser(sessionID: string) {
  const messages = await Session.messages({ sessionID })
  return messages
    .slice()
    .reverse()
    .find((item) => item.info.role === "user")
}

async function sessions() {
  return Array.fromAsync(Session.list())
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

function mockHandoverDeps(text: string, opts?: { agent?: Agent.Info | null }) {
  const agentSpy = spyOn(Agent, "get").mockResolvedValue(
    (opts?.agent === null ? undefined : (opts?.agent ?? fakeAgent)) as any,
  )
  const modelSpy = spyOn(Provider, "getModel").mockResolvedValue(fakeModel)
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

      const list = await Question.list()
      expect(list).toHaveLength(1)
      await Question.reject(list[0].id)

      await expect(pending).resolves.toBe("break")
    }))

  test("ask - returns continue and creates code message on Continue here", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const pending = PlanFollowup.ask({
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const list = await Question.list()
      await Question.reply({
        requestID: list[0].id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })

      await expect(pending).resolves.toBe("continue")

      const user = await latestUser(seeded.sessionID)
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") return
      expect(user.info.agent).toBe("code")

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

      await Question.reply({
        requestID: (await Question.list())[0].id,
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
      const loop = spyOn(SessionPrompt, "loop").mockResolvedValue({
        info: {
          id: "msg_test",
          role: "assistant",
          sessionID: "ses_test",
          time: {
            created: Date.now(),
          },
          parentID: "msg_parent",
          modelID: "test",
          providerID: "test",
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
      using _mocks = mockHandoverDeps(
        "## Discoveries\n\nFound REST endpoints in src/api.ts\n\n## Relevant Files\n\n- src/api.ts: REST endpoints\n- src/db.ts: Database layer",
      )
      using _loop = {
        [Symbol.dispose]() {
          loop.mockRestore()
        },
      }
      const seeded = await seed({
        text: "1. Add API\n2. Add tests",
      })

      await Todo.update({
        sessionID: seeded.sessionID,
        todos: [
          { content: "Add API endpoint", status: "completed", priority: "high" },
          { content: "Write tests", status: "pending", priority: "medium" },
        ],
      })

      const before = await sessions()
      const created = [] as string[]
      const unsub = Bus.subscribe(TuiEvent.SessionSelect, (event) => {
        created.push(event.properties.sessionID)
      })

      const pending = PlanFollowup.ask({
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      await Question.reply({
        requestID: (await Question.list())[0].id,
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
      expect(added[0].id).toBe(newSessionID)
      const messages = await Session.messages({ sessionID: newSessionID })
      const user = messages.find((item) => item.info.role === "user")
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") throw new Error("expected seeded user message")
      expect(user.info.agent).toBe("code")

      const part = user.parts.find((item) => item.type === "text")
      expect(part?.type).toBe("text")
      if (!part || part.type !== "text") throw new Error("expected text part")
      expect(part.text).toContain("Implement the following plan:")
      expect(part.text).toContain("1. Add API\n2. Add tests")
      expect(part.text).toContain("## Handover from Planning Session")
      expect(part.text).toContain("Found REST endpoints in src/api.ts")
      expect(part.text).toContain("## Todo List")
      expect(part.text).toContain("[x] Add API endpoint")
      expect(part.text).toContain("[ ] Write tests")
      expect(part.synthetic).toBe(false)

      const newTodos = await Todo.get(newSessionID)
      expect(newTodos).toHaveLength(2)
      expect(newTodos).toContainEqual({ content: "Add API endpoint", status: "completed", priority: "high" })
      expect(newTodos).toContainEqual({ content: "Write tests", status: "pending", priority: "medium" })

      SessionPrompt.cancel(newSessionID)
    }))

  test("ask - new session omits handover section when LLM returns empty", () =>
    withInstance(async () => {
      const loop = spyOn(SessionPrompt, "loop").mockResolvedValue({
        info: {
          id: "msg_test",
          role: "assistant",
          sessionID: "ses_test",
          time: { created: Date.now() },
          parentID: "msg_parent",
          modelID: "test",
          providerID: "test",
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
      const created = [] as string[]
      const unsub = Bus.subscribe(TuiEvent.SessionSelect, (event) => {
        created.push(event.properties.sessionID)
      })

      const pending = PlanFollowup.ask({
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      await Question.reply({
        requestID: (await Question.list())[0].id,
        answers: [[PlanFollowup.ANSWER_NEW_SESSION]],
      })

      await expect(pending).resolves.toBe("break")
      unsub()

      const messages = await Session.messages({ sessionID: created[0] })
      const user = messages.find((item) => item.info.role === "user")
      if (!user || user.info.role !== "user") throw new Error("expected user message")
      const part = user.parts.find((item) => item.type === "text")
      if (!part || part.type !== "text") throw new Error("expected text part")
      expect(part.text).toContain("Implement the following plan:")
      expect(part.text).not.toContain("## Handover from Planning Session")
      expect(part.text).not.toContain("## Todo List")

      SessionPrompt.cancel(created[0])
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
      expect(await Question.list()).toHaveLength(0)
    }))

  test("ask - returns break when already aborted", () =>
    withInstance(async () => {
      const abort = new AbortController()
      abort.abort()

      const result = await PlanFollowup.ask({
        sessionID: "ses_test",
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

      const list = await Question.list()
      expect(list).toHaveLength(1)

      abort.abort()

      await expect(pending).resolves.toBe("break")
      expect(await Question.list()).toHaveLength(0)
    }))

  test("ask - returns break for blank custom answer", () =>
    withInstance(async () => {
      const seeded = await seed({ text: "1. Build\n2. Test" })
      const pending = PlanFollowup.ask({
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      await Question.reply({
        requestID: (await Question.list())[0].id,
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
      const agentSpy = spyOn(Agent, "get").mockResolvedValue(fakeAgent)
      const modelSpy = spyOn(Provider, "getModel").mockResolvedValue(fakeModel)
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
      const agentSpy = spyOn(Agent, "get").mockResolvedValue(fakeAgent)
      const modelSpy = spyOn(Provider, "getModel").mockResolvedValue(fakeModel)
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
