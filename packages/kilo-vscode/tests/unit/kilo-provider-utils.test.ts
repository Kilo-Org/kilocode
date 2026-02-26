import { describe, it, expect } from "bun:test"
import {
  sessionToWebview,
  normalizeProviders,
  filterVisibleAgents,
  buildSettingPath,
  mapSSEEventToWebviewMessage,
} from "../../src/kilo-provider-utils"
import type {
  Session,
  Agent,
  Provider,
  Event,
  EventMessagePartUpdated,
  EventMessageUpdated,
  EventSessionStatus,
  EventPermissionAsked,
  EventTodoUpdated,
  EventQuestionAsked,
  EventQuestionReplied,
  EventQuestionRejected,
  EventSessionCreated,
  EventSessionUpdated,
  EventServerConnected,
  TextPart,
  AssistantMessage,
} from "@kilocode/sdk/v2/client"

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    slug: "test-session",
    projectID: "proj-1",
    directory: "/tmp",
    title: "Test Session",
    version: "1",
    time: { created: 1700000000000, updated: 1700001000000 },
    permission: [],
    ...overrides,
  }
}

function makeProvider(id: string): Provider {
  return {
    id,
    name: id.toUpperCase(),
    source: "config",
    env: [],
    options: {},
    models: {},
  }
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    name: "code",
    mode: "primary",
    permission: [],
    options: {},
    ...overrides,
  }
}

function makeTextPart(overrides: Partial<TextPart> = {}): TextPart {
  return {
    id: "p1",
    sessionID: "sess-1",
    messageID: "m1",
    type: "text",
    text: "",
    ...overrides,
  }
}

function makeAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "msg-1",
    sessionID: "sess-1",
    role: "assistant",
    time: { created: 1700000000000 },
    parentID: "parent-1",
    modelID: "model-1",
    providerID: "provider-1",
    mode: "primary",
    agent: "code",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  }
}

describe("sessionToWebview", () => {
  it("converts epoch timestamps to ISO strings", () => {
    const result = sessionToWebview(makeSession())
    expect(result.createdAt).toBe(new Date(1700000000000).toISOString())
    expect(result.updatedAt).toBe(new Date(1700001000000).toISOString())
  })

  it("preserves id and title", () => {
    const result = sessionToWebview(makeSession({ id: "abc", title: "My Session" }))
    expect(result.id).toBe("abc")
    expect(result.title).toBe("My Session")
  })

  it("produces valid ISO format", () => {
    const result = sessionToWebview(makeSession())
    expect(() => new Date(result.createdAt)).not.toThrow()
    expect(new Date(result.createdAt).getTime()).toBe(1700000000000)
  })
})

describe("normalizeProviders", () => {
  it("re-keys providers from numeric indices to provider.id", () => {
    const input = { "0": makeProvider("openai"), "1": makeProvider("anthropic") }
    const result = normalizeProviders(input as Record<string, Provider>)
    expect(result["openai"]).toBeDefined()
    expect(result["anthropic"]).toBeDefined()
    expect(result["0"]).toBeUndefined()
    expect(result["1"]).toBeUndefined()
  })

  it("handles empty input", () => {
    expect(normalizeProviders({})).toEqual({})
  })

  it("preserves provider data", () => {
    const p = makeProvider("openai")
    const result = normalizeProviders({ "0": p })
    expect(result["openai"]).toEqual(p)
  })

  it("handles already-keyed-by-id input (idempotent)", () => {
    const p = makeProvider("openai")
    const result = normalizeProviders({ openai: p })
    expect(result["openai"]).toEqual(p)
  })
})

describe("filterVisibleAgents", () => {
  it("filters out subagent mode", () => {
    const agents = [makeAgent({ name: "code", mode: "primary" }), makeAgent({ name: "sub", mode: "subagent" })]
    const { visible } = filterVisibleAgents(agents)
    expect(visible).toHaveLength(1)
    expect(visible[0]!.name).toBe("code")
  })

  it("filters out hidden agents", () => {
    const agents = [makeAgent({ name: "code" }), makeAgent({ name: "hidden", hidden: true })]
    const { visible } = filterVisibleAgents(agents)
    expect(visible).toHaveLength(1)
    expect(visible[0]!.name).toBe("code")
  })

  it("uses first visible agent as default", () => {
    const agents = [makeAgent({ name: "first" }), makeAgent({ name: "second" })]
    const { defaultAgent } = filterVisibleAgents(agents)
    expect(defaultAgent).toBe("first")
  })

  it("falls back to 'code' when no visible agents", () => {
    const agents = [makeAgent({ mode: "subagent" }), makeAgent({ hidden: true })]
    const { defaultAgent } = filterVisibleAgents(agents)
    expect(defaultAgent).toBe("code")
  })

  it("handles empty agent list", () => {
    const { visible, defaultAgent } = filterVisibleAgents([])
    expect(visible).toHaveLength(0)
    expect(defaultAgent).toBe("code")
  })

  it("passes through all modes that are primary or all", () => {
    const agents = [makeAgent({ name: "a", mode: "primary" }), makeAgent({ name: "b", mode: "all" })]
    const { visible } = filterVisibleAgents(agents)
    expect(visible).toHaveLength(2)
  })
})

describe("buildSettingPath", () => {
  it("splits single-segment key into empty section and leaf", () => {
    const { section, leaf } = buildSettingPath("enabled")
    expect(section).toBe("")
    expect(leaf).toBe("enabled")
  })

  it("splits two-segment key", () => {
    const { section, leaf } = buildSettingPath("browserAutomation.enabled")
    expect(section).toBe("browserAutomation")
    expect(leaf).toBe("enabled")
  })

  it("splits three-segment key", () => {
    const { section, leaf } = buildSettingPath("a.b.c")
    expect(section).toBe("a.b")
    expect(leaf).toBe("c")
  })

  it("handles empty-looking intermediate segments", () => {
    const { section, leaf } = buildSettingPath("foo..bar")
    expect(leaf).toBe("bar")
    expect(section).toBe("foo.")
  })
})

describe("mapSSEEventToWebviewMessage", () => {
  it("maps message.part.updated to partUpdated", () => {
    const event: EventMessagePartUpdated = {
      type: "message.part.updated",
      properties: {
        part: makeTextPart({ text: "hello" }),
      },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("partUpdated")
    if (msg?.type === "partUpdated") {
      expect(msg.sessionID).toBe("sess-1")
      expect(msg.messageID).toBe("m1")
    }
  })

  it("returns null for message.part.updated when sessionID is undefined", () => {
    const event: EventMessagePartUpdated = {
      type: "message.part.updated",
      properties: { part: makeTextPart({ text: "" }) },
    }
    expect(mapSSEEventToWebviewMessage(event, undefined)).toBeNull()
  })

  it("maps message.updated to messageCreated with ISO date", () => {
    const event: EventMessageUpdated = {
      type: "message.updated",
      properties: {
        info: makeAssistantMessage({ cost: 0.001 }),
      },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("messageCreated")
    if (msg?.type === "messageCreated") {
      expect(msg.message.createdAt).toBe(new Date(1700000000000).toISOString())
      expect(msg.message.cost).toBe(0.001)
    }
  })

  it("maps session.status idle to sessionStatus", () => {
    const event: EventSessionStatus = {
      type: "session.status",
      properties: { sessionID: "sess-1", status: { type: "idle" } },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("sessionStatus")
    if (msg?.type === "sessionStatus") {
      expect(msg.status).toBe("idle")
      expect(msg.attempt).toBeUndefined()
    }
  })

  it("maps session.status retry with attempt/message/next", () => {
    const event: EventSessionStatus = {
      type: "session.status",
      properties: {
        sessionID: "sess-1",
        status: { type: "retry", attempt: 2, message: "trying again", next: 5000 },
      },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    if (msg?.type === "sessionStatus") {
      expect(msg.attempt).toBe(2)
      expect(msg.message).toBe("trying again")
      expect(msg.next).toBe(5000)
    }
  })

  it("maps permission.asked to permissionRequest", () => {
    const event: EventPermissionAsked = {
      type: "permission.asked",
      properties: {
        id: "perm-1",
        sessionID: "sess-1",
        permission: "read_file",
        patterns: ["**/*.ts"],
        metadata: { path: "/foo" },
        always: [],
      },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("permissionRequest")
    if (msg?.type === "permissionRequest") {
      expect(msg.permission.toolName).toBe("read_file")
      expect(msg.permission.args).toEqual({ path: "/foo" })
      expect(msg.permission.message).toBe("Permission required: read_file")
      expect(msg.permission.patterns).toEqual(["**/*.ts"])
    }
  })

  it("defaults patterns to [] when not provided in permission.asked", () => {
    const event: EventPermissionAsked = {
      type: "permission.asked",
      properties: {
        id: "p1",
        sessionID: "s1",
        permission: "write_file",
        patterns: [],
        metadata: {},
        always: [],
      },
    }
    const msg = mapSSEEventToWebviewMessage(event, "s1")
    if (msg?.type === "permissionRequest") {
      expect(msg.permission.patterns).toEqual([])
    }
  })

  it("maps todo.updated to todoUpdated", () => {
    const event: EventTodoUpdated = {
      type: "todo.updated",
      properties: {
        sessionID: "sess-1",
        todos: [{ content: "do something", status: "pending", priority: "medium" }],
      },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("todoUpdated")
    if (msg?.type === "todoUpdated") {
      expect(msg.items).toHaveLength(1)
    }
  })

  it("maps question.asked to questionRequest", () => {
    const event: EventQuestionAsked = {
      type: "question.asked",
      properties: {
        id: "q1",
        sessionID: "sess-1",
        questions: [],
      },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("questionRequest")
  })

  it("maps question.replied to questionResolved", () => {
    const event: EventQuestionReplied = {
      type: "question.replied",
      properties: { sessionID: "sess-1", requestID: "req-1", answers: [] },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("questionResolved")
    if (msg?.type === "questionResolved") {
      expect(msg.requestID).toBe("req-1")
    }
  })

  it("maps question.rejected to questionResolved", () => {
    const event: EventQuestionRejected = {
      type: "question.rejected",
      properties: { sessionID: "sess-1", requestID: "req-2" },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("questionResolved")
    if (msg?.type === "questionResolved") {
      expect(msg.requestID).toBe("req-2")
    }
  })

  it("maps session.created to sessionCreated with ISO dates", () => {
    const event: EventSessionCreated = {
      type: "session.created",
      properties: { info: makeSession() },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("sessionCreated")
    if (msg?.type === "sessionCreated") {
      expect(msg.session.createdAt).toBe(new Date(1700000000000).toISOString())
    }
  })

  it("maps session.updated to sessionUpdated with ISO dates", () => {
    const event: EventSessionUpdated = {
      type: "session.updated",
      properties: { info: makeSession({ id: "sess-2" }) },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-2")
    expect(msg?.type).toBe("sessionUpdated")
  })

  it("returns null for server.connected (no webview message)", () => {
    const event: EventServerConnected = { type: "server.connected", properties: {} }
    expect(mapSSEEventToWebviewMessage(event, undefined)).toBeNull()
  })

  it("returns null for unhandled event types (Like global.disposed)", () => {
    const event: Event = { type: "global.disposed", properties: {} }
    expect(mapSSEEventToWebviewMessage(event, undefined)).toBeNull()
  })
})
