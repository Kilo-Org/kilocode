import { describe, expect, test } from "bun:test"
import { afterEach, mock, spyOn } from "bun:test"
import { Effect } from "effect"
import { ProjectV2 } from "@opencode-ai/core/project"
import { RemoteCommand } from "../../../src/kilo-sessions/remote-command"
import { RemoteModelCatalog } from "../../../src/kilo-sessions/remote-model-catalog"
import { RemoteSender } from "../../../src/kilo-sessions/remote-sender"
import type { RemoteWS } from "../../../src/kilo-sessions/remote-ws"
import type { RemoteProtocol } from "../../../src/kilo-sessions/remote-protocol"
import type { SessionPrompt } from "../../../src/session/prompt"
import { Question } from "../../../src/question"
import { QuestionID } from "../../../src/question/schema"
import { Permission } from "../../../src/permission"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionID } from "../../../src/session/schema"
import { Session } from "../../../src/session/session"
import { Suggestion } from "../../../src/kilocode/suggestion"
import { KiloSessionPromptQueue } from "../../../src/kilocode/session/prompt-queue"

function fakeConn() {
  const sent: any[] = []
  return {
    conn: {
      send(msg: any) {
        sent.push(msg)
      },
      close() {},
      get connected() {
        return true
      },
    } as RemoteWS.Connection,
    sent,
  }
}

function fakeBus() {
  const handlers: ((event: any) => void)[] = []
  const subscribe = (cb: (event: any) => void) => {
    handlers.push(cb)
    return () => {
      const idx = handlers.indexOf(cb)
      if (idx >= 0) handlers.splice(idx, 1)
    }
  }
  return {
    subscribe,
    fire: (event: any) => handlers.forEach((h) => h(event)),
    count: () => handlers.length,
  }
}

const nolog = {
  info: () => {},
  error: () => {},
  warn: () => {},
}

function permissions(items: Permission.Request[] = []) {
  return {
    list: async () => items,
    reply: async () => {},
  }
}

function questions(items: Question.Request[] = []) {
  return {
    list: async () => items,
    reply: async (_input: Parameters<Question.Interface["reply"]>[0]) => {},
    reject: async (_requestID: QuestionID) => {},
  }
}

function prompts(calls: SessionPrompt.PromptInput[]) {
  return async (input: SessionPrompt.PromptInput) => {
    calls.push(input)
  }
}

function info(id: SessionID, directory = "/workspace/project-a") {
  return {
    id,
    slug: id,
    projectID: ProjectV2.ID.make("project_test"),
    directory,
    title: "Test session",
    version: "test",
    time: { created: 0, updated: 0 },
  } satisfies Session.Info
}

function catalogModel(providerID: string, modelID: string, name: string, reasoning = false) {
  return {
    id: ModelV2.ID.make(modelID),
    providerID: ProviderV2.ID.make(providerID),
    api: { id: "private-deployment", url: "https://private.example.com", npm: "file:///private/provider" },
    name,
    capabilities: {
      temperature: true,
      attachment: true,
      reasoning,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1, output: 2, cache: { read: 3, write: 4 } },
    limit: { context: 100_000, output: 4_096 },
    status: "active" as const,
    options: { apiKey: "must-not-leak" },
    headers: { authorization: "must-not-leak" },
    release_date: "2026-01-01",
    variants: { precise: { apiKey: "must-not-leak" } },
  }
}

// kilocode_change start
afterEach(() => {
  mock.restore()
})
// kilocode_change end

describe("RemoteSender", () => {
  test("subscribe adds bus subscription, event forwarded", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_abc" })

    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_abc", text: "hello" },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({
      type: "event",
      sessionId: "ses_abc",
      event: "message.updated",
      data: { sessionID: "ses_abc", text: "hello" },
    })
  })

  test("unsubscribe removes subscription, events stop", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_abc" })
    sender.handle({ type: "unsubscribe", sessionId: "ses_abc" })

    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_abc", text: "hello" },
    })

    expect(sent).toHaveLength(0)
    expect(bus.count()).toBe(0)
  })

  test("only forwards for subscribed sessions", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_a" })

    bus.fire({
      type: "session.updated",
      properties: { sessionID: "ses_b", title: "other" },
    })

    expect(sent).toHaveLength(0)
  })

  test("duplicate subscribe is idempotent", () => {
    const { conn } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_a" })
    sender.handle({ type: "subscribe", sessionId: "ses_a" })

    expect(bus.count()).toBe(1)
  })

  test("single bus subscription for multiple sessions", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_a" })
    sender.handle({ type: "subscribe", sessionId: "ses_b" })

    expect(bus.count()).toBe(1)

    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_a", text: "a" },
    })
    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_b", text: "b" },
    })

    expect(sent).toHaveLength(2)
    expect(sent[0].sessionId).toBe("ses_a")
    expect(sent[1].sessionId).toBe("ses_b")
  })

  test("unsubscribe one session keeps bus alive for others", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_a" })
    sender.handle({ type: "subscribe", sessionId: "ses_b" })
    sender.handle({ type: "unsubscribe", sessionId: "ses_a" })

    expect(bus.count()).toBe(1)

    bus.fire({
      type: "session.updated",
      properties: { sessionID: "ses_b", title: "still here" },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].sessionId).toBe("ses_b")
  })

  test("send_message sends ACK immediately before provide resolves", async () => {
    const { conn, sent } = fakeConn()
    let resolveProvide: () => void
    const provideStarted = new Promise<void>((r) => {
      resolveProvide = r
    })
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async (input: any) => {
        resolveProvide!()
        // Simulate long-running work — never resolves during this test
        await new Promise(() => {})
        return {} as any
      },
    })

    sender.handle({
      type: "command",
      id: "req_1",
      command: "send_message",
      data: { sessionID: "ses_x", parts: [{ type: "text", text: "hi" }] },
    })

    // ACK is sent synchronously before provide even starts
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ type: "response", id: "req_1", result: {} })

    // provide was still called
    await provideStarted
  })

  test("send_message keeps client toggles persistent and terminal restriction ephemeral", async () => {
    const { conn } = fakeConn()
    const calls: SessionPrompt.PromptInput[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async (input: any) => input.fn(),
      prompt: prompts(calls),
    })

    sender.handle({
      type: "command",
      id: "req_remote_tools",
      command: "send_message",
      data: {
        sessionID: "ses_x",
        parts: [{ type: "text", text: "hi" }],
        tools: { bash: true },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls[0]?.tools).toEqual({ bash: true })
    expect(calls[0]?.ephemeralTools).toEqual({ interactive_terminal: false })
  })

  test("interrupt waits for session cancellation before responding", async () => {
    const { conn, sent } = fakeConn()
    let finishCancel: () => void
    const cancelled: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async (input: any) => input.fn(),
      cancel: async (sessionID) => {
        cancelled.push(sessionID)
        await new Promise<void>((resolve) => {
          finishCancel = resolve
        })
      },
    })

    sender.handle({
      type: "command",
      id: "req_interrupt",
      command: "interrupt",
      sessionId: "ses_x",
      data: {},
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(cancelled).toEqual(["ses_x"])
    expect(sent).toEqual([])

    finishCancel!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent).toEqual([{ type: "response", id: "req_interrupt", result: {} }])
  })

  test("send_message with invalid data sends error response immediately", () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async () => ({}) as any,
    })

    sender.handle({
      type: "command",
      id: "req_bad",
      command: "send_message",
      data: { invalid: true },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe("response")
    expect(sent[0].id).toBe("req_bad")
    expect(sent[0].error).toContain("invalid send_message data")
  })

  test("unknown command sends error response with matching id", () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async () => ({}) as any,
    })

    sender.handle({
      type: "command",
      id: "req_unknown",
      command: "unknown_command",
      data: { foo: "bar" },
    } as RemoteProtocol.Command)

    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({
      type: "response",
      id: "req_unknown",
      error: "unknown command: unknown_command",
    })
  })

  test("list_models returns the effective catalog from the exact session directory", async () => {
    const { conn, sent } = fakeConn()
    const dirs: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => {
        dirs.push(input.directory)
        return input.fn()
      },
      catalog: {
        get: async () =>
          ({
            id: SessionID.make("ses_models"),
            directory: "/workspace/project-a",
            model: {
              id: ModelV2.ID.make("deployment/model"),
              providerID: ProviderV2.ID.make("custom"),
              variant: "precise",
            },
          }) as any,
        messages: async () => [],
        providers: async () =>
          ({
            custom: {
              id: ProviderV2.ID.make("custom"),
              name: "Custom Provider",
              source: "config",
              env: ["PRIVATE_API_KEY"],
              key: "must-not-leak",
              options: { apiKey: "must-not-leak" },
              models: {
                "deployment/model": catalogModel("custom", "deployment/model", "Deployment Model", true),
              },
            },
          }) as any,
        default: async () => ({
          providerID: ProviderV2.ID.make("custom"),
          modelID: ModelV2.ID.make("deployment/model"),
        }),
      },
    })

    sender.handle({
      type: "command",
      id: "req_models",
      command: "list_models",
      sessionId: "ses_models",
      data: { protocolVersion: 1 },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(dirs).toEqual(["/workspace/project-a"])
    expect(sent).toHaveLength(1)
    expect(sent[0]?.type).toBe("response")
    expect(sent[0]?.id).toBe("req_models")
    const result = sent[0]?.result as RemoteModelCatalog.Response
    expect(result.all).toHaveLength(1)
    expect(result.all[0]?.id).toBe("custom")
    expect(result.all[0]?.env).toEqual([])
    expect(result.all[0]?.options).toEqual({})
    expect(result.all[0]?.models["deployment/model"]?.variants).toEqual({ precise: {} })
    expect(result.default).toEqual({ custom: "deployment/model" })
    expect(result.connected).toEqual(["custom"])
    expect(result.failed).toEqual([])
    expect(result.currentModel).toEqual({
      model: { providerID: "custom", modelID: "deployment/model" },
      variant: "precise",
    })
    expect(result.defaultModel).toEqual({ providerID: "custom", modelID: "deployment/model" })
    expect(result.truncated).toBe(false)
    expect(JSON.stringify(result)).not.toContain("must-not-leak")
    expect(JSON.stringify(result)).not.toContain("private.example.com")
  })

  test("list_models scopes provider discovery to each session directory", async () => {
    const { conn, sent } = fakeConn()
    const state = { directory: "" }
    const messages: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => {
        state.directory = input.directory
        const result = await input.fn()
        state.directory = ""
        return result
      },
      catalog: {
        get: async (sessionID) =>
          ({
            id: sessionID,
            directory: sessionID === SessionID.make("ses_first") ? "/workspace/first" : "/workspace/second",
          }) as any,
        messages: async (sessionID) => {
          messages.push(sessionID)
          return []
        },
        providers: async () => {
          const id = state.directory === "/workspace/first" ? "first-provider" : "second-provider"
          return {
            [id]: {
              id: ProviderV2.ID.make(id),
              name: id,
              source: "custom",
              env: [],
              options: {},
              models: {
                model: catalogModel(id, "model", "Model"),
              },
            },
          } as any
        },
        default: async () => undefined,
      },
    })

    sender.handle({
      type: "command",
      id: "req_models_first",
      command: "list_models",
      sessionId: "ses_first",
      data: { protocolVersion: 1 },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    sender.handle({
      type: "command",
      id: "req_models_second",
      command: "list_models",
      sessionId: "ses_second",
      data: { protocolVersion: 1 },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent.map((message) => message.result?.all[0]?.id)).toEqual(["first-provider", "second-provider"])
    expect(messages).toEqual([SessionID.make("ses_first"), SessionID.make("ses_second")])
  })

  test("list_models tolerates unavailable provider default resolution", async () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      catalog: {
        get: async () => ({ id: SessionID.make("ses_models"), directory: "/workspace/project-a" }) as any,
        messages: async () => [],
        providers: async () => ({}),
        default: async () => {
          throw new Error("no provider default")
        },
      },
    })

    sender.handle({
      type: "command",
      id: "req_models_no_default",
      command: "list_models",
      sessionId: "ses_models",
      data: { protocolVersion: 1 },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent).toEqual([
      {
        type: "response",
        id: "req_models_no_default",
        result: {
          all: [],
          default: {},
          connected: [],
          failed: [],
          protocolVersion: 1,
          truncated: false,
        },
      },
    ])
  })

  test("list_models logs a warning when provider default resolution fails", async () => {
    const { conn, sent } = fakeConn()
    const warnings: any[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: { ...nolog, warn: (...args: any[]) => warnings.push(args) },
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      catalog: {
        get: async () => ({ id: SessionID.make("ses_models"), directory: "/workspace/project-a" }) as any,
        messages: async () => [],
        providers: async () => ({}),
        default: async () => {
          throw new Error("no provider default")
        },
      },
    })

    sender.handle({
      type: "command",
      id: "req_models_warn_default",
      command: "list_models",
      sessionId: "ses_models",
      data: { protocolVersion: 1 },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent[0]?.result?.defaultModel).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.[0]).toBe("default model lookup failed")
    expect(String(warnings[0]?.[1]?.error)).toContain("no provider default")
  })

  test("list_models never falls back to the process directory for an unknown session", async () => {
    const { conn, sent } = fakeConn()
    const dirs: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => {
        dirs.push(input.directory)
        return input.fn()
      },
      catalog: {
        get: async () => {
          throw new Error("session not found")
        },
        messages: async () => [],
        providers: async () => ({}),
        default: async () => undefined,
      },
    })

    sender.handle({
      type: "command",
      id: "req_models_missing",
      command: "list_models",
      sessionId: "ses_missing",
      data: { protocolVersion: 1 },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(dirs).toEqual([])
    expect(sent).toEqual([
      {
        type: "response",
        id: "req_models_missing",
        error: "failed to list models",
      },
    ])
  })

  test("list_models returns one generic error when provider discovery fails", async () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      catalog: {
        get: async () => ({ id: SessionID.make("ses_models"), directory: "/workspace/project-a" }) as any,
        messages: async () => [],
        providers: async () => {
          throw new Error("private provider failure with api-key")
        },
        default: async () => undefined,
      },
    })

    sender.handle({
      type: "command",
      id: "req_models_failed",
      command: "list_models",
      sessionId: "ses_models",
      data: { protocolVersion: 1 },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent).toEqual([
      {
        type: "response",
        id: "req_models_failed",
        error: "failed to list models",
      },
    ])
    expect(JSON.stringify(sent)).not.toContain("api-key")
  })

  test("list_models rejects unsupported versions and missing session IDs", () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
    })

    sender.handle({
      type: "command",
      id: "req_models_v2",
      command: "list_models",
      sessionId: "ses_models",
      data: { protocolVersion: 2 },
    })
    sender.handle({
      type: "command",
      id: "req_models_missing_session",
      command: "list_models",
      data: { protocolVersion: 1 },
    })
    sender.handle({
      type: "command",
      id: "req_models_invalid_session",
      command: "list_models",
      sessionId: "not-a-session-id",
      data: { protocolVersion: 1 },
    })

    expect(sent).toEqual([
      { type: "response", id: "req_models_v2", error: "invalid list_models command" },
      { type: "response", id: "req_models_missing_session", error: "invalid list_models command" },
      { type: "response", id: "req_models_invalid_session", error: "invalid list_models command" },
    ])
  })

  test("send_message with agent is accepted", async () => {
    const { conn, sent } = fakeConn()
    let resolveProvide: () => void
    const provideStarted = new Promise<void>((r) => {
      resolveProvide = r
    })
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async (input: any) => {
        resolveProvide!()
        await new Promise(() => {})
        return {} as any
      },
    })

    sender.handle({
      type: "command",
      id: "req_model",
      command: "send_message",
      data: {
        sessionID: "ses_x",
        parts: [{ type: "text", text: "hello" }],
        agent: "plan",
      },
    })

    // ACK sent (not error) — model and agent were accepted by PromptInput validation
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ type: "response", id: "req_model", result: {} })

    await provideStarted
  })

  // kilocode_change start
  test("send_message normalizes string model without prefix", async () => {
    const { conn, sent } = fakeConn()
    const calls: SessionPrompt.PromptInput[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      prompt: prompts(calls),
    })

    sender.handle({
      type: "command",
      id: "req_model_string",
      command: "send_message",
      data: {
        sessionID: "ses_x",
        parts: [{ type: "text", text: "hello" }],
        model: "anthropic/claude-sonnet-4-20250514",
      },
    })

    await new Promise((r) => setTimeout(r, 0))

    expect(sent[0]).toEqual({ type: "response", id: "req_model_string", result: {} })
    expect(calls).toEqual([
      {
        sessionID: SessionID.make("ses_x"),
        parts: [{ type: "text", text: "hello" }],
        model: {
          providerID: ProviderV2.ID.make("kilo"),
          modelID: ModelV2.ID.make("anthropic/claude-sonnet-4-20250514"),
        },
        ephemeralTools: { interactive_terminal: false },
      },
    ])
  })

  test("send_message keeps kilocode-prefixed model unchanged before internal conversion", async () => {
    const { conn } = fakeConn()
    const calls: SessionPrompt.PromptInput[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      prompt: prompts(calls),
    })

    sender.handle({
      type: "command",
      id: "req_model_kilocode",
      command: "send_message",
      data: {
        sessionID: "ses_x",
        parts: [{ type: "text", text: "hello" }],
        model: "kilocode/gpt-5-mini",
      },
    })

    await new Promise((r) => setTimeout(r, 0))

    expect(calls).toEqual([
      {
        sessionID: SessionID.make("ses_x"),
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: ProviderV2.ID.make("kilo"), modelID: ModelV2.ID.make("gpt-5-mini") },
        ephemeralTools: { interactive_terminal: false },
      },
    ])
  })

  test("send_message preserves a structured provider and model", async () => {
    const { conn, sent } = fakeConn()
    const calls: SessionPrompt.PromptInput[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      prompt: prompts(calls),
    })

    sender.handle({
      type: "command",
      id: "req_model_structured",
      command: "send_message",
      data: {
        sessionID: "ses_x",
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "custom:edge", modelID: "deployment/model-v1" },
        variant: "precise",
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent[0]).toEqual({ type: "response", id: "req_model_structured", result: {} })
    expect(calls).toEqual([
      {
        sessionID: SessionID.make("ses_x"),
        parts: [{ type: "text", text: "hello" }],
        model: {
          providerID: ProviderV2.ID.make("custom:edge"),
          modelID: ModelV2.ID.make("deployment/model-v1"),
        },
        ephemeralTools: { interactive_terminal: false },
        variant: "precise",
      },
    ])
  })

  test("send_message rejects invalid structured model identities before ACK", () => {
    const { conn, sent } = fakeConn()
    const calls: SessionPrompt.PromptInput[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      prompt: prompts(calls),
    })

    sender.handle({
      type: "command",
      id: "req_model_invalid",
      command: "send_message",
      data: {
        sessionID: "ses_x",
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "", modelID: "deployment/model-v1" },
      },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.error).toContain("invalid send_message data")
    expect(calls).toHaveLength(0)
  })

  test("send_message leaves model and variant omitted for CLI precedence", async () => {
    const { conn, sent } = fakeConn()
    const calls: SessionPrompt.PromptInput[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      prompt: prompts(calls),
    })

    sender.handle({
      type: "command",
      id: "req_model_omitted",
      command: "send_message",
      data: {
        sessionID: "ses_x",
        parts: [{ type: "text", text: "hello" }],
        agent: "configured-agent",
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent[0]).toEqual({ type: "response", id: "req_model_omitted", result: {} })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.model).toBeUndefined()
    expect(calls[0]?.variant).toBeUndefined()
  })

  test("send_message does not special-case kilo-prefixed model", async () => {
    const { conn, sent } = fakeConn()
    const calls: SessionPrompt.PromptInput[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      prompt: prompts(calls),
    })

    sender.handle({
      type: "command",
      id: "req_model_kilo",
      command: "send_message",
      data: {
        sessionID: "ses_x",
        parts: [{ type: "text", text: "hello" }],
        model: "kilo/gpt-5-mini",
      },
    })

    await new Promise((r) => setTimeout(r, 0))

    expect(sent[0]).toEqual({ type: "response", id: "req_model_kilo", result: {} })
    expect(calls).toEqual([
      {
        sessionID: SessionID.make("ses_x"),
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: ProviderV2.ID.make("kilo"), modelID: ModelV2.ID.make("kilo/gpt-5-mini") },
        ephemeralTools: { interactive_terminal: false },
      },
    ])
  })
  // kilocode_change end

  test("question_reply sends response after work completes", async () => {
    const { conn, sent } = fakeConn()
    const calls: Parameters<Question.Interface["reply"]>[0][] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      question: {
        ...questions(),
        reply: async (input) => {
          calls.push(input)
        },
      },
    })

    sender.handle({
      type: "command",
      id: "req_q",
      command: "question_reply",
      data: { requestID: "que_r1", answers: [["yes"]] },
    })

    // Response not sent synchronously - waits for provide to finish.
    expect(sent).toHaveLength(0)

    await new Promise((r) => setTimeout(r, 10))

    expect(calls).toEqual([{ requestID: QuestionID.make("que_r1"), answers: [["yes"]] }])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ type: "response", id: "req_q", result: {} })
  })

  test("permission_respond sends response after work completes", async () => {
    const { conn, sent } = fakeConn()
    const calls: Permission.ReplyInput[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      permission: {
        list: async () => [],
        reply: async (input) => {
          calls.push(input)
        },
      },
    })

    sender.handle({
      type: "command",
      id: "req_permission",
      command: "permission_respond",
      data: { requestID: PermissionV1.ID.make("permission_1"), reply: "once" },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(calls).toEqual([{ requestID: PermissionV1.ID.make("permission_1"), reply: "once" }])
    expect(sent).toContainEqual({ type: "response", id: "req_permission", result: {} })
  })

  test("question_reply error sends error response", async () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      question: {
        ...questions(),
        reply: async () => {
          throw new Error("boom")
        },
      },
    })

    sender.handle({
      type: "command",
      id: "req_qe",
      command: "question_reply",
      data: { requestID: "que_r1", answers: [["yes"]] },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe("response")
    expect(sent[0].id).toBe("req_qe")
    expect(sent[0].error).toContain("boom")
  })

  test("question_reply reports unknown request errors", async () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      question: {
        ...questions(),
        reply: async (input) => {
          throw new Question.NotFoundError({ requestID: input.requestID })
        },
      },
    })

    sender.handle({
      type: "command",
      id: "req_q_missing",
      command: "question_reply",
      data: { requestID: "que_missing", answers: [["yes"]] },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe("response")
    expect(sent[0].id).toBe("req_q_missing")
    expect(sent[0].error).toContain("Question.NotFoundError")
  })

  test("suggestion_accept sends response after work completes", async () => {
    const { conn, sent } = fakeConn()
    const accept = spyOn(Suggestion, "accept").mockResolvedValue(true)
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
    })

    sender.handle({
      type: "command",
      id: "req_suggestion_accept",
      command: "suggestion_accept",
      data: { requestID: "sug_1", index: 1 },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(accept).toHaveBeenCalledWith({ requestID: "sug_1", index: 1 })
    expect(sent).toContainEqual({ type: "response", id: "req_suggestion_accept", result: {} })
  })

  test("suggestion_dismiss with invalid data sends error response", () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async () => ({}) as any,
    })

    sender.handle({
      type: "command",
      id: "req_suggestion_dismiss_bad",
      command: "suggestion_dismiss",
      data: { nope: true },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].error).toContain("invalid suggestion_dismiss data")
  })

  test("question_reject sends response after work completes", async () => {
    const { conn, sent } = fakeConn()
    const calls: QuestionID[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      question: {
        ...questions(),
        reject: async (requestID) => {
          calls.push(requestID)
        },
      },
    })

    sender.handle({
      type: "command",
      id: "req_qr",
      command: "question_reject",
      data: { requestID: "que_r1" },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(calls).toEqual([QuestionID.make("que_r1")])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ type: "response", id: "req_qr", result: {} })
  })

  test("question_reject reports unknown request errors", async () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }) => input.fn(),
      question: {
        ...questions(),
        reject: async (requestID) => {
          throw new Question.NotFoundError({ requestID })
        },
      },
    })

    sender.handle({
      type: "command",
      id: "req_qr_missing",
      command: "question_reject",
      data: { requestID: "que_missing" },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe("response")
    expect(sent[0].id).toBe("req_qr_missing")
    expect(sent[0].error).toContain("Question.NotFoundError")
  })

  test("question_reject with invalid data sends error response", () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async () => ({}) as any,
    })

    sender.handle({
      type: "command",
      id: "req_qr_bad",
      command: "question_reject",
      data: { wrong: true },
    } as any)

    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe("response")
    expect(sent[0].id).toBe("req_qr_bad")
    expect(sent[0].error).toContain("invalid question_reject data")
  })

  test("events without sessionID are not forwarded", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_a" })

    bus.fire({ type: "server.connected", properties: {} })
    bus.fire({ type: "lsp.updated", properties: undefined })

    expect(sent).toHaveLength(0)
  })

  test("dispose clears all subscriptions", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_a" })
    sender.handle({ type: "subscribe", sessionId: "ses_b" })

    sender.dispose()

    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_a", text: "hello" },
    })

    expect(sent).toHaveLength(0)
    expect(bus.count()).toBe(0)
  })

  test("child session events forwarded when parent subscribed", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_parent" })

    // Child session created with parentID
    bus.fire({
      type: "session.created",
      properties: { info: { id: "ses_child", parentID: "ses_parent", title: "sub" }, sessionID: "ses_child" },
    })

    // Event on the child session should be forwarded
    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_child", text: "from child" },
    })

    // session.created + message.updated
    expect(sent).toHaveLength(2)
    expect(sent[0].sessionId).toBe("ses_child")
    expect(sent[0].parentSessionId).toBe("ses_parent")
    expect(sent[0].event).toBe("session.created")
    expect(sent[1].sessionId).toBe("ses_child")
    expect(sent[1].parentSessionId).toBe("ses_parent")
    expect(sent[1].event).toBe("message.updated")
  })

  test("child session events not forwarded when parent not subscribed", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_other" })

    bus.fire({
      type: "session.created",
      properties: { info: { id: "ses_child", parentID: "ses_unrelated", title: "sub" }, sessionID: "ses_child" },
    })

    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_child", text: "from child" },
    })

    expect(sent).toHaveLength(0)
  })

  test("unsubscribe parent cleans up child tracking", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_parent" })

    bus.fire({
      type: "session.created",
      properties: { info: { id: "ses_child", parentID: "ses_parent", title: "sub" }, sessionID: "ses_child" },
    })

    sender.handle({ type: "unsubscribe", sessionId: "ses_parent" })

    // Keep another session alive so bus stays subscribed
    sender.handle({ type: "subscribe", sessionId: "ses_keep" })

    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_child", text: "after unsub" },
    })

    expect(sent.filter((m: any) => m.event === "message.updated")).toHaveLength(0)
  })

  test("unsubscribe parent cleans up grandchild tracking", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_root" })

    bus.fire({
      type: "session.created",
      properties: { info: { id: "ses_child", parentID: "ses_root", title: "child" }, sessionID: "ses_child" },
    })
    bus.fire({
      type: "session.created",
      properties: {
        info: { id: "ses_grandchild", parentID: "ses_child", title: "grandchild" },
        sessionID: "ses_grandchild",
      },
    })

    sender.handle({ type: "unsubscribe", sessionId: "ses_root" })
    sender.handle({ type: "subscribe", sessionId: "ses_keep" })

    // Clear events from subscribe/session.created
    sent.length = 0

    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_child", text: "after unsub" },
    })
    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_grandchild", text: "after unsub" },
    })

    expect(sent).toHaveLength(0)
  })

  test("root session events do not include parentSessionId", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_root" })

    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_root", text: "hello" },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].sessionId).toBe("ses_root")
    expect(sent[0]).not.toHaveProperty("parentSessionId")
  })

  test("nested child events include root parentSessionId", () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
    })

    sender.handle({ type: "subscribe", sessionId: "ses_root" })

    // Root → child
    bus.fire({
      type: "session.created",
      properties: { info: { id: "ses_child", parentID: "ses_root", title: "child" }, sessionID: "ses_child" },
    })

    // child → grandchild
    bus.fire({
      type: "session.created",
      properties: {
        info: { id: "ses_grandchild", parentID: "ses_child", title: "grandchild" },
        sessionID: "ses_grandchild",
      },
    })

    // Event on grandchild should have parentSessionId pointing to root
    bus.fire({
      type: "message.updated",
      properties: { sessionID: "ses_grandchild", text: "from grandchild" },
    })

    // 3 events: session.created (child), session.created (grandchild), message.updated (grandchild)
    expect(sent).toHaveLength(3)
    expect(sent[0].parentSessionId).toBe("ses_root")
    expect(sent[1].parentSessionId).toBe("ses_root")
    expect(sent[2].parentSessionId).toBe("ses_root")
    expect(sent[2].sessionId).toBe("ses_grandchild")
  })

  test("subscribe triggers backfill of existing children", async () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()

    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
      provide: async (input: any) => input.fn(),
    })

    // backfill calls Session.children which requires real DB context.
    // Our provide mock just calls fn() directly, so Session.children will fail.
    // The backfill logs the error silently and doesn't break normal operation.

    sender.handle({ type: "subscribe", sessionId: "ses_parent" })

    // Wait for async backfill to attempt (and fail silently in test context)
    await new Promise((r) => setTimeout(r, 10))

    // Normal event forwarding still works
    bus.fire({
      type: "session.created",
      properties: { info: { id: "ses_new_child", parentID: "ses_parent", title: "new" }, sessionID: "ses_new_child" },
    })

    expect(sent.filter((m: any) => m.event === "session.created")).toHaveLength(1)
    expect(sent[0].sessionId).toBe("ses_new_child")
    expect(sent[0].parentSessionId).toBe("ses_parent")
  })

  test("subscribe replays pending question for the subscribed session", async () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()

    spyOn(Suggestion, "list").mockResolvedValue([])

    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
      provide: async (input: any) => input.fn(),
      permission: permissions(),
      question: questions([
        { id: "question_1", sessionID: "ses_target", questions: [{ type: "text", text: "Continue?" }] } as any,
        { id: "question_2", sessionID: "ses_other", questions: [{ type: "text", text: "Unrelated?" }] } as any,
      ]),
    })

    sender.handle({ type: "subscribe", sessionId: "ses_target" })
    await new Promise((r) => setTimeout(r, 10))

    const questionEvents = sent.filter((m: any) => m.event === "question.asked")
    expect(questionEvents).toHaveLength(1)
    expect(questionEvents[0]).toEqual({
      type: "event",
      sessionId: "ses_target",
      event: "question.asked",
      data: { id: "question_1", sessionID: "ses_target", questions: [{ type: "text", text: "Continue?" }] },
    })
  })

  test("subscribe replays pending permission for the subscribed session", async () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()

    spyOn(Suggestion, "list").mockResolvedValue([])

    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
      provide: async (input: any) => input.fn(),
      question: questions(),
      permission: permissions([
        {
          id: "permission_1",
          sessionID: "ses_target",
          permission: "file.write",
          patterns: ["src/**"],
          metadata: {},
          always: [],
        } as any,
        {
          id: "permission_2",
          sessionID: "ses_other",
          permission: "file.read",
          patterns: ["*"],
          metadata: {},
          always: [],
        } as any,
      ]),
    })

    sender.handle({ type: "subscribe", sessionId: "ses_target" })
    await new Promise((r) => setTimeout(r, 10))

    const permEvents = sent.filter((m: any) => m.event === "permission.asked")
    expect(permEvents).toHaveLength(1)
    expect(permEvents[0]).toEqual({
      type: "event",
      sessionId: "ses_target",
      event: "permission.asked",
      data: {
        id: "permission_1",
        sessionID: "ses_target",
        permission: "file.write",
        patterns: ["src/**"],
        metadata: {},
        always: [],
      },
    })
  })

  test("child permission replay includes the subscribed root session", async () => {
    const { conn, sent } = fakeConn()
    const child = {
      id: SessionID.make("ses_child"),
      parentID: SessionID.make("ses_root"),
      directory: "/workspace/child",
    } as Session.Info
    spyOn(Suggestion, "list").mockResolvedValue([])
    const sender = RemoteSender.create({
      conn,
      directory: "/workspace/root",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async (input: any) => input.fn(),
      session: {
        get: async (sessionID) =>
          sessionID === child.id ? child : ({ id: sessionID, directory: "/workspace/root" } as Session.Info),
        children: async (sessionID) => (sessionID === SessionID.make("ses_root") ? [child] : []),
      },
      question: questions(),
      permission: permissions([
        {
          id: "permission_child",
          sessionID: "ses_child",
          permission: "external_directory",
          patterns: ["/workspace/child/**"],
          metadata: {},
          always: [],
        } as any,
      ]),
    })

    sender.handle({ type: "subscribe", sessionId: "ses_root" })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent).toContainEqual({
      type: "event",
      sessionId: "ses_child",
      parentSessionId: "ses_root",
      event: "permission.asked",
      data: {
        id: "permission_child",
        sessionID: "ses_child",
        permission: "external_directory",
        patterns: ["/workspace/child/**"],
        metadata: {},
        always: [],
      },
    })
  })

  test("subscribe does not replay state for sessions with no pending questions or permissions", async () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()

    spyOn(Suggestion, "list").mockResolvedValue([
      { id: "sug_1", sessionID: "ses_other", text: "Review?", actions: [] } as any,
    ])
    // Queue snapshot is always replayed, even when empty
    spyOn(KiloSessionPromptQueue, "snapshot").mockReturnValue([])

    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
      provide: async (input: any) => input.fn(),
      question: questions([{ id: "question_1", sessionID: "ses_other", questions: [] } as any]),
      permission: permissions([
        {
          id: "permission_1",
          sessionID: "ses_other",
          permission: "file.write",
          patterns: [],
          metadata: {},
          always: [],
        } as any,
      ]),
    })

    sender.handle({ type: "subscribe", sessionId: "ses_target" })
    await new Promise((r) => setTimeout(r, 10))

    // No question/permission/suggestion events for the subscribed session, but
    // the queue snapshot replay always fires (here, an empty list) so a
    // resubscribing client can reconcile stale "Queued" badges.
    const replayed = sent.filter((m: any) => m.type === "event")
    expect(replayed).toEqual([
      {
        type: "event",
        sessionId: "ses_target",
        event: "session.queue.changed",
        data: { sessionID: "ses_target", queued: [] },
      },
    ])
  })

  // Queue snapshot replay-on-subscribe coverage
  test("subscribe always replays the current queue snapshot, including empty", async () => {
    // A resubscribing/reconnecting client must see the authoritative queue
    // state immediately, even when the session has no queued messages. This
    // is what lets mobile reconcile a stale "Queued" badge away.
    const { conn, sent } = fakeConn()
    const bus = fakeBus()

    spyOn(Suggestion, "list").mockResolvedValue([])
    spyOn(KiloSessionPromptQueue, "snapshot").mockReturnValue([])

    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
      provide: async (input: any) => input.fn(),
      question: questions(),
      permission: permissions(),
    })

    sender.handle({ type: "subscribe", sessionId: "ses_target" })
    await new Promise((r) => setTimeout(r, 10))

    const queueEvents = sent.filter((m: any) => m.event === "session.queue.changed")
    expect(queueEvents).toEqual([
      {
        type: "event",
        sessionId: "ses_target",
        event: "session.queue.changed",
        data: { sessionID: "ses_target", queued: [] },
      },
    ])
    expect(KiloSessionPromptQueue.snapshot).toHaveBeenCalledWith(SessionID.make("ses_target"))
  })

  test("subscribe replays a non-empty queue snapshot for the subscribed session", async () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()

    spyOn(Suggestion, "list").mockResolvedValue([])
    spyOn(KiloSessionPromptQueue, "snapshot").mockReturnValue(["msg_a", "msg_b"] as any)

    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
      provide: async (input: any) => input.fn(),
      question: questions(),
      permission: permissions(),
    })

    sender.handle({ type: "subscribe", sessionId: "ses_target" })
    await new Promise((r) => setTimeout(r, 10))

    const queueEvents = sent.filter((m: any) => m.event === "session.queue.changed")
    expect(queueEvents).toEqual([
      {
        type: "event",
        sessionId: "ses_target",
        event: "session.queue.changed",
        data: { sessionID: "ses_target", queued: ["msg_a", "msg_b"] },
      },
    ])
  })

  test("subscribe replays pending suggestion for the subscribed session", async () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()

    spyOn(Suggestion, "list").mockResolvedValue([
      {
        id: "sug_1",
        sessionID: "ses_target",
        text: "Continue?",
        actions: [{ label: "Continue", prompt: "Continue with the task" }],
      } as any,
      {
        id: "sug_2",
        sessionID: "ses_other",
        text: "Ignore",
        actions: [{ label: "Skip", prompt: "skip" }],
      } as any,
    ])

    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
      provide: async (input: any) => input.fn(),
      permission: permissions(),
      question: questions(),
    })

    sender.handle({ type: "subscribe", sessionId: "ses_target" })
    await new Promise((r) => setTimeout(r, 10))

    const suggestionEvents = sent.filter((m: any) => m.event === "suggestion.shown")
    expect(suggestionEvents).toHaveLength(1)
    expect(suggestionEvents[0]).toEqual({
      type: "event",
      sessionId: "ses_target",
      event: "suggestion.shown",
      data: {
        id: "sug_1",
        sessionID: "ses_target",
        text: "Continue?",
        actions: [{ label: "Continue", prompt: "Continue with the task" }],
      },
    })
  })

  test("system message is handled without error", () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
    })

    sender.handle({
      type: "system",
      event: "cli.connected",
      data: { version: "1.0" },
    })

    expect(sent).toHaveLength(0)
  })
})

// kilocode_change start - remote slash command discovery and execution
describe("RemoteSender slash commands", () => {
  // Wraps a Connection to expose a promise that resolves when a response with the
  // given id is sent. Keeps new tests deterministic without setTimeout polling.
  // Wrappers chain so multiple pending responses can be awaited on the same
  // connection; the original fakeConn.send still records each emission once.
  function expectResponse(conn: RemoteWS.Connection, _sent: any[], id: string) {
    const resolvers = Promise.withResolvers<RemoteProtocol.Outbound>()
    const previous = conn.send.bind(conn)
    const spy = (message: RemoteProtocol.Outbound) => {
      if (message?.type === "response" && message.id === id) resolvers.resolve(message)
      previous(message)
    }
    conn.send = spy
    return {
      promise: resolvers.promise,
      restore: () => {
        conn.send = previous
      },
    }
  }

  test("list_commands validates v1 and returns the bounded catalog from the target session directory", async () => {
    const { conn, sent } = fakeConn()
    const dirs: string[] = []
    const state = { directory: "" }
    const first = expectResponse(conn, sent, "req_commands_first")
    const second = expectResponse(conn, sent, "req_commands_second")
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => {
        dirs.push(input.directory)
        state.directory = input.directory
        const result = await input.fn()
        state.directory = ""
        return result
      },
      commands: {
        list: async () => ({
          protocolVersion: 1 as const,
          commands: [{ name: state.directory.endsWith("first") ? "first" : "second", hints: [] }],
        }),
        execute: async () => {},
      },
      catalog: {
        get: async (sessionID) =>
          ({
            id: sessionID,
            directory: sessionID === SessionID.make("ses_first") ? "/workspace/first" : "/workspace/second",
          }) as any,
        messages: async () => [],
        providers: async () => ({}),
        default: async () => undefined,
      },
    })

    sender.handle({
      type: "command",
      id: "req_commands_first",
      command: "list_commands",
      sessionId: "ses_first",
      data: { protocolVersion: 1 },
    })
    await first.promise
    sender.handle({
      type: "command",
      id: "req_commands_second",
      command: "list_commands",
      sessionId: "ses_second",
      data: { protocolVersion: 1 },
    })
    await second.promise

    first.restore()
    second.restore()

    expect(dirs).toEqual(["/workspace/first", "/workspace/second"])
    expect(sent).toEqual([
      {
        type: "response",
        id: "req_commands_first",
        result: { protocolVersion: 1, commands: [{ name: "first", hints: [] }] },
      },
      {
        type: "response",
        id: "req_commands_second",
        result: { protocolVersion: 1, commands: [{ name: "second", hints: [] }] },
      },
    ])
  })

  test("list_commands rejects unsupported protocol versions and missing session IDs before ACK", () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      commands: {
        list: async () => ({ protocolVersion: 1 as const, commands: [] }),
        execute: async () => {},
      },
    })

    sender.handle({
      type: "command",
      id: "req_commands_v2",
      command: "list_commands",
      sessionId: "ses_x",
      data: { protocolVersion: 2 },
    })
    sender.handle({
      type: "command",
      id: "req_commands_no_session",
      command: "list_commands",
      data: { protocolVersion: 1 },
    })
    sender.handle({
      type: "command",
      id: "req_commands_invalid_session",
      command: "list_commands",
      sessionId: "not-a-session-id",
      data: { protocolVersion: 1 },
    })

    expect(sent).toEqual([
      { type: "response", id: "req_commands_v2", error: "invalid list_commands request" },
      { type: "response", id: "req_commands_no_session", error: "invalid list_commands request" },
      { type: "response", id: "req_commands_invalid_session", error: "invalid list_commands request" },
    ])
  })

  test("send_command validates protocol, session, and catalog membership before ACK", async () => {
    const { conn, sent } = fakeConn()
    const calls: unknown[] = []
    const started = Promise.withResolvers<void>()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => input.fn(),
      commands: {
        list: async () => ({ protocolVersion: 1 as const, commands: [{ name: "review", hints: [] }] }),
        execute: async (input) => {
          calls.push(input)
          started.resolve()
          await new Promise(() => {})
        },
      },
      catalog: {
        get: async () => ({ id: SessionID.make("ses_commands"), directory: "/workspace/project-a" }) as any,
        messages: async () => [],
        providers: async () => ({}),
        default: async () => undefined,
      },
    })

    // Pre-ACK: invalid protocol
    sender.handle({
      type: "command",
      id: "req_bad_version",
      command: "send_command",
      sessionId: "ses_commands",
      data: { protocolVersion: 2, command: "review", arguments: "main" },
    })
    // Pre-ACK: missing session id
    sender.handle({
      type: "command",
      id: "req_no_session",
      command: "send_command",
      data: { protocolVersion: 1, command: "review", arguments: "main" },
    })

    // Wait for the async catalog preflight that rejects the unknown command and ACKs the valid one.
    const unknownResponse = expectResponse(conn, sent, "req_unknown")
    const ackResponse = expectResponse(conn, sent, "req_send_command")

    // Pre-ACK: command not in catalog
    sender.handle({
      type: "command",
      id: "req_unknown",
      command: "send_command",
      sessionId: "ses_commands",
      data: { protocolVersion: 1, command: "missing", arguments: "main" },
    })
    // Valid path: ACK first
    sender.handle({
      type: "command",
      id: "req_send_command",
      command: "send_command",
      sessionId: "ses_commands",
      data: {
        protocolVersion: 1,
        command: "review",
        arguments: "  main  ",
        messageID: "msg_remote",
      },
    })

    expect(sent.slice(0, 2)).toEqual([
      { type: "response", id: "req_bad_version", error: "invalid send_command request" },
      { type: "response", id: "req_no_session", error: "invalid send_command request" },
    ])

    await unknownResponse.promise
    unknownResponse.restore()
    await ackResponse.promise
    ackResponse.restore()

    expect(sent.find((m: any) => m.id === "req_unknown")).toEqual({
      type: "response",
      id: "req_unknown",
      error: "unknown slash command",
    })
    expect(sent.find((m: any) => m.id === "req_send_command")).toEqual({
      type: "response",
      id: "req_send_command",
      result: {},
    })

    await started.promise
    expect(calls).toEqual([
      {
        sessionID: SessionID.make("ses_commands"),
        protocolVersion: 1,
        command: "review",
        arguments: "  main  ",
        messageID: "msg_remote",
        catalog: { protocolVersion: 1, commands: [{ name: "review", hints: [] }] },
      },
    ])
  })

  test("send_command returns a sanitized error without ACK when the session is missing", async () => {
    const { conn, sent } = fakeConn()
    const dirs: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => {
        dirs.push(input.directory)
        return input.fn()
      },
      commands: {
        list: async () => ({ protocolVersion: 1 as const, commands: [{ name: "review", hints: [] }] }),
        execute: async () => {
          throw new Error("must not execute")
        },
      },
      catalog: {
        get: async () => {
          throw new Error("private lookup detail with secret")
        },
        messages: async () => [],
        providers: async () => ({}),
        default: async () => undefined,
      },
    })

    const response = expectResponse(conn, sent, "req_missing_command")
    sender.handle({
      type: "command",
      id: "req_missing_command",
      command: "send_command",
      sessionId: "ses_missing",
      data: { protocolVersion: 1, command: "review", arguments: "main" },
    })

    await response.promise
    response.restore()

    expect(dirs).toEqual([])
    expect(sent).toEqual([{ type: "response", id: "req_missing_command", error: "failed to send command" }])
    expect(JSON.stringify(sent)).not.toContain("private lookup detail with secret")
  })

  test("send_command logs only the error class after ACK and does not leak arguments or tokens", async () => {
    class CredentialLeakError extends Error {
      override name = "CredentialLeakError"
    }
    const { conn, sent } = fakeConn()
    const logEntries: unknown[][] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: {
        ...nolog,
        error: (...args: unknown[]) => logEntries.push(args),
      },
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => input.fn(),
      commands: {
        list: async () => ({ protocolVersion: 1 as const, commands: [{ name: "review", hints: [] }] }),
        execute: async () => {
          throw new CredentialLeakError("credential=must-not-leak")
        },
      },
      catalog: {
        get: async () => ({ id: SessionID.make("ses_commands"), directory: "/workspace/project-a" }) as any,
        messages: async () => [],
        providers: async () => ({}),
        default: async () => undefined,
      },
    })

    const ack = expectResponse(conn, sent, "req_failed_command")
    sender.handle({
      type: "command",
      id: "req_failed_command",
      command: "send_command",
      sessionId: "ses_commands",
      data: {
        protocolVersion: 1,
        command: "review",
        arguments: "secret=token-must-not-leak",
        model: { providerID: "custom/edge", modelID: "deployment/model" },
      },
    })

    await ack.promise
    // The post-ACK throw is logged via the same adapter; give the microtask a
    // chance to drain so the log entry is captured before assertions.
    await Promise.resolve()
    ack.restore()

    expect(sent).toEqual([{ type: "response", id: "req_failed_command", result: {} }])
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0]?.[0]).toBe("send command failed after ACK")
    expect(logEntries[0]?.[1]).toEqual({
      id: "req_failed_command",
      operation: "send_command",
      error: "CredentialLeakError",
    })
    const flattened = JSON.stringify(logEntries)
    expect(flattened).not.toContain("token-must-not-leak")
    expect(flattened).not.toContain("credential=must-not-leak")
    expect(flattened).not.toContain("secret=")
  })

  test("send_command rejects process exit before ACK without invoking command or graceful exit", async () => {
    const { conn, sent } = fakeConn()
    const calls: unknown[] = []
    let callbacks = 0
    const commands = RemoteCommand.create({
      exitAvailable: () => true,
      list: async () => [],
      command: async (input) => {
        calls.push(input)
      },
      session: {
        get: async () => {
          throw new Error("unexpected command session lookup")
        },
        messages: async () => {
          throw new Error("unexpected command message lookup")
        },
      },
      agent: { default: async () => "unexpected-agent" },
      provider: { default: async () => ({ providerID: "unexpected", modelID: "unexpected" }) },
      revert: { cleanup: async () => {} },
      compaction: { create: async () => {} },
      prompt: { loop: async () => {} },
    })
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => input.fn(),
      commands,
      remoteExit: {
        get: () => {
          callbacks += 1
          return async () => {}
        },
      },
      catalog: {
        get: async (id) => info(id),
        messages: async () => [],
        providers: async () => ({}),
        default: async () => undefined,
      },
    })

    const response = expectResponse(conn, sent, "req_send_exit")
    sender.handle({
      type: "command",
      id: "req_send_exit",
      command: "send_command",
      sessionId: "ses_current",
      data: { protocolVersion: 1, command: "exit", arguments: "" },
    })
    await response.promise
    response.restore()
    await Promise.resolve()

    expect(sent).toEqual([{ type: "response", id: "req_send_exit", error: "unknown slash command" }])
    expect(calls).toEqual([])
    expect(callbacks).toBe(0)
  })

  test("exit_cli rejects invalid, missing, unresolved, and unavailable sessions before ACK", async () => {
    const { conn, sent } = fakeConn()
    const lookups: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      session: {
        get: async (id) => {
          lookups.push(id)
          if (id === SessionID.make("ses_missing")) throw new Error("private missing-session detail")
          return info(id)
        },
        children: async () => [],
      },
      remoteExit: {
        get: () => undefined,
      },
    })

    sender.handle({
      type: "command",
      id: "req_exit_no_session",
      command: "exit_cli",
      data: { protocolVersion: 1 },
    })
    sender.handle({
      type: "command",
      id: "req_exit_invalid_session",
      command: "exit_cli",
      sessionId: "not-a-session-id",
      data: { protocolVersion: 1 },
    })
    sender.handle({
      type: "command",
      id: "req_exit_bad_protocol",
      command: "exit_cli",
      sessionId: "ses_current",
      data: { protocolVersion: 2 },
    })
    sender.handle({
      type: "command",
      id: "req_exit_extra",
      command: "exit_cli",
      sessionId: "ses_current",
      data: { protocolVersion: 1, extra: true },
    })

    const missing = expectResponse(conn, sent, "req_exit_missing")
    sender.handle({
      type: "command",
      id: "req_exit_missing",
      command: "exit_cli",
      sessionId: "ses_missing",
      data: { protocolVersion: 1 },
    })
    await missing.promise
    missing.restore()

    const unavailable = expectResponse(conn, sent, "req_exit_unavailable")
    sender.handle({
      type: "command",
      id: "req_exit_unavailable",
      command: "exit_cli",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await unavailable.promise
    unavailable.restore()

    expect(sent).toEqual([
      { type: "response", id: "req_exit_no_session", error: "invalid exit_cli command" },
      { type: "response", id: "req_exit_invalid_session", error: "invalid exit_cli command" },
      { type: "response", id: "req_exit_bad_protocol", error: "invalid exit_cli command" },
      { type: "response", id: "req_exit_extra", error: "invalid exit_cli command" },
      { type: "response", id: "req_exit_missing", error: "failed to exit CLI" },
      { type: "response", id: "req_exit_unavailable", error: "graceful exit unavailable" },
    ])
    expect(lookups).toEqual(["ses_missing", "ses_current"])
  })

  test("exit_cli ACKs before invoking the worker callback in a microtask", async () => {
    const { conn, sent } = fakeConn()
    const order: string[] = []
    const tasks: VoidFunction[] = []
    const original = globalThis.queueMicrotask
    globalThis.queueMicrotask = (task) => {
      tasks.push(task)
    }
    const send = conn.send.bind(conn)
    conn.send = (message) => {
      order.push("response")
      send(message)
    }
    const invoked = Promise.withResolvers<void>()
    const remoteExit = {
      get: () => async () => {
        order.push("callback")
        invoked.resolve()
      },
    }
    try {
      const sender = RemoteSender.create({
        conn,
        directory: "/tmp/process-default",
        log: nolog,
        subscribe: fakeBus().subscribe,
        session: {
          get: async (id) => info(id),
          children: async () => [],
        },
        remoteExit,
      })

      const ack = expectResponse(conn, sent, "req_exit")
      sender.handle({
        type: "command",
        id: "req_exit",
        command: "exit_cli",
        sessionId: "ses_current",
        data: { protocolVersion: 1 },
      })
      await ack.promise
      ack.restore()

      expect(sent).toEqual([{ type: "response", id: "req_exit", result: {} }])
      expect(order).toEqual(["response"])
      expect(tasks).toHaveLength(1)

      tasks[0]?.()
      await invoked.promise
      expect(order).toEqual(["response", "callback"])
    } finally {
      globalThis.queueMicrotask = original
    }
  })

  test("concurrent exit_cli requests ACK while idempotent local Exit cleans up once", async () => {
    const { conn, sent } = fakeConn()
    const completed = Promise.withResolvers<void>()
    const calls: string[] = []
    let task: Promise<void> | undefined
    const exit = () =>
      (task ??= Promise.resolve().then(() => {
        calls.push("cleanup")
        completed.resolve()
      }))
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      session: {
        get: async (id) => info(id),
        children: async () => [],
      },
      remoteExit: {
        get: () => exit,
      },
    })

    sender.handle({
      type: "command",
      id: "req_exit_first",
      command: "exit_cli",
      sessionId: "ses_first",
      data: { protocolVersion: 1 },
    })
    sender.handle({
      type: "command",
      id: "req_exit_second",
      command: "exit_cli",
      sessionId: "ses_second",
      data: { protocolVersion: 1 },
    })
    await completed.promise
    await Promise.resolve()

    expect(sent).toEqual([
      { type: "response", id: "req_exit_first", result: {} },
      { type: "response", id: "req_exit_second", result: {} },
    ])
    expect(calls).toEqual(["cleanup"])
  })

  test("exit_cli logs only the error class when graceful exit fails after ACK", async () => {
    class CredentialLeakError extends Error {
      override name = "CredentialLeakError"
    }
    const { conn, sent } = fakeConn()
    const logs: unknown[][] = []
    const logged = Promise.withResolvers<void>()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: {
        ...nolog,
        error: (...args: unknown[]) => {
          logs.push(args)
          logged.resolve()
        },
      },
      subscribe: fakeBus().subscribe,
      session: {
        get: async (id) => info(id),
        children: async () => [],
      },
      remoteExit: {
        get: () => async () => {
          throw new CredentialLeakError("token=must-not-leak")
        },
      },
    })

    sender.handle({
      type: "command",
      id: "req_exit_failed",
      command: "exit_cli",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await logged.promise

    expect(sent).toEqual([{ type: "response", id: "req_exit_failed", result: {} }])
    expect(logs).toEqual([
      ["exit CLI failed after ACK", { id: "req_exit_failed", operation: "exit_cli", error: "CredentialLeakError" }],
    ])
    expect(JSON.stringify(logs)).not.toContain("must-not-leak")
    expect(JSON.stringify(logs)).not.toContain("token=")
  })

  test("create_session creates a root session in the current directory and responds in order", async () => {
    const { conn, sent } = fakeConn()
    const dirs: string[] = []
    const createCalls: { input: unknown; calls: number } = { input: undefined, calls: 0 }
    const attachCalls: string[] = []
    const order: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => {
        dirs.push(input.directory)
        return input.fn()
      },
      session: {
        get: async (sessionID) => ({ id: sessionID, directory: "/workspace/project-a" }) as any,
        children: async () => [],
        create: async (input) => {
          createCalls.calls += 1
          createCalls.input = input
          order.push("create")
          return { id: SessionID.make("ses_new"), directory: "/workspace/project-a", parentID: undefined } as any
        },
      },
      attachSession: async (id) => {
        attachCalls.push(id)
        order.push("attach")
        // The production attachSession is responsible for the heartbeat; the
        // mock follows the same contract so the ordering assertion below
        // exercises the real shape of: create -> attach -> heartbeat -> response.
        await (conn as any).heartbeat()
      },
    })
    ;(conn as any).heartbeat = async () => {
      order.push("heartbeat")
    }

    const response = expectResponse(conn, sent, "req_create")
    sender.handle({
      type: "command",
      id: "req_create",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await response.promise
    response.restore()

    expect(dirs).toEqual(["/workspace/project-a"])
    expect(createCalls.calls).toBe(1)
    expect(createCalls.input).toEqual({})
    expect(attachCalls).toEqual(["ses_new"])
    expect(order).toEqual(["create", "attach", "heartbeat"])
    expect(sent).toEqual([{ type: "response", id: "req_create", result: { protocolVersion: 1, sessionID: "ses_new" } }])
  })

  test("create_session rejects unsupported protocol versions and missing or invalid session IDs", async () => {
    const { conn, sent } = fakeConn()
    const createCalls: unknown[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      session: {
        get: async () => {
          throw new Error("must not look up session for invalid request")
        },
        children: async () => [],
        create: async (input) => {
          createCalls.push(input)
          return { id: SessionID.make("ses_unused") } as any
        },
      },
      attachSession: async () => {
        throw new Error("must not attach for invalid request")
      },
    })
    ;(conn as any).heartbeat = async () => {
      throw new Error("must not heartbeat for invalid request")
    }

    sender.handle({
      type: "command",
      id: "req_v2",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 2 },
    })
    sender.handle({
      type: "command",
      id: "req_no_session",
      command: "create_session",
      data: { protocolVersion: 1 },
    })
    sender.handle({
      type: "command",
      id: "req_bad_session",
      command: "create_session",
      sessionId: "not-a-session-id",
      data: { protocolVersion: 1 },
    })
    sender.handle({
      type: "command",
      id: "req_extra_field",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 1, extra: true },
    })

    expect(sent).toEqual([
      { type: "response", id: "req_v2", error: "invalid create_session command" },
      { type: "response", id: "req_no_session", error: "invalid create_session command" },
      { type: "response", id: "req_bad_session", error: "invalid create_session command" },
      { type: "response", id: "req_extra_field", error: "invalid create_session command" },
    ])
    expect(createCalls).toHaveLength(0)
  })

  test("create_session returns a sanitized error and never reports success when creation throws", async () => {
    const { conn, sent } = fakeConn()
    const logEntries: unknown[][] = []
    const attachCalls: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: { ...nolog, error: (...args: unknown[]) => logEntries.push(args) },
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => input.fn(),
      session: {
        get: async (sessionID) => ({ id: sessionID, directory: "/workspace/project-a" }) as any,
        children: async () => [],
        create: async () => {
          throw new Error("private failure detail: token=must-not-leak")
        },
      },
      attachSession: async (id) => {
        attachCalls.push(id)
      },
    })
    ;(conn as any).heartbeat = async () => {}

    const response = expectResponse(conn, sent, "req_create_failed")
    sender.handle({
      type: "command",
      id: "req_create_failed",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await response.promise
    response.restore()

    expect(sent).toEqual([{ type: "response", id: "req_create_failed", error: "failed to create session" }])
    expect(attachCalls).toEqual([])
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0]?.[0]).toBe("create session failed")
    expect(logEntries[0]?.[1]).toEqual({ id: "req_create_failed", error: "Error" })
    const flattened = JSON.stringify(logEntries)
    expect(flattened).not.toContain("must-not-leak")
    expect(flattened).not.toContain("token=")
  })

  test("create_session returns a sanitized error and never reports success when heartbeat throws", async () => {
    const { conn, sent } = fakeConn()
    const logEntries: unknown[][] = []
    const attachCalls: string[] = []
    const removeCalls: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: { ...nolog, error: (...args: unknown[]) => logEntries.push(args) },
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => input.fn(),
      session: {
        get: async (sessionID) => ({ id: sessionID, directory: "/workspace/project-a" }) as any,
        children: async () => [],
        create: async () => ({ id: SessionID.make("ses_new"), directory: "/workspace/project-a" }) as any,
        remove: async (id) => {
          removeCalls.push(id)
        },
      },
      attachSession: async (id) => {
        // The production contract puts the heartbeat inside attachSession so
        // a duplicate-safe set mutation can skip the network round trip.
        attachCalls.push(id)
        await (conn as any).heartbeat()
      },
    })
    ;(conn as any).heartbeat = async () => {
      throw new Error("private relay detail: credential=must-not-leak")
    }

    const response = expectResponse(conn, sent, "req_heartbeat_failed")
    sender.handle({
      type: "command",
      id: "req_heartbeat_failed",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await response.promise
    response.restore()

    expect(sent).toEqual([{ type: "response", id: "req_heartbeat_failed", error: "failed to create session" }])
    expect(attachCalls).toEqual(["ses_new"])
    // The orphan rollback must have been attempted for the created session.
    expect(removeCalls).toEqual(["ses_new"])
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0]?.[0]).toBe("create session failed")
    const flattened = JSON.stringify(logEntries)
    expect(flattened).not.toContain("must-not-leak")
    expect(flattened).not.toContain("credential=")
  })

  test("create_session rolls back the created session when attachSession fails", async () => {
    const { conn, sent } = fakeConn()
    const removeCalls: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => input.fn(),
      session: {
        get: async (sessionID) => ({ id: sessionID, directory: "/workspace/project-a" }) as any,
        children: async () => [],
        create: async () => ({ id: SessionID.make("ses_new"), directory: "/workspace/project-a" }) as any,
        remove: async (id) => {
          removeCalls.push(id)
        },
      },
      attachSession: async () => {
        throw new Error("attach failed: credential=must-not-leak")
      },
    })

    const response = expectResponse(conn, sent, "req_attach_failed")
    sender.handle({
      type: "command",
      id: "req_attach_failed",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await response.promise
    response.restore()

    // The created session was rolled back and the caller sees the generic
    // sanitized failure — never a partial success.
    expect(removeCalls).toEqual(["ses_new"])
    expect(sent).toEqual([{ type: "response", id: "req_attach_failed", error: "failed to create session" }])
  })

  test("create_session preserves the original attach error when the rollback itself fails", async () => {
    const { conn, sent } = fakeConn()
    const logEntries: unknown[][] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: { ...nolog, error: (...args: unknown[]) => logEntries.push(args) },
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => input.fn(),
      session: {
        get: async (sessionID) => ({ id: sessionID, directory: "/workspace/project-a" }) as any,
        children: async () => [],
        create: async () => ({ id: SessionID.make("ses_new"), directory: "/workspace/project-a" }) as any,
        remove: async () => {
          throw new Error("cleanup secondary failure")
        },
      },
      attachSession: async () => {
        throw new Error("primary attach failure: credential=must-not-leak")
      },
    })

    const response = expectResponse(conn, sent, "req_attach_then_cleanup_fail")
    sender.handle({
      type: "command",
      id: "req_attach_then_cleanup_fail",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await response.promise
    response.restore()

    // The caller sees the sanitized primary failure, not the cleanup error.
    expect(sent).toEqual([{ type: "response", id: "req_attach_then_cleanup_fail", error: "failed to create session" }])
    // The cleanup failure is logged for observability but does not leak the
    // primary attach error message to the response or to the cleanup log.
    const cleanupLog = logEntries.find((entry) => entry[0] === "create session cleanup failed")
    expect(cleanupLog).toBeDefined()
    const flattened = JSON.stringify(logEntries)
    expect(flattened).not.toContain("must-not-leak")
    expect(flattened).not.toContain("credential=")
  })

  test("create_session does not remove the created session when attach succeeds", async () => {
    const { conn, sent } = fakeConn()
    const removeCalls: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => input.fn(),
      session: {
        get: async (sessionID) => ({ id: sessionID, directory: "/workspace/project-a" }) as any,
        children: async () => [],
        create: async () => ({ id: SessionID.make("ses_new"), directory: "/workspace/project-a" }) as any,
        remove: async (id) => {
          removeCalls.push(id)
        },
      },
      attachSession: async () => {
        await (conn as any).heartbeat()
      },
    })
    ;(conn as any).heartbeat = async () => {}

    const response = expectResponse(conn, sent, "req_create_success")
    sender.handle({
      type: "command",
      id: "req_create_success",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await response.promise
    response.restore()

    expect(removeCalls).toEqual([])
    expect(sent).toEqual([
      { type: "response", id: "req_create_success", result: { protocolVersion: 1, sessionID: "ses_new" } },
    ])
  })

  test("create_session runs in the current session's directory", async () => {
    const { conn, sent } = fakeConn()
    const dirs: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => {
        dirs.push(input.directory)
        return input.fn()
      },
      session: {
        get: async (sessionID) => {
          if (sessionID === SessionID.make("ses_alpha")) return { id: sessionID, directory: "/workspace/alpha" } as any
          if (sessionID === SessionID.make("ses_beta")) return { id: sessionID, directory: "/workspace/beta" } as any
          throw new Error("unknown session")
        },
        children: async () => [],
        create: async () => ({ id: SessionID.make("ses_new") }) as any,
      },
      attachSession: async () => {},
    })
    ;(conn as any).heartbeat = async () => {}

    const first = expectResponse(conn, sent, "req_create_alpha")
    sender.handle({
      type: "command",
      id: "req_create_alpha",
      command: "create_session",
      sessionId: "ses_alpha",
      data: { protocolVersion: 1 },
    })
    await first.promise
    first.restore()

    const second = expectResponse(conn, sent, "req_create_beta")
    sender.handle({
      type: "command",
      id: "req_create_beta",
      command: "create_session",
      sessionId: "ses_beta",
      data: { protocolVersion: 1 },
    })
    await second.promise
    second.restore()

    expect(dirs).toEqual(["/workspace/alpha", "/workspace/beta"])
  })

  test("create_session dispatches attach and heartbeat for each call", async () => {
    const { conn, sent } = fakeConn()
    const attachCalls: string[] = []
    let heartbeatCalls = 0
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => input.fn(),
      session: {
        get: async (sessionID) => ({ id: sessionID, directory: "/workspace/project-a" }) as any,
        children: async () => [],
        create: async () => ({ id: SessionID.make("ses_same") }) as any,
      },
      attachSession: async (id) => {
        attachCalls.push(id)
        await (conn as any).heartbeat()
      },
    })
    ;(conn as any).heartbeat = async () => {
      heartbeatCalls += 1
    }

    const first = expectResponse(conn, sent, "req_create_same_first")
    sender.handle({
      type: "command",
      id: "req_create_same_first",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await first.promise
    first.restore()

    const second = expectResponse(conn, sent, "req_create_same_second")
    sender.handle({
      type: "command",
      id: "req_create_same_second",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await second.promise
    second.restore()

    // Each request is a separate create_session call, so the production
    // attachSession is invoked twice. The de-duplication of the attached set
    // itself is the responsibility of the attachSession hook (see the
    // duplicate-safe test below).
    expect(attachCalls).toEqual(["ses_same", "ses_same"])
    expect(heartbeatCalls).toBe(2)
  })

  test("create_session does not call heartbeat when the new session is already attached", async () => {
    const { conn, sent } = fakeConn()
    let heartbeatCalls = 0
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; fn: () => R }) => input.fn(),
      session: {
        get: async (sessionID) => ({ id: sessionID, directory: "/workspace/project-a" }) as any,
        children: async () => [],
        create: async () => ({ id: SessionID.make("ses_existing") }) as any,
      },
      attachSession: async () => {
        // Simulate a duplicate-safe attach: nothing to do, no heartbeat needed.
      },
    })
    ;(conn as any).heartbeat = async () => {
      heartbeatCalls += 1
    }

    const response = expectResponse(conn, sent, "req_create_existing")
    sender.handle({
      type: "command",
      id: "req_create_existing",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await response.promise
    response.restore()

    // The mock attachSession is a no-op (the duplicate-safe contract), so the
    // sender must NOT call conn.heartbeat() on its own.
    expect(heartbeatCalls).toBe(0)
    expect(sent).toEqual([
      { type: "response", id: "req_create_existing", result: { protocolVersion: 1, sessionID: "ses_existing" } },
    ])
  })

  test("create_session returns a sanitized error and never reports success when current session.get throws", async () => {
    const { conn, sent } = fakeConn()
    const logEntries: unknown[][] = []
    const createCalls: unknown[] = []
    const attachCalls: string[] = []
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/process-default",
      log: { ...nolog, error: (...args: unknown[]) => logEntries.push(args) },
      subscribe: fakeBus().subscribe,
      session: {
        get: async () => {
          throw new Error("private lookup failure: token=must-not-leak and path=/workspace/private")
        },
        children: async () => [],
        create: async (input) => {
          createCalls.push(input)
          return { id: SessionID.make("ses_unused") } as any
        },
      },
      attachSession: async (id) => {
        attachCalls.push(id)
      },
    })
    ;(conn as any).heartbeat = async () => {}

    const response = expectResponse(conn, sent, "req_create_get_failed")
    sender.handle({
      type: "command",
      id: "req_create_get_failed",
      command: "create_session",
      sessionId: "ses_current",
      data: { protocolVersion: 1 },
    })
    await response.promise
    response.restore()

    expect(sent).toEqual([{ type: "response", id: "req_create_get_failed", error: "failed to create session" }])
    expect(createCalls).toEqual([])
    expect(attachCalls).toEqual([])
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0]?.[0]).toBe("create session failed")
    // Only the error class is logged — no message, no path, no token.
    expect(logEntries[0]?.[1]).toEqual({ id: "req_create_get_failed", error: "Error" })
    const flattened = JSON.stringify(logEntries)
    expect(flattened).not.toContain("must-not-leak")
    expect(flattened).not.toContain("token=")
    expect(flattened).not.toContain("/workspace/private")
    // The request payload itself must never reach the log.
    expect(flattened).not.toContain("ses_current")
  })
})
// kilocode_change end
