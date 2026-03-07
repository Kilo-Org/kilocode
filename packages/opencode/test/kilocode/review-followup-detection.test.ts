import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
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
  agent: string
  tools?: Array<{ tool: string; status?: MessageV2.ToolPart["state"]["status"] }>
}) {
  const session = await Session.create({})
  const user = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: session.id,
    time: { created: Date.now() },
    agent: input.agent,
    model,
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: user.id,
    sessionID: session.id,
    type: "text",
    text: "Do the work",
  })

  const assistant: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    role: "assistant",
    sessionID: session.id,
    time: { created: Date.now() },
    parentID: user.id,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: input.agent,
    agent: input.agent,
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
    finish: "end_turn",
  }
  await Session.updateMessage(assistant)

  for (const tool of input.tools ?? []) {
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: assistant.id,
      sessionID: session.id,
      type: "tool",
      callID: Identifier.ascending("tool"),
      tool: tool.tool,
      state:
        tool.status === "error"
          ? {
              status: "error",
              error: "boom",
              input: {},
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            }
          : {
              status: "completed",
              input: {},
              output: "ok",
              title: tool.tool,
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            },
    } satisfies MessageV2.ToolPart)
  }

  return Session.messages({ sessionID: session.id })
}

describe("review follow-up detection", () => {
  test("triggers for completed code turn with implementation tool", () =>
    withInstance(async () => {
      const messages = await seed({
        agent: "code",
        tools: [{ tool: "edit" }],
      })
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(true)
    }))

  test("triggers for orchestrator turns with task tool", () =>
    withInstance(async () => {
      const messages = await seed({
        agent: "orchestrator",
        tools: [{ tool: "task" }],
      })
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(true)
    }))

  test("does not trigger for read-only turns", () =>
    withInstance(async () => {
      const messages = await seed({
        agent: "code",
        tools: [{ tool: "read" }],
      })
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(false)
    }))

  test("does not trigger for non-implementation agents", () =>
    withInstance(async () => {
      const messages = await seed({
        agent: "ask",
        tools: [{ tool: "edit" }],
      })
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(false)
    }))

  test("does not trigger when plan_exit exists in same turn", () =>
    withInstance(async () => {
      const messages = await seed({
        agent: "code",
        tools: [{ tool: "edit" }, { tool: "plan_exit" }],
      })
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(false)
    }))

  test("does not trigger when implementation tool fails", () =>
    withInstance(async () => {
      const messages = await seed({
        agent: "code",
        tools: [{ tool: "edit", status: "error" }],
      })
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(false)
    }))
})
