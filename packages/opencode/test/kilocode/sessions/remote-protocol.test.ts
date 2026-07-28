import { describe, expect, test } from "bun:test"
import { RemoteProtocol } from "../../../src/kilo-sessions/remote-protocol"

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

  test("heartbeat serializes sessions only", () => {
    const msg = { type: "heartbeat", sessions: [{ id: "ses_1", status: "idle", title: "t" }] }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty("focused")
      expect(result.data).not.toHaveProperty("open")
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

  // kilocode_change - K1 W1: instance advertisement + per-session platform

  test("heartbeat without instance still parses (legacy compatibility)", () => {
    const msg = { type: "heartbeat", sessions: [{ id: "ses_1", status: "busy", title: "Fix auth" }] }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.instance).toBeUndefined()
    }
  })

  test("heartbeat round-trips instance advertisement", () => {
    const msg = {
      type: "heartbeat",
      sessions: [],
      instance: { name: "mbp-igor", projectName: "cloud", version: "1.2.3" },
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.instance).toEqual({ name: "mbp-igor", projectName: "cloud", version: "1.2.3" })
    }
    // round-trip via JSON
    const json = JSON.parse(JSON.stringify(result.success ? result.data : null))
    const result2 = RemoteProtocol.Heartbeat.safeParse(json)
    expect(result2.success).toBe(true)
    if (result2.success) {
      expect(result2.data.instance).toEqual({ name: "mbp-igor", projectName: "cloud", version: "1.2.3" })
    }
  })

  test("instance advertisement version is optional", () => {
    const msg = {
      type: "heartbeat",
      sessions: [],
      instance: { name: "h", projectName: "p" },
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.instance?.version).toBeUndefined()
    }
  })

  test("instance advertisement rejects empty name", () => {
    const msg = {
      type: "heartbeat",
      sessions: [],
      instance: { name: "", projectName: "p" },
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(false)
  })

  test("instance advertisement rejects oversized name", () => {
    const msg = {
      type: "heartbeat",
      sessions: [],
      instance: { name: "x".repeat(65), projectName: "p" },
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(false)
  })

  test("instance advertisement rejects oversized projectName", () => {
    const msg = {
      type: "heartbeat",
      sessions: [],
      instance: { name: "h", projectName: "p".repeat(65) },
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(false)
  })

  test("instance advertisement rejects oversized version", () => {
    const msg = {
      type: "heartbeat",
      sessions: [],
      instance: { name: "h", projectName: "p", version: "v".repeat(33) },
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(false)
  })

  test("session info accepts optional platform", () => {
    const msg = {
      type: "heartbeat",
      sessions: [{ id: "s1", status: "busy", title: "t", platform: "vscode" }],
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessions[0].platform).toBe("vscode")
    }
  })

  test("session info platform optional (legacy)", () => {
    const msg = {
      type: "heartbeat",
      sessions: [{ id: "s1", status: "busy", title: "t" }],
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessions[0].platform).toBeUndefined()
    }
  })

  test("session info rejects oversized platform", () => {
    const msg = {
      type: "heartbeat",
      sessions: [{ id: "s1", status: "busy", title: "t", platform: "p".repeat(33) }],
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(false)
  })

  test("full heartbeat round-trips sessions + instance", () => {
    const msg = {
      type: "heartbeat",
      protocolVersion: "1.0.0",
      sessions: [
        { id: "ses_1", status: "busy", title: "Fix auth", platform: "cli" },
        { id: "ses_2", status: "idle", title: "Sub task", parentSessionId: "ses_1", platform: "vscode" },
      ],
      instance: { name: "mbp-igor", projectName: "cloud", version: "1.2.3" },
    }
    const json = JSON.parse(JSON.stringify(msg))
    const result = RemoteProtocol.Heartbeat.safeParse(json)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessions).toHaveLength(2)
      expect(result.data.sessions[0].platform).toBe("cli")
      expect(result.data.sessions[1].platform).toBe("vscode")
      expect(result.data.instance).toEqual({ name: "mbp-igor", projectName: "cloud", version: "1.2.3" })
      expect(result.data.protocolVersion).toBe("1.0.0")
    }
  })

  test("heartbeat without capabilities parses", () => {
    const result = RemoteProtocol.Heartbeat.safeParse({
      type: "heartbeat",
      sessions: [],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.capabilities).toBeUndefined()
    }
  })

  test("heartbeat with capabilities.attachments parses", () => {
    const result = RemoteProtocol.Heartbeat.safeParse({
      type: "heartbeat",
      sessions: [],
      capabilities: { attachments: true },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.capabilities?.attachments).toBe(true)
    }
  })

  test("heartbeat with capabilities and no attachments key parses", () => {
    const result = RemoteProtocol.Heartbeat.safeParse({
      type: "heartbeat",
      sessions: [],
      capabilities: {},
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.capabilities?.attachments).toBeUndefined()
    }
  })

  test("heartbeat rejects non-boolean capabilities.attachments", () => {
    const result = RemoteProtocol.Heartbeat.safeParse({
      type: "heartbeat",
      sessions: [],
      capabilities: { attachments: "yes" },
    })
    expect(result.success).toBe(false)
  })

  test("outbound union accepts heartbeat with capabilities", () => {
    const result = RemoteProtocol.Outbound.safeParse({
      type: "heartbeat",
      sessions: [],
      capabilities: { attachments: true },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("heartbeat")
    }
  })
})
