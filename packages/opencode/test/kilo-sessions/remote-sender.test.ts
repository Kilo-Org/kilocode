import { describe, expect, test } from "bun:test"
// kilocode_change start
import { afterEach, mock, spyOn } from "bun:test"
// kilocode_change end
import { RemoteSender } from "../../src/kilo-sessions/remote-sender"
import type { RemoteWS } from "../../src/kilo-sessions/remote-ws"
import type { RemoteProtocol } from "../../src/kilo-sessions/remote-protocol"
// kilocode_change start
import { SessionPrompt } from "../../src/session/prompt"
import { Question } from "../../src/question"
import { PermissionNext } from "../../src/permission/next"
// kilocode_change end

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
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue({} as never)
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: () => Promise<unknown>; fn: () => R }) => input.fn(),
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
    expect(prompt).toHaveBeenCalledWith({
      sessionID: "ses_x",
      parts: [{ type: "text", text: "hello" }],
      model: { providerID: "kilo", modelID: "anthropic/claude-sonnet-4-20250514" },
    })
  })

  test("send_message keeps kilocode-prefixed model unchanged before internal conversion", async () => {
    const { conn } = fakeConn()
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue({} as never)
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: () => Promise<unknown>; fn: () => R }) => input.fn(),
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

    expect(prompt).toHaveBeenCalledWith({
      sessionID: "ses_x",
      parts: [{ type: "text", text: "hello" }],
      model: { providerID: "kilo", modelID: "gpt-5-mini" },
    })
  })

  test("send_message rejects structured model on remote path", () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: () => Promise<unknown>; fn: () => R }) => input.fn(),
    })

    sender.handle({
      type: "command",
      id: "req_model_alias",
      command: "send_message",
      data: {
        sessionID: "ses_x",
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "kilocode", modelID: "gpt-5-mini" },
      },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe("response")
    expect(sent[0].id).toBe("req_model_alias")
    expect(sent[0].error).toContain("invalid send_message data")
  })

  test("send_message does not special-case kilo-prefixed model", async () => {
    const { conn, sent } = fakeConn()
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue({} as never)
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async <R>(input: { directory: string; init?: () => Promise<unknown>; fn: () => R }) => input.fn(),
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
    expect(prompt).toHaveBeenCalledWith({
      sessionID: "ses_x",
      parts: [{ type: "text", text: "hello" }],
      model: { providerID: "kilo", modelID: "kilo/gpt-5-mini" },
    })
  })
  // kilocode_change end

  test("question_reply sends response after work completes", async () => {
    const { conn, sent } = fakeConn()
    let provideCalled = false
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async () => {
        provideCalled = true
        return {} as any
      },
    })

    sender.handle({
      type: "command",
      id: "req_q",
      command: "question_reply",
      data: { requestID: "r1", answers: [["yes"]] },
    })

    // Response not sent synchronously — waits for provide to finish
    expect(sent).toHaveLength(0)

    await new Promise((r) => setTimeout(r, 10))

    expect(provideCalled).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ type: "response", id: "req_q", result: {} })
  })

  test("question_reply error sends error response", async () => {
    const { conn, sent } = fakeConn()
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async () => {
        throw new Error("boom")
      },
    })

    sender.handle({
      type: "command",
      id: "req_qe",
      command: "question_reply",
      data: { requestID: "r1", answers: [["yes"]] },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe("response")
    expect(sent[0].id).toBe("req_qe")
    expect(sent[0].error).toContain("boom")
  })

  test("question_reject sends response after work completes", async () => {
    const { conn, sent } = fakeConn()
    let provideCalled = false
    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: fakeBus().subscribe,
      provide: async () => {
        provideCalled = true
        return {} as any
      },
    })

    sender.handle({
      type: "command",
      id: "req_qr",
      command: "question_reject",
      data: { requestID: "r1" },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(provideCalled).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ type: "response", id: "req_qr", result: {} })
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

    spyOn(Question, "list").mockResolvedValue([
      { id: "question_1", sessionID: "ses_target", questions: [{ type: "text", text: "Continue?" }] } as any,
      { id: "question_2", sessionID: "ses_other", questions: [{ type: "text", text: "Unrelated?" }] } as any,
    ])
    spyOn(PermissionNext, "list").mockResolvedValue([])

    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
      provide: async (input: any) => input.fn(),
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

    spyOn(Question, "list").mockResolvedValue([])
    spyOn(PermissionNext, "list").mockResolvedValue([
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
    ])

    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
      provide: async (input: any) => input.fn(),
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

  test("subscribe does not replay state for sessions with no pending questions or permissions", async () => {
    const { conn, sent } = fakeConn()
    const bus = fakeBus()

    spyOn(Question, "list").mockResolvedValue([{ id: "question_1", sessionID: "ses_other", questions: [] } as any])
    spyOn(PermissionNext, "list").mockResolvedValue([
      {
        id: "permission_1",
        sessionID: "ses_other",
        permission: "file.write",
        patterns: [],
        metadata: {},
        always: [],
      } as any,
    ])

    const sender = RemoteSender.create({
      conn,
      directory: "/tmp/test",
      log: nolog,
      subscribe: bus.subscribe,
      provide: async (input: any) => input.fn(),
    })

    sender.handle({ type: "subscribe", sessionId: "ses_target" })
    await new Promise((r) => setTimeout(r, 10))

    const events = sent.filter((m: any) => m.type === "event")
    expect(events).toHaveLength(0)
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
