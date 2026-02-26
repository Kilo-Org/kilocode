import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { PlanFollowup } from "../../src/kilocode/plan-followup"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
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
  text?: string
  agent?: string
  tools?: Array<{ tool: string; input: Record<string, unknown>; output: string }>
  finish?: string
}) {
  const session = await Session.create({})
  const user = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: session.id,
    time: { created: Date.now() },
    agent: input.agent ?? "plan",
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
  await Session.updateMessage(assistant)
  if (input.text !== undefined) {
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: assistant.id,
      sessionID: session.id,
      type: "text",
      text: input.text,
    })
  }

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
  return { sessionID: session.id, messages }
}

async function waitQuestion(sessionID: string) {
  for (let i = 0; i < 50; i++) {
    const list = await Question.list()
    const question = list.find((item) => item.sessionID === sessionID)
    if (question) return question
    await Bun.sleep(10)
  }
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
            output: "Plan is ready at .opencode/plans/plan.md. Ending planning turn.",
          },
        ],
      })
      expect(SessionPrompt.shouldAskPlanFollowup({ messages: seeded.messages, abort: AbortSignal.any([]) })).toBe(true)

      const pending = PlanFollowup.ask({
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const question = await waitQuestion(seeded.sessionID)
      expect(question).toBeDefined()
      if (!question) return
      expect(question.questions[0].header).toBe("Implement")
      await Question.reject(question.id)
      await expect(pending).resolves.toBe("break")
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
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const question = await waitQuestion(seeded.sessionID)
      expect(question).toBeDefined()
      if (!question) return
      await Question.reply({
        requestID: question.id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })

      await expect(pending).resolves.toBe("continue")

      const messages = await Session.messages({ sessionID: seeded.sessionID })
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
      const list = await Question.list()
      expect(list).toHaveLength(0)
    }))

  test("plan_exit with non-completed status does NOT trigger", () =>
    withInstance(async () => {
      const session = await Session.create({})
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: session.id,
        time: { created: Date.now() },
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
      await Session.updateMessage(assistant)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: assistant.id,
        sessionID: session.id,
        type: "text",
        text: "Here is the plan",
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
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

      const messages = await Session.messages({ sessionID: session.id })

      // Verify the tool part IS present but errored (not completed)
      const toolPart = messages.flatMap((msg) => msg.parts).find((p) => p.type === "tool" && p.tool === "plan_exit")
      expect(toolPart).toBeDefined()
      expect(toolPart!.type === "tool" && toolPart!.state.status).toBe("error")

      // Use the shared predicate — errored plan_exit should not trigger
      expect(SessionPrompt.shouldAskPlanFollowup({ messages, abort: AbortSignal.any([]) })).toBe(false)

      // Confirm no questions were posted
      const list = await Question.list()
      expect(list).toHaveLength(0)
    }))

  test("plan_exit on earlier assistant message triggers when later message has text only", () =>
    withInstance(async () => {
      const session = await Session.create({})
      // Use explicit timestamps to ensure deterministic message ordering
      const now = Date.now()
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: session.id,
        time: { created: now },
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

      // First assistant message: has plan_exit tool, finish = tool-calls
      const assistant1: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
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
      await Session.updateMessage(assistant1)
      await Session.updatePart({
        id: Identifier.ascending("part"),
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
        id: Identifier.ascending("message"),
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
      await Session.updateMessage(assistant2)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: assistant2.id,
        sessionID: session.id,
        type: "text",
        text: "The plan is complete. I've called plan_exit.",
      })

      const messages = await Session.messages({ sessionID: session.id })
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

      const session = await Session.get(seeded.sessionID)
      const plan = Session.plan(session)
      await fs.mkdir(path.dirname(plan), { recursive: true })
      await Bun.write(plan, "Do implementation step 1")

      const pending = PlanFollowup.ask({
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const question = await waitQuestion(seeded.sessionID)
      expect(question).toBeDefined()
      if (!question) return
      await Question.reply({
        requestID: question.id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })
      await expect(pending).resolves.toBe("continue")
    }))

  test("PlanFollowup.ask shows prompt when plan text is on earlier assistant and last assistant is empty", () =>
    withInstance(async () => {
      const session = await Session.create({})
      // Use explicit timestamps to ensure deterministic message ordering
      const now = Date.now()
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: session.id,
        time: { created: now },
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

      // First assistant message: has plan text + plan_exit tool
      const assistant1: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
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
      await Session.updateMessage(assistant1)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: assistant1.id,
        sessionID: session.id,
        type: "text",
        text: "Here is the detailed plan:\n\n## Step 1\nDo something\n\n## Step 2\nDo something else",
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
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
        id: Identifier.ascending("message"),
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
      await Session.updateMessage(assistant2)

      const messages = await Session.messages({ sessionID: session.id })

      // shouldAskPlanFollowup should detect plan_exit on the earlier message
      expect(SessionPrompt.shouldAskPlanFollowup({ messages, abort: AbortSignal.any([]) })).toBe(true)

      // PlanFollowup.ask should find plan text from the earlier assistant and show prompt
      const pending = PlanFollowup.ask({
        sessionID: session.id,
        messages,
        abort: AbortSignal.any([]),
      })

      const question = await waitQuestion(session.id)
      expect(question).toBeDefined()
      if (!question) return
      expect(question.questions[0].header).toBe("Implement")
      await Question.reply({
        requestID: question.id,
        answers: [[PlanFollowup.ANSWER_CONTINUE]],
      })
      await expect(pending).resolves.toBe("continue")
    }))
})
