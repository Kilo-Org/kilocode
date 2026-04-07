import { describe, expect, test } from "bun:test"
import { RemoteProtocol } from "../../src/kilo-sessions/remote-protocol"

describe("RemoteProtocol", () => {
  // --- Outbound (CLI → DO) ---

  test("valid heartbeat parses", () => {
    const msg = {
      type: "heartbeat",
      sessions: [{ id: "ses_1", status: "busy", title: "Fix auth" }],
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessions).toHaveLength(1)
      expect(result.data.sessions[0].id).toBe("ses_1")
    }
  })

  test("heartbeat with parentSessionId parses", () => {
    const msg = {
      type: "heartbeat",
      sessions: [{ id: "ses_child", status: "busy", title: "Sub task", parentSessionId: "ses_root" }],
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessions[0].parentSessionId).toBe("ses_root")
    }
  })

  test("valid event parses", () => {
    const msg = {
      type: "event",
      sessionId: "ses_1",
      event: "message.updated",
      data: { text: "hello" },
    }
    const result = RemoteProtocol.Event.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessionId).toBe("ses_1")
      expect(result.data.event).toBe("message.updated")
    }
  })

  test("valid response parses", () => {
    const msg = { type: "response", id: "req_1", result: { ok: true } }
    const result = RemoteProtocol.Response.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe("req_1")
      expect(result.data.result).toEqual({ ok: true })
      expect(result.data.error).toBeUndefined()
    }
  })

  test("response with error parses", () => {
    const msg = { type: "response", id: "req_2", error: "not found" }
    const result = RemoteProtocol.Response.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.error).toBe("not found")
      expect(result.data.result).toBeUndefined()
    }
  })

  // --- Inbound (DO → CLI) ---

  test("valid subscribe parses", () => {
    const msg = { type: "subscribe", sessionId: "ses_1" }
    const result = RemoteProtocol.Subscribe.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessionId).toBe("ses_1")
    }
  })

  test("valid unsubscribe parses", () => {
    const msg = { type: "unsubscribe", sessionId: "ses_1" }
    const result = RemoteProtocol.Unsubscribe.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessionId).toBe("ses_1")
    }
  })

  test("valid command parses", () => {
    const msg = {
      type: "command",
      id: "cmd_1",
      command: "send_message",
      sessionId: "ses_1",
      data: { text: "hi" },
    }
    const result = RemoteProtocol.Command.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe("cmd_1")
      expect(result.data.command).toBe("send_message")
      expect(result.data.sessionId).toBe("ses_1")
    }
  })

  test("command without sessionId parses", () => {
    const msg = {
      type: "command",
      id: "cmd_2",
      command: "list_sessions",
      data: null,
    }
    const result = RemoteProtocol.Command.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessionId).toBeUndefined()
    }
  })

  test("valid system parses", () => {
    const msg = {
      type: "system",
      event: "cli.connected",
      data: { pid: 1234 },
    }
    const result = RemoteProtocol.System.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.event).toBe("cli.connected")
    }
  })

  // --- Discriminated unions ---

  test("outbound union picks heartbeat", () => {
    const msg = { type: "heartbeat", sessions: [] }
    const result = RemoteProtocol.Outbound.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("heartbeat")
    }
  })

  test("outbound union picks event", () => {
    const msg = {
      type: "event",
      sessionId: "ses_1",
      event: "session.updated",
      data: {},
    }
    const result = RemoteProtocol.Outbound.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("event")
    }
  })

  test("outbound union picks response", () => {
    const msg = { type: "response", id: "r1" }
    const result = RemoteProtocol.Outbound.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("response")
    }
  })

  test("inbound union picks subscribe", () => {
    const msg = { type: "subscribe", sessionId: "ses_1" }
    const result = RemoteProtocol.Inbound.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("subscribe")
    }
  })

  test("inbound union picks command", () => {
    const msg = {
      type: "command",
      id: "c1",
      command: "ping",
      data: null,
    }
    const result = RemoteProtocol.Inbound.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("command")
    }
  })

  test("inbound union picks system", () => {
    const msg = { type: "system", event: "shutdown", data: null }
    const result = RemoteProtocol.Inbound.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("system")
    }
  })

  // --- Rejection ---

  test("outbound rejects unknown type", () => {
    const msg = { type: "bogus", data: 1 }
    const result = RemoteProtocol.Outbound.safeParse(msg)
    expect(result.success).toBe(false)
  })

  test("inbound rejects unknown type", () => {
    const msg = { type: "bogus", data: 1 }
    const result = RemoteProtocol.Inbound.safeParse(msg)
    expect(result.success).toBe(false)
  })

  test("heartbeat rejects missing sessions", () => {
    const msg = { type: "heartbeat" }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(false)
  })

  test("event rejects missing sessionId", () => {
    const msg = { type: "event", event: "x", data: null }
    const result = RemoteProtocol.Event.safeParse(msg)
    expect(result.success).toBe(false)
  })

  test("command rejects missing id", () => {
    const msg = { type: "command", command: "ping", data: null }
    const result = RemoteProtocol.Command.safeParse(msg)
    expect(result.success).toBe(false)
  })

  test("subscribe rejects missing sessionId", () => {
    const msg = { type: "subscribe" }
    const result = RemoteProtocol.Subscribe.safeParse(msg)
    expect(result.success).toBe(false)
  })

  test("session info rejects missing fields", () => {
    const result = RemoteProtocol.SessionInfo.safeParse({ id: "x" })
    expect(result.success).toBe(false)
  })

  test("valid heartbeat_ack parses", () => {
    const msg = { type: "heartbeat_ack" }
    const result = RemoteProtocol.HeartbeatAck.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("heartbeat_ack")
    }
  })

  test("inbound union picks heartbeat_ack", () => {
    const msg = { type: "heartbeat_ack" }
    const result = RemoteProtocol.Inbound.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("heartbeat_ack")
    }
  })
})
