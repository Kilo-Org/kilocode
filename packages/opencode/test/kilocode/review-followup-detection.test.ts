import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { PlanFollowup } from "../../src/kilocode/plan-followup"
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

async function seedTwoImplementationTurns() {
  const session = await Session.create({})

  const firstUser = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: session.id,
    time: { created: Date.now() },
    agent: "code",
    model,
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: firstUser.id,
    sessionID: session.id,
    type: "text",
    text: "Implement first step",
  })

  const firstAssistant: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    role: "assistant",
    sessionID: session.id,
    time: { created: Date.now() },
    parentID: firstUser.id,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "code",
    agent: "code",
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
  await Session.updateMessage(firstAssistant)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: firstAssistant.id,
    sessionID: session.id,
    type: "tool",
    callID: Identifier.ascending("tool"),
    tool: "edit",
    state: {
      status: "completed",
      input: {},
      output: "ok",
      title: "edit",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
    },
  } satisfies MessageV2.ToolPart)

  const secondUser = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: session.id,
    time: { created: Date.now() },
    agent: "code",
    model,
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: secondUser.id,
    sessionID: session.id,
    type: "text",
    text: "Implement second step",
  })

  const secondAssistant: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    role: "assistant",
    sessionID: session.id,
    time: { created: Date.now() },
    parentID: secondUser.id,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "code",
    agent: "code",
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
  await Session.updateMessage(secondAssistant)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: secondAssistant.id,
    sessionID: session.id,
    type: "tool",
    callID: Identifier.ascending("tool"),
    tool: "write",
    state: {
      status: "completed",
      input: {},
      output: "ok",
      title: "write",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
    },
  } satisfies MessageV2.ToolPart)

  return Session.messages({ sessionID: session.id })
}

async function seedPlanThenImplementation() {
  const session = await Session.create({})

  // Turn 1: plan turn that ends with plan_exit
  const planUser = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: session.id,
    time: { created: Date.now() },
    agent: "code",
    model,
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: planUser.id,
    sessionID: session.id,
    type: "text",
    text: "Plan the feature",
  })

  const planAssistant: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    role: "assistant",
    sessionID: session.id,
    time: { created: Date.now() },
    parentID: planUser.id,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "code",
    agent: "code",
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
  await Session.updateMessage(planAssistant)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: planAssistant.id,
    sessionID: session.id,
    type: "tool",
    callID: Identifier.ascending("tool"),
    tool: "plan_exit",
    state: {
      status: "completed",
      input: {},
      output: "ok",
      title: "plan_exit",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
    },
  } satisfies MessageV2.ToolPart)

  // Turn 2: implementation turn with edit tool
  const implUser = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: session.id,
    time: { created: Date.now() },
    agent: "code",
    model,
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: implUser.id,
    sessionID: session.id,
    type: "text",
    text: "Implement it",
  })

  const implAssistant: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    role: "assistant",
    sessionID: session.id,
    time: { created: Date.now() },
    parentID: implUser.id,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "code",
    agent: "code",
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
  await Session.updateMessage(implAssistant)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: implAssistant.id,
    sessionID: session.id,
    type: "tool",
    callID: Identifier.ascending("tool"),
    tool: "edit",
    state: {
      status: "completed",
      input: {},
      output: "ok",
      title: "edit",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
    },
  } satisfies MessageV2.ToolPart)

  return Session.messages({ sessionID: session.id })
}

async function seedHandoverSession() {
  const session = await Session.create({})

  const user = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: session.id,
    time: { created: Date.now() },
    agent: "code",
    model,
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: user.id,
    sessionID: session.id,
    type: "text",
    text: `${PlanFollowup.PLAN_PREFIX}\n\nStep 1: do something\nStep 2: do something else`,
  })

  const assistant: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    role: "assistant",
    sessionID: session.id,
    time: { created: Date.now() },
    parentID: user.id,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "code",
    agent: "code",
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
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: assistant.id,
    sessionID: session.id,
    type: "tool",
    callID: Identifier.ascending("tool"),
    tool: "edit",
    state: {
      status: "completed",
      input: {},
      output: "ok",
      title: "edit",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
    },
  } satisfies MessageV2.ToolPart)

  return Session.messages({ sessionID: session.id })
}

describe("review follow-up detection", () => {
  test("does not trigger without plan context even with implementation tool", () =>
    withInstance(async () => {
      const messages = await seed({
        agent: "code",
        tools: [{ tool: "edit" }],
      })
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(false)
    }))

  test("does not trigger for orchestrator turns without plan context", () =>
    withInstance(async () => {
      const messages = await seed({
        agent: "orchestrator",
        tools: [{ tool: "task" }],
      })
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(false)
    }))

  test("does not trigger for orchestrator turns without implementation tools", () =>
    withInstance(async () => {
      const messages = await seed({
        agent: "orchestrator",
      })
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(false)
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

  test("does not trigger on later implementation turns in same session", () =>
    withInstance(async () => {
      const messages = await seedTwoImplementationTurns()
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(false)
    }))

  test("triggers after same-session plan_exit followed by implementation turn", () =>
    withInstance(async () => {
      const messages = await seedPlanThenImplementation()
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(true)
    }))

  test("triggers when first user message starts with plan handover prefix", () =>
    withInstance(async () => {
      const messages = await seedHandoverSession()
      expect(SessionPrompt.shouldAskReviewFollowup({ messages, abort: AbortSignal.any([]) })).toBe(true)
    }))
})
