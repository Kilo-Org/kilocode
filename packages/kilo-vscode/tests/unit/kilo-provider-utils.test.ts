import { describe, it, expect } from "bun:test"
import {
  sessionToWebview,
  indexProvidersById,
  filterVisibleAgents,
  buildSettingPath,
  mapSSEEventToWebviewMessage,
  isEventFromForeignProject,
  mapCloudSessionMessageToWebviewMessage,
  MessageConfirmation,
  mergeFileSearchResults,
  getErrorMessage,
  getConfigErrorDetails,
  type ProviderInfo,
} from "../../src/kilo-provider-utils"
import { mergeFileSearchItems } from "../../src/kilo-provider/file-search-items"
import type { CloudSessionMessage } from "../../src/services/cli-backend/types"
import type {
  Session,
  Agent,
  Provider,
  Event,
  EventMessagePartUpdated,
  EventMessageUpdated,
  EventSessionStatus,
  EventPermissionAsked,
  EventPermissionReplied,
  EventTodoUpdated,
  EventQuestionAsked,
  EventQuestionReplied,
  EventQuestionRejected,
  EventSuggestionShown,
  EventSuggestionAccepted,
  EventSuggestionDismissed,
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

function makeProvider(id: string): ProviderInfo {
  return {
    id,
    name: id.toUpperCase(),
    env: [],
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

describe("MessageConfirmation", () => {
  it("reports tracked confirmed messages", async () => {
    const state = new MessageConfirmation()
    state.track("msg-1")
    state.confirm("msg-1")

    expect(state.has("msg-1")).toBe(true)
    expect(await state.wait("msg-1", 1)).toBe(true)
  })

  it("resolves waiters when a message is confirmed", async () => {
    const state = new MessageConfirmation()
    state.track("msg-1")
    const wait = state.wait("msg-1", 50)

    state.confirm("msg-1")

    expect(await wait).toBe(true)
  })

  it("returns false when confirmation does not arrive", async () => {
    const state = new MessageConfirmation()
    state.track("msg-1")

    expect(await state.wait("msg-1", 1)).toBe(false)
  })

  it("forgets confirmations after release", () => {
    const state = new MessageConfirmation()
    const release = state.track("msg-1")
    state.confirm("msg-1")

    release()

    expect(state.has("msg-1")).toBe(false)
  })
})

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

describe("indexProvidersById", () => {
  it("indexes providers by id", () => {
    const result = indexProvidersById([makeProvider("openai"), makeProvider("anthropic")])
    expect(result["openai"]).toBeDefined()
    expect(result["anthropic"]).toBeDefined()
  })

  it("handles empty input", () => {
    expect(indexProvidersById([])).toEqual({})
  })

  it("preserves provider data", () => {
    const p = makeProvider("openai")
    const result = indexProvidersById([p])
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
      expect(msg.permission.always).toEqual([])
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

  it("maps permission.replied to permissionResolved", () => {
    const event: EventPermissionReplied = {
      type: "permission.replied",
      properties: { sessionID: "sess-1", requestID: "perm-1", reply: "once" },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("permissionResolved")
    if (msg?.type === "permissionResolved") {
      expect(msg.permissionID).toBe("perm-1")
    }
  })

  it("maps permission.replied (always) to permissionResolved", () => {
    const event: EventPermissionReplied = {
      type: "permission.replied",
      properties: { sessionID: "sess-1", requestID: "perm-2", reply: "always" },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("permissionResolved")
    if (msg?.type === "permissionResolved") {
      expect(msg.permissionID).toBe("perm-2")
    }
  })

  it("maps permission.replied (reject) to permissionResolved", () => {
    const event: EventPermissionReplied = {
      type: "permission.replied",
      properties: { sessionID: "sess-1", requestID: "perm-3", reply: "reject" },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("permissionResolved")
    if (msg?.type === "permissionResolved") {
      expect(msg.permissionID).toBe("perm-3")
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
        questions: [
          {
            question: "Ready to implement?",
            header: "Implement",
            options: [{ label: "Implement", description: "Switch to code", mode: "code" }],
          },
        ],
      },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("questionRequest")
    if (msg?.type === "questionRequest") {
      const questions = msg.question.questions as Array<{ options?: Array<{ mode?: string }> }>
      expect(questions[0]?.options?.[0]?.mode).toBe("code")
    }
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

  it("maps suggestion.shown to suggestionRequest", () => {
    const event: EventSuggestionShown = {
      type: "suggestion.shown",
      properties: {
        id: "sug-1",
        sessionID: "sess-1",
        text: "Review changes?",
        actions: [{ label: "Start", prompt: "/local-review-uncommitted" }],
      },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("suggestionRequest")
  })

  it("maps suggestion.accepted to suggestionResolved", () => {
    const event: EventSuggestionAccepted = {
      type: "suggestion.accepted",
      properties: {
        sessionID: "sess-1",
        requestID: "sug-1",
        index: 0,
        action: { label: "Start", prompt: "/local-review-uncommitted" },
      },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("suggestionResolved")
  })

  it("maps suggestion.dismissed to suggestionResolved", () => {
    const event: EventSuggestionDismissed = {
      type: "suggestion.dismissed",
      properties: { sessionID: "sess-1", requestID: "sug-2" },
    }
    const msg = mapSSEEventToWebviewMessage(event, "sess-1")
    expect(msg?.type).toBe("suggestionResolved")
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

describe("isEventFromForeignProject", () => {
  const session = (projectID: string) =>
    ({
      id: "s1",
      projectID,
      title: "test",
      directory: "/workspace",
      time: { created: 0, updated: 0 },
    }) as unknown as Session

  it("drops session.created from a different project", () => {
    const event: Event = { type: "session.created", properties: { info: session("project-B") } }
    expect(isEventFromForeignProject(event, "project-A")).toBe(true)
  })

  it("drops session.updated from a different project", () => {
    const event: Event = { type: "session.updated", properties: { info: session("project-B") } }
    expect(isEventFromForeignProject(event, "project-A")).toBe(true)
  })

  it("keeps session.created from the same project", () => {
    const event: Event = { type: "session.created", properties: { info: session("project-A") } }
    expect(isEventFromForeignProject(event, "project-A")).toBe(false)
  })

  it("keeps all events when expectedProjectID is undefined", () => {
    const event: Event = { type: "session.created", properties: { info: session("project-B") } }
    expect(isEventFromForeignProject(event, undefined)).toBe(false)
  })

  it("keeps non-session events regardless of project", () => {
    const event = { type: "server.heartbeat", properties: {} } as unknown as Event
    expect(isEventFromForeignProject(event, "project-A")).toBe(false)
  })
})

describe("mapCloudSessionMessage", () => {
  function makeCloudMessage(overrides: Partial<CloudSessionMessage["info"]> = {}): CloudSessionMessage {
    return {
      info: {
        id: "msg-1",
        sessionID: "sess-1",
        role: "assistant",
        time: { created: 1700000000000, completed: 1700000005000 },
        cost: { input: 10, output: 20 },
        tokens: { input: 100, output: 200 },
        ...overrides,
      },
      parts: [{ id: "p1", sessionID: "sess-1", messageID: "msg-1", type: "text", text: "hello" }],
    }
  }

  it("maps fields to webview message format", () => {
    const msg = mapCloudSessionMessageToWebviewMessage(makeCloudMessage())
    expect(msg.id).toBe("msg-1")
    expect(msg.sessionID).toBe("sess-1")
    expect(msg.role).toBe("assistant")
    expect(msg.createdAt).toBe(new Date(1700000000000).toISOString())
    expect(msg.cost).toEqual({ input: 10, output: 20 })
    expect(msg.tokens).toEqual({ input: 100, output: 200 })
    expect(msg.parts).toHaveLength(1)
  })

  it("includes the time field with created and completed", () => {
    const msg = mapCloudSessionMessageToWebviewMessage(makeCloudMessage())
    expect(msg.time).toEqual({ created: 1700000000000, completed: 1700000005000 })
  })

  it("includes time when only created is present", () => {
    const msg = mapCloudSessionMessageToWebviewMessage(makeCloudMessage({ time: { created: 1700000000000 } }))
    expect(msg.time).toEqual({ created: 1700000000000 })
  })

  it("falls back to current date when time.created is missing", () => {
    const before = Date.now()
    const msg = mapCloudSessionMessageToWebviewMessage(makeCloudMessage({ time: undefined as never }))
    const after = Date.now()
    const createdAt = new Date(msg.createdAt).getTime()
    expect(createdAt).toBeGreaterThanOrEqual(before)
    expect(createdAt).toBeLessThanOrEqual(after)
  })

  it("maps user role correctly", () => {
    const msg = mapCloudSessionMessageToWebviewMessage(makeCloudMessage({ role: "user" }))
    expect(msg.role).toBe("user")
  })
})

describe("mergeFileSearchItems", () => {
  it("puts exact folder matches before file matches", () => {
    const result = mergeFileSearchItems({
      query: "script",
      files: ["script/hooks", "script/release", "script/beta.ts"],
      folders: ["script/", "script/run-script/"],
    })
    expect(result).toEqual([
      { path: "script/", type: "folder" },
      { path: "script/hooks", type: "file" },
      { path: "script/release", type: "file" },
      { path: "script/beta.ts", type: "file" },
      { path: "script/run-script/", type: "folder" },
    ])
  })

  it("keeps file ordering before non-prefix folder matches", () => {
    const result = mergeFileSearchItems({
      query: "test",
      files: ["src/test.ts"],
      folders: ["src/latest/"],
    })
    expect(result).toEqual([
      { path: "src/test.ts", type: "file" },
      { path: "src/latest/", type: "folder" },
    ])
  })

  it("normalizes Windows separators for matching and output", () => {
    const result = mergeFileSearchItems({
      query: "kilo-vscode",
      files: ["packages\\kilo-vscode\\src\\KiloProvider.ts"],
      folders: ["packages\\kilo-vscode\\"],
    })
    expect(result).toEqual([
      { path: "packages/kilo-vscode/", type: "folder" },
      { path: "packages/kilo-vscode/src/KiloProvider.ts", type: "file" },
    ])
  })
})

describe("mergeFileSearchResults", () => {
  it("returns backend results when no open files", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/a.ts", "src/b.ts"],
      open: new Set(),
    })
    expect(result).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("places open files before backend results", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/a.ts", "src/b.ts", "src/c.ts"],
      open: new Set(["src/c.ts", "src/d.ts"]),
    })
    expect(result).toEqual(["src/c.ts", "src/d.ts", "src/a.ts", "src/b.ts"])
  })

  it("places active file first among open files", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/a.ts"],
      open: new Set(["src/b.ts", "src/c.ts"]),
      active: "src/c.ts",
    })
    expect(result).toEqual(["src/c.ts", "src/b.ts", "src/a.ts"])
  })

  it("ignores active file when it is not in open set", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/a.ts"],
      open: new Set(["src/b.ts"]),
      active: "src/x.ts",
    })
    expect(result).toEqual(["src/b.ts", "src/a.ts"])
  })

  it("deduplicates open files from backend results", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/a.ts", "src/b.ts"],
      open: new Set(["src/a.ts"]),
    })
    expect(result).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("filters open files by query", () => {
    const result = mergeFileSearchResults({
      query: "config",
      backend: ["src/config.ts", "src/util.ts"],
      open: new Set(["src/index.ts", "src/config.ts", "README.md"]),
    })
    expect(result).toEqual(["src/config.ts", "src/util.ts"])
  })

  it("query filtering is case-insensitive", () => {
    const result = mergeFileSearchResults({
      query: "READ",
      backend: [],
      open: new Set(["README.md", "src/index.ts"]),
    })
    expect(result).toEqual(["README.md"])
  })

  it("shows all open files on empty query", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: [],
      open: new Set(["src/a.ts", "src/b.ts"]),
    })
    expect(result).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("shows all open files on whitespace-only query", () => {
    const result = mergeFileSearchResults({
      query: "  ",
      backend: ["src/x.ts"],
      open: new Set(["src/a.ts"]),
    })
    expect(result).toEqual(["src/a.ts", "src/x.ts"])
  })

  it("handles forward-slash paths (Windows-normalized)", () => {
    const result = mergeFileSearchResults({
      query: "",
      backend: ["src/utils/path.ts"],
      open: new Set(["src/utils/path.ts", "src/index.ts"]),
      active: "src/utils/path.ts",
    })
    expect(result).toEqual(["src/utils/path.ts", "src/index.ts"])
  })

  it("normalizes backslash paths before filtering and deduping", () => {
    const result = mergeFileSearchResults({
      query: "utils/path",
      backend: ["src\\utils\\path.ts"],
      open: new Set(["src/utils/path.ts"]),
      active: "src\\utils\\path.ts",
    })
    expect(result).toEqual(["src/utils/path.ts"])
  })
})

describe("getErrorMessage", () => {
  it("extracts message from an Error instance", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom")
  })

  it("returns the string as-is", () => {
    expect(getErrorMessage("plain text failure")).toBe("plain text failure")
  })

  it("reads a direct .message field", () => {
    expect(getErrorMessage({ message: "bad input" })).toBe("bad input")
  })

  it("reads a direct .error string field", () => {
    expect(getErrorMessage({ error: "nope" })).toBe("nope")
  })

  it("reads SDK throwOnError shape { error: { message } }", () => {
    expect(getErrorMessage({ error: { message: "sdk said no" } })).toBe("sdk said no")
  })

  it("reads NotFoundError shape { data: { message } }", () => {
    expect(getErrorMessage({ name: "NotFoundError", data: { message: "not found" } })).toBe("not found")
  })

  it("reads the first Zod issue message from ConfigInvalidError", () => {
    const err = {
      name: "ConfigInvalidError",
      data: {
        path: "/Users/me/.config/kilo/kilo.json",
        issues: [
          { code: "unrecognized_keys", keys: ["indexing"], path: [], message: 'Unrecognized key: "indexing"' },
          { code: "invalid_type", path: ["timeout"], message: "Expected number" },
        ],
      },
    }
    expect(getErrorMessage(err)).toBe('Unrecognized key: "indexing"')
  })

  it("reads Hono validator shape { data: { error: [{ message }] } }", () => {
    const err = { data: { error: [{ message: "required" }] }, success: false }
    expect(getErrorMessage(err)).toBe("required")
  })

  it("reads Hono validator shape with string errors", () => {
    expect(getErrorMessage({ data: { error: ["bad field"] } })).toBe("bad field")
  })

  it("reads BadRequestError shape { errors: [{ message }] }", () => {
    expect(getErrorMessage({ errors: [{ message: "first error" }, { message: "second" }] })).toBe("first error")
  })

  it("reads BadRequestError shape with string errors", () => {
    expect(getErrorMessage({ errors: ["boom"] })).toBe("boom")
  })

  it("falls back to JSON for unknown object shapes", () => {
    expect(getErrorMessage({ weird: true, code: 42 })).toBe('{"weird":true,"code":42}')
  })

  it("falls back to String() for non-serializable values", () => {
    expect(getErrorMessage(undefined)).toBe("undefined")
    expect(getErrorMessage(null)).toBe("null")
    expect(getErrorMessage(42)).toBe("42")
  })

  it("skips JSON fallback for empty objects", () => {
    expect(getErrorMessage({})).toBe("[object Object]")
  })

  it("prefers .message over nested shapes", () => {
    const err = { message: "outer", data: { issues: [{ message: "inner" }] } }
    expect(getErrorMessage(err)).toBe("outer")
  })

  it("falls through when the first issue has no message", () => {
    // firstMessage only inspects index 0, so an invalid first entry causes the
    // branch to skip and the JSON fallback kicks in.
    const err = { data: { issues: [{ code: "bad" }] } }
    expect(getErrorMessage(err)).toBe('{"data":{"issues":[{"code":"bad"}]}}')
  })
})

describe("getConfigErrorDetails", () => {
  it("returns undefined for non-object errors", () => {
    expect(getConfigErrorDetails("oops")).toBeUndefined()
    expect(getConfigErrorDetails(undefined)).toBeUndefined()
    expect(getConfigErrorDetails(null)).toBeUndefined()
    expect(getConfigErrorDetails(42)).toBeUndefined()
  })

  it("returns undefined when .data is missing", () => {
    expect(getConfigErrorDetails({ message: "hi" })).toBeUndefined()
  })

  it("returns undefined when .data has no path or issues", () => {
    expect(getConfigErrorDetails({ data: { unrelated: true } })).toBeUndefined()
  })

  it("formats a single-issue ConfigInvalidError", () => {
    const err = {
      data: {
        path: "/home/me/.config/kilo/kilo.json",
        issues: [{ code: "unrecognized_keys", keys: ["indexing"], path: [], message: 'Unrecognized key: "indexing"' }],
      },
    }
    expect(getConfigErrorDetails(err)).toBe('File: /home/me/.config/kilo/kilo.json\n\n✖ Unrecognized key: "indexing"')
  })

  it("formats a multi-issue ConfigInvalidError with paths (including array indices)", () => {
    const err = {
      data: {
        path: "/cfg.json",
        issues: [
          { path: ["timeout"], message: "Expected number" },
          { path: ["agents", 0, "name"], message: "Required" },
        ],
      },
    }
    expect(getConfigErrorDetails(err)).toBe(
      "File: /cfg.json\n\n✖ Expected number\n  → at timeout\n✖ Required\n  → at agents[0].name",
    )
  })

  it("omits the path line when only issues are present", () => {
    const err = { data: { issues: [{ path: [], message: "something" }] } }
    expect(getConfigErrorDetails(err)).toBe("✖ something")
  })

  it("omits the issues section when only the path is present", () => {
    expect(getConfigErrorDetails({ data: { path: "/cfg.json" } })).toBe("File: /cfg.json")
  })

  it("returns undefined when issues array is empty and no path", () => {
    expect(getConfigErrorDetails({ data: { issues: [] } })).toBeUndefined()
  })
})
