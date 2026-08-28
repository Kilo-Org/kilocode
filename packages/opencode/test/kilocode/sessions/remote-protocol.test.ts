import { describe, expect, test } from "bun:test"
import { entries } from "remeda"
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

  // kilocode_change - PR link advertise (plan 8.4)

  test("session info accepts optional prLink", () => {
    const msg = {
      type: "heartbeat",
      sessions: [
        {
          id: "s1",
          status: "busy",
          title: "t",
          prLink: { platform: "github", prUrl: "https://github.com/o/r/pull/1", prNumber: 1 },
        },
      ],
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessions[0].prLink).toEqual({
        platform: "github",
        prUrl: "https://github.com/o/r/pull/1",
        prNumber: 1,
      })
    }
  })

  test("session info prLink optional (legacy)", () => {
    const msg = {
      type: "heartbeat",
      sessions: [{ id: "s1", status: "busy", title: "t" }],
    }
    const result = RemoteProtocol.Heartbeat.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessions[0].prLink).toBeUndefined()
    }
  })

  test("session info rejects empty prLink platform", () => {
    const msg = {
      type: "heartbeat",
      sessions: [
        { id: "s1", status: "busy", title: "t", prLink: { platform: "", prUrl: "https://x/pull/1", prNumber: 1 } },
      ],
    }
    expect(RemoteProtocol.Heartbeat.safeParse(msg).success).toBe(false)
  })

  test("session info rejects oversized prLink prUrl", () => {
    const msg = {
      type: "heartbeat",
      sessions: [
        {
          id: "s1",
          status: "busy",
          title: "t",
          prLink: { platform: "github", prUrl: "https://x/" + "a".repeat(2048), prNumber: 1 },
        },
      ],
    }
    expect(RemoteProtocol.Heartbeat.safeParse(msg).success).toBe(false)
  })

  test("session info rejects non-positive prLink prNumber", () => {
    const msg = {
      type: "heartbeat",
      sessions: [
        {
          id: "s1",
          status: "busy",
          title: "t",
          prLink: { platform: "github", prUrl: "https://x/pull/0", prNumber: 0 },
        },
      ],
    }
    expect(RemoteProtocol.Heartbeat.safeParse(msg).success).toBe(false)
  })

  test("full heartbeat round-trips prLink", () => {
    const msg = {
      type: "heartbeat",
      sessions: [
        {
          id: "s1",
          status: "busy",
          title: "t",
          prLink: { platform: "gitlab", prUrl: "https://gitlab.com/g/p/-/merge_requests/7", prNumber: 7 },
        },
      ],
    }
    const json = JSON.parse(JSON.stringify(msg))
    const result = RemoteProtocol.Heartbeat.safeParse(json)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessions[0].prLink).toEqual({
        platform: "gitlab",
        prUrl: "https://gitlab.com/g/p/-/merge_requests/7",
        prNumber: 7,
      })
    }
  })
})

// Canonical v1 examples match the relay and SDK schema tests.
describe("RemoteProtocol browser jobs v1", () => {
  const requestId = "00000000-0000-4000-8000-000000000001"
  const handle = {
    providerId: "bp_00000000-0000-4000-8000-000000000002",
    browserTaskId: "bt_00000000-0000-4000-8000-000000000003",
    jobId: "bj_00000000-0000-4000-8000-000000000004",
    invocationId: `b1.1787875200000.${"a".repeat(64)}`,
  } as const
  const owner = { parentSessionId: "ses_parent", parentProof: "b".repeat(64) }
  const binding = { providerId: handle.providerId, generation: 1 }
  const bound = { ...handle, generation: 1 }
  const tab = { tabId: 7, title: "Example", url: "https://example.com/", effectiveMode: "safe" } as const
  const job = {
    ...bound,
    payloadFingerprint: "c".repeat(64),
    createdAt: "2026-08-28T00:00:00.000Z",
    expiresAt: "2026-09-04T00:00:00.000Z",
    deadlines: { queue: "2026-08-28T00:10:00.000Z", approval: "2026-08-28T00:02:00.000Z" },
    status: "awaiting_approval",
  } as const
  const completed = {
    ...handle,
    status: "succeeded",
    reason: "completed",
    effectsUncertain: false,
    summary: "Read the example page",
    evidence: [{ text: "Example Domain", title: tab.title, url: tab.url }],
  } satisfies RemoteProtocol.BrowserResult
  const finished = { ...job, status: "succeeded", approvedTab: tab, result: completed } as const
  const invoke = {
    type: "browser_request",
    requestId,
    operation: "invoke",
    owner,
    providerId: handle.providerId,
    invocationId: handle.invocationId,
    goal: "Read the example page",
  } as const
  const registration = {
    type: "provider_register",
    requestId,
    providerId: handle.providerId,
    generation: 0,
    providerProof: "d".repeat(64),
    label: "Work browser",
    enabled: true,
  } as const
  const provider = {
    providerId: handle.providerId,
    label: registration.label,
    availability: "available",
    queueDepth: 0,
  } as const
  const requests = [
    { type: "browser_request", requestId, operation: "list" },
    { type: "browser_request", requestId, operation: "list", cursor: handle.providerId },
    invoke,
    { ...invoke, browserTaskId: handle.browserTaskId },
    ...(["status", "cancel"] as const).flatMap<RemoteProtocol.BrowserRequest>((operation) => [
      { type: "browser_request", requestId, operation, owner, browserTaskId: handle.browserTaskId },
      {
        type: "browser_request",
        requestId,
        operation,
        owner,
        browserTaskId: handle.browserTaskId,
        jobId: handle.jobId,
      },
    ]),
    { type: "browser_request", requestId, operation: "recover", owner, invocationId: handle.invocationId },
  ] satisfies RemoteProtocol.BrowserRequest[]
  const responses = [
    { type: "browser_response", requestId, response: { kind: "providers", providers: [] } },
    {
      type: "browser_response",
      requestId,
      response: { kind: "providers", providers: [provider], nextCursor: handle.providerId },
    },
    ...(["invoke", "cancel"] as const).map<RemoteProtocol.BrowserResponse>((operation) => ({
      type: "browser_response",
      requestId,
      response: { kind: "ack", operation, ...handle },
    })),
    { type: "browser_response", requestId, response: { kind: "status", job } },
    { type: "browser_response", requestId, response: { kind: "recovered", job: finished } },
    { type: "browser_response", requestId, response: { kind: "not_found", invocationId: handle.invocationId } },
    {
      type: "browser_response",
      requestId,
      response: { kind: "error", code: "provider_unavailable", message: "Open the browser panel", retryable: true },
    },
    {
      type: "browser_response",
      requestId,
      response: {
        kind: "error",
        code: "owner_mismatch",
        message: "This parent does not own the job",
        retryable: false,
      },
    },
  ] satisfies RemoteProtocol.BrowserResponse[]
  const events = [
    { type: "browser_event", requestId, event: "progress", job },
    { type: "browser_event", requestId, event: "result", result: completed },
  ] satisfies RemoteProtocol.BrowserEvent[]
  const sent = [
    registration,
    {
      ...registration,
      generation: 1,
      recovery: { invocationId: handle.invocationId, tabId: tab.tabId, tabClosed: true, locksDrained: true },
    },
    { type: "provider_heartbeat", requestId, ...binding, cursor: handle.jobId },
    { type: "provider_approval", ...bound, approval: { decision: "approved", tab } },
    { type: "provider_approval", ...bound, approval: { decision: "denied", reason: "approval_denied" } },
    { type: "provider_result", ...bound, tab, result: completed },
    { type: "provider_quiesced", ...bound, tabId: tab.tabId },
    { type: "provider_unavailable", ...binding, reason: "provider_lost", effectsUncertain: true },
    { type: "provider_cancel", ...bound },
  ] satisfies RemoteProtocol.BrowserProviderOutbound[]
  const received = [
    { type: "provider_job", job, goal: invoke.goal, ownerLabel: "Parent chat" },
    { type: "provider_job_cancel", ...bound, reason: "cancelled" },
    { type: "provider_snapshot", requestId, ...binding, jobs: [job, finished], nextCursor: handle.jobId },
    { type: "provider_snapshot", ...binding, jobs: [] },
    { type: "provider_lease_ack", requestId, ...binding, leaseExpiresAt: "2026-08-28T00:00:15.000Z" },
  ] satisfies RemoteProtocol.BrowserProviderInbound[]
  const operations = [
    { operation: "list" },
    { operation: "run", provider_id: handle.providerId, goal: invoke.goal },
    { operation: "run", provider_id: handle.providerId, goal: invoke.goal, browser_task_id: handle.browserTaskId },
    ...(["status", "cancel"] as const).flatMap<RemoteProtocol.BrowserTaskArguments>((operation) => [
      { operation, browser_task_id: handle.browserTaskId },
      { operation, browser_task_id: handle.browserTaskId, job_id: handle.jobId },
    ]),
    { operation: "recover" },
  ] satisfies RemoteProtocol.BrowserTaskArguments[]
  const directions = [
    {
      name: "CLI requests",
      schema: RemoteProtocol.BrowserRequest,
      composite: RemoteProtocol.OutboundWithBrowser,
      frames: requests,
    },
    {
      name: "CLI replies",
      schema: RemoteProtocol.BrowserCLIInbound,
      composite: RemoteProtocol.InboundWithBrowser,
      frames: [...responses, ...events],
    },
    {
      name: "provider outbound",
      schema: RemoteProtocol.BrowserProviderOutbound,
      composite: RemoteProtocol.WebOutboundWithBrowser,
      frames: sent,
    },
    {
      name: "provider inbound",
      schema: RemoteProtocol.BrowserProviderInbound,
      composite: RemoteProtocol.WebInboundWithBrowser,
      frames: received,
    },
  ]

  test.each(directions)("round-trips canonical $name only in its opt-in direction", ({ schema, composite, frames }) => {
    for (const frame of frames) {
      const wire = JSON.parse(JSON.stringify(frame))
      expect(schema.parse(wire)).toEqual(frame)
      expect(composite.parse(wire)).toEqual(frame)
      expect(schema.safeParse({ ...frame, extra: true }).success).toBe(false)
      expect(composite.safeParse({ ...frame, extra: true }).success).toBe(false)
      for (const other of directions) {
        if (other.schema === schema) continue
        expect(other.schema.safeParse(wire).success).toBe(false)
        expect(other.composite.safeParse(wire).success).toBe(false)
      }
      for (const legacy of [
        RemoteProtocol.Outbound,
        RemoteProtocol.Inbound,
        RemoteProtocol.WebOutbound,
        RemoteProtocol.WebInbound,
      ]) {
        expect(legacy.safeParse(wire).success).toBe(false)
      }
    }
  })

  test("enforces the model operation matrix without model-selected authority", () => {
    for (const args of operations) {
      expect(RemoteProtocol.BrowserTaskArguments.parse(args)).toEqual(args)
      for (const field of [
        "owner",
        "parentSessionId",
        "parentProof",
        "providerProof",
        "userId",
        "connectionId",
        "invocationId",
        "sessionID",
        "messageID",
        "callID",
        "extra",
      ]) {
        expect(RemoteProtocol.BrowserTaskArguments.safeParse({ ...args, [field]: "untrusted" }).success).toBe(false)
      }
    }
    for (const args of [
      { operation: "run", goal: invoke.goal },
      { operation: "run", provider_id: handle.providerId },
      { operation: "invoke", provider_id: handle.providerId, goal: invoke.goal },
      { operation: "list", provider_id: handle.providerId },
    ]) {
      expect(RemoteProtocol.BrowserTaskArguments.safeParse(args).success).toBe(false)
    }
  })

  test("requires a conversation for status and cancel, even with an exact job ID", () => {
    for (const operation of ["status", "cancel"]) {
      expect(RemoteProtocol.BrowserTaskArguments.safeParse({ operation, job_id: handle.jobId }).success).toBe(false)
      const frame = { type: "browser_request", requestId, operation, owner, jobId: handle.jobId }
      expect(RemoteProtocol.BrowserRequest.safeParse(frame).success).toBe(false)
      expect(RemoteProtocol.BrowserRequest.safeParse({ ...frame, browserTaskId: handle.jobId }).success).toBe(false)
      expect(
        RemoteProtocol.BrowserRequest.safeParse({ ...frame, browserTaskId: handle.browserTaskId, owner: undefined })
          .success,
      ).toBe(false)
    }
  })

  test("keeps recovery lookup-only with trusted parent and invocation", () => {
    const recover = {
      type: "browser_request",
      requestId,
      operation: "recover",
      owner,
      invocationId: handle.invocationId,
    }
    for (const extra of [
      { goal: invoke.goal },
      { providerId: handle.providerId },
      { jobId: handle.jobId },
      { browserTaskId: handle.browserTaskId },
      { owner: undefined },
      { invocationId: undefined },
    ]) {
      expect(RemoteProtocol.BrowserRequest.safeParse({ ...recover, ...extra }).success).toBe(false)
    }
    for (const extra of [
      { goal: invoke.goal },
      { provider_id: handle.providerId },
      { browser_task_id: handle.browserTaskId },
      { job_id: handle.jobId },
    ]) {
      expect(RemoteProtocol.BrowserTaskArguments.safeParse({ operation: "recover", ...extra }).success).toBe(false)
    }
  })

  test("keeps private proofs only on owned requests and provider registration", () => {
    for (const direction of directions) {
      for (const frame of direction.frames) {
        for (const extra of [
          { parentProof: owner.parentProof },
          ...(frame.type === "browser_request" ? [] : [{ owner }]),
          ...(frame.type === "provider_register" ? [] : [{ providerProof: registration.providerProof }]),
        ]) {
          expect(direction.schema.safeParse({ ...frame, ...extra }).success).toBe(false)
        }
      }
    }
    expect(
      RemoteProtocol.BrowserRequest.safeParse({ type: "browser_request", requestId, operation: "list", owner }).success,
    ).toBe(false)
    expect(
      RemoteProtocol.BrowserRequest.safeParse({ ...invoke, owner: { parentSessionId: owner.parentSessionId } }).success,
    ).toBe(false)
    expect(
      RemoteProtocol.BrowserProviderOutbound.safeParse({ ...registration, providerProof: undefined }).success,
    ).toBe(false)
    expect(
      RemoteProtocol.BrowserResponse.safeParse({
        type: "browser_response",
        requestId,
        response: { kind: "providers", providers: [{ ...provider, providerProof: registration.providerProof }] },
      }).success,
    ).toBe(false)
    expect(
      RemoteProtocol.BrowserProviderInbound.safeParse({
        type: "provider_job",
        job: { ...job, owner },
        goal: invoke.goal,
        ownerLabel: "Parent chat",
      }).success,
    ).toBe(false)
    expect(
      RemoteProtocol.BrowserEvent.safeParse({
        type: "browser_event",
        requestId,
        event: "result",
        result: { ...completed, parentProof: owner.parentProof },
      }).success,
    ).toBe(false)
  })

  test("redacts proof values and attacker-controlled key names from errors and previews", () => {
    const secret = "private-proof-must-not-appear"
    for (const { schema, composite, frames } of directions) {
      for (const frame of frames) {
        const input = {
          ...frame,
          [secret]: true,
          owner: { ...owner, parentProof: secret, [secret]: true },
          providerProof: secret,
        }
        for (const parser of [schema, composite]) {
          const parsed = parser.safeParse(input)
          expect(parsed.success).toBe(false)
          if (parsed.success) throw new Error("Invalid proof-bearing input was accepted")
          expect(parsed.error.message).not.toContain(secret)
          expect(JSON.stringify(parsed.error)).not.toContain(secret)
        }
        expect(RemoteProtocol.Preview.parse(input)).toEqual({ type: frame.type })
      }
    }
    const parsed = RemoteProtocol.BrowserTaskArguments.safeParse({ operation: "recover", [secret]: true })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error("Model-selected proof was accepted")
    expect(parsed.error.message).not.toContain(secret)
    expect(JSON.stringify(parsed.error)).not.toContain(secret)
  })

  test.each([
    { requestId: "request-1" },
    { requestId: "" },
    { providerId: handle.browserTaskId },
    { browserTaskId: handle.jobId },
    { providerId: "bp_not-a-uuid" },
    { invocationId: `b1.0.${"a".repeat(64)}` },
    { invocationId: `b1.01787875200000.${"a".repeat(64)}` },
    { invocationId: `b1.8640000000000001.${"a".repeat(64)}` },
    { invocationId: `b1.9007199254740992.${"a".repeat(64)}` },
    { invocationId: `b1.1787875200000.${"A".repeat(64)}` },
    { owner: { ...owner, parentSessionId: "parent" } },
    { owner: { ...owner, connectionId: "untrusted" } },
  ])("rejects malformed request identities: %j", (fields) => {
    expect(RemoteProtocol.BrowserRequest.safeParse({ ...invoke, ...fields }).success).toBe(false)
  })

  test("requires correlation IDs and separates acknowledgement, progress, and results", () => {
    for (const frame of requests) {
      expect(RemoteProtocol.BrowserRequest.safeParse({ ...frame, requestId: undefined }).success).toBe(false)
    }
    for (const frame of [...responses, ...events]) {
      expect(RemoteProtocol.BrowserCLIInbound.safeParse({ ...frame, requestId: undefined }).success).toBe(false)
    }
    expect(
      RemoteProtocol.BrowserResponse.safeParse({
        type: "browser_response",
        requestId,
        response: { kind: "ack", operation: "cancel", ...handle, result: completed },
      }).success,
    ).toBe(false)
    expect(
      RemoteProtocol.BrowserEvent.safeParse({ type: "browser_event", requestId, event: "progress", job: finished })
        .success,
    ).toBe(false)
    expect(
      RemoteProtocol.BrowserEvent.safeParse({
        type: "browser_event",
        requestId,
        event: "result",
        result: { ...completed, status: "running" },
      }).success,
    ).toBe(false)
  })

  const statuses = {
    queued: null,
    awaiting_approval: null,
    running: null,
    succeeded: completed,
    failed: { ...completed, status: "failed", reason: "runner_failed", effectsUncertain: false },
    cancelled: { ...completed, status: "cancelled", reason: "cancelled", effectsUncertain: false },
    interrupted: { ...completed, status: "interrupted", reason: "effects_uncertain", effectsUncertain: true },
    timed_out: { ...completed, status: "timed_out", reason: "execution_timeout", effectsUncertain: true },
  } satisfies Record<RemoteProtocol.BrowserJobSnapshot["status"], RemoteProtocol.BrowserResult | null>

  test.each(entries(statuses))("enforces the observable result contract for %s", (status, result) => {
    const snapshot = {
      ...job,
      status,
      ...(status === "running" ? { approvedTab: tab } : {}),
      ...(result ? { result } : {}),
    }
    expect(RemoteProtocol.BrowserJobSnapshot.parse(snapshot)).toEqual(snapshot)
    if (result) {
      const frame = { type: "browser_event", requestId, event: "result", result } satisfies RemoteProtocol.BrowserEvent
      expect(RemoteProtocol.BrowserEvent.parse(frame)).toEqual(frame)
      expect(RemoteProtocol.BrowserJobSnapshot.safeParse({ ...snapshot, result: undefined }).success).toBe(false)
      return
    }
    const frame = {
      type: "browser_event",
      requestId,
      event: "progress",
      job: snapshot,
    } satisfies RemoteProtocol.BrowserEvent
    expect(RemoteProtocol.BrowserEvent.parse(frame)).toEqual(frame)
    expect(RemoteProtocol.BrowserJobSnapshot.safeParse({ ...snapshot, result: completed }).success).toBe(false)
  })

  test("rejects false success, unknown states, empty evidence, and mismatched results", () => {
    expect(RemoteProtocol.BrowserJobSnapshot.safeParse({ ...job, status: "idle" }).success).toBe(false)
    for (const fields of [
      { effectsUncertain: true },
      { reason: "runner_failed" },
      { status: "failed" },
      { summary: "" },
      { evidence: [{}] },
      { evidence: [{ text: "Observed", screenshot: "data:image/png;base64,AAAA" }] },
    ]) {
      expect(RemoteProtocol.BrowserResult.safeParse({ ...completed, ...fields }).success).toBe(false)
    }
    for (const field of ["providerId", "browserTaskId", "jobId", "invocationId"] as const) {
      const result = { ...completed, [field]: handle[field].replace(/.$/, "5") }
      expect(RemoteProtocol.BrowserJobSnapshot.safeParse({ ...finished, result }).success).toBe(false)
      expect(
        RemoteProtocol.BrowserProviderOutbound.safeParse({ type: "provider_result", ...bound, tab, result }).success,
      ).toBe(false)
    }
    expect(RemoteProtocol.BrowserJobSnapshot.safeParse({ ...finished, status: "failed" }).success).toBe(false)
  })

  test.each([
    "approval_denied",
    "permission_denied",
    "invocation_expired",
    "invocation_conflict",
    "conversation_busy",
    "capacity_exceeded",
    "tab_lost",
    "provider_lost",
    "provider_unavailable",
    "queue_timeout",
    "approval_timeout",
    "execution_timeout",
    "lease_expired",
    "effects_uncertain",
    "cancelled",
    "runner_failed",
    "unsupported",
    "invalid_request",
    "owner_mismatch",
    "not_found",
  ])("retains finite error reason %s", (code) => {
    const frame = {
      type: "browser_response",
      requestId,
      response: { kind: "error", code, message: "Browser request rejected", retryable: false },
    } satisfies RemoteProtocol.BrowserResponse
    expect(RemoteProtocol.BrowserResponse.parse(frame)).toEqual(frame)
    expect(
      RemoteProtocol.BrowserResponse.safeParse({ ...frame, response: { ...frame.response, code: `${code}_unknown` } })
        .success,
    ).toBe(false)
  })

  test("binds approval and cancellation to an invocation and generation, not parent authority", () => {
    const approval = { type: "provider_approval", ...bound, approval: { decision: "approved", tab } }
    const cancel = { type: "provider_cancel", ...bound }
    for (const frame of [approval, cancel]) {
      for (const field of Object.keys(bound)) {
        expect(RemoteProtocol.BrowserProviderOutbound.safeParse({ ...frame, [field]: undefined }).success).toBe(false)
      }
      expect(RemoteProtocol.BrowserProviderOutbound.safeParse({ ...frame, generation: 0 }).success).toBe(false)
      expect(RemoteProtocol.BrowserProviderOutbound.safeParse({ ...frame, owner }).success).toBe(false)
    }
    for (const fields of [
      { tabId: -1 },
      { tabId: 1.5 },
      { title: undefined },
      { url: "not-a-url" },
      { effectiveMode: "automatic" },
      { extra: true },
    ]) {
      expect(
        RemoteProtocol.BrowserProviderOutbound.safeParse({
          ...approval,
          approval: { decision: "approved", tab: { ...tab, ...fields } },
        }).success,
      ).toBe(false)
    }
    expect(RemoteProtocol.BrowserJobSnapshot.safeParse({ ...job, status: "running" }).success).toBe(false)
    for (const status of ["queued", "awaiting_approval"]) {
      expect(RemoteProtocol.BrowserJobSnapshot.safeParse({ ...job, status, approvedTab: tab }).success).toBe(false)
    }
    expect(
      RemoteProtocol.BrowserProviderInbound.safeParse({
        type: "provider_job",
        job: { ...job, status: "running", approvedTab: tab },
        goal: invoke.goal,
        ownerLabel: "Parent chat",
      }).success,
    ).toBe(false)
    for (const fields of [{ generation: 2 }, { providerId: handle.providerId.replace(/.$/, "5") }]) {
      expect(
        RemoteProtocol.BrowserProviderInbound.safeParse({
          type: "provider_snapshot",
          ...binding,
          jobs: [{ ...job, ...fields }],
        }).success,
      ).toBe(false)
    }
  })

  test("requires closed tabs and drained locks on provider recovery registration", () => {
    const recovery = { invocationId: handle.invocationId, tabId: tab.tabId, tabClosed: true, locksDrained: true }
    for (const fields of [
      { tabClosed: false },
      { locksDrained: false },
      { tabId: undefined },
      { invocationId: undefined },
      { owner },
    ]) {
      expect(
        RemoteProtocol.BrowserProviderOutbound.safeParse({
          ...registration,
          generation: 1,
          recovery: { ...recovery, ...fields },
        }).success,
      ).toBe(false)
    }
    for (const generation of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(RemoteProtocol.BrowserProviderOutbound.safeParse({ ...registration, generation }).success).toBe(false)
    }
  })

  test.each([
    { createdAt: "2026-08-28" },
    { createdAt: "2026-08-28T00:00:00Z" },
    { createdAt: "2026-02-30T00:00:00.000Z" },
    { createdAt: "2026-08-28T00:00:00.000+01:00" },
    { expiresAt: "2026-08-27T00:00:00.000Z" },
    { payloadFingerprint: "not-a-digest" },
    { deadlines: { queue: "2026-08-27T00:00:00.000Z" } },
    { deadlines: { queue: "2026-09-04T00:00:00.001Z" } },
    { deadlines: { ...job.deadlines, execution: "2026-09-04T00:00:00.001Z" } },
    { deadlines: { ...job.deadlines, lease: "invalid" } },
    { deadlines: { ...job.deadlines, extra: true } },
  ])("rejects malformed metadata and out-of-retention deadlines: %j", (fields) => {
    expect(RemoteProtocol.BrowserJobSnapshot.safeParse({ ...job, ...fields }).success).toBe(false)
  })

  test("applies UTF-8 byte limits instead of JavaScript string lengths", () => {
    const goal = "\u00e9".repeat(8192)
    const args = {
      operation: "run",
      provider_id: handle.providerId,
      goal,
    } satisfies RemoteProtocol.BrowserTaskArguments
    expect(RemoteProtocol.BrowserRequest.parse({ ...invoke, goal })).toMatchObject({ goal })
    expect(RemoteProtocol.BrowserTaskArguments.parse(args)).toEqual(args)
    expect(RemoteProtocol.BrowserRequest.safeParse({ ...invoke, goal: `${goal}a` }).success).toBe(false)
    expect(RemoteProtocol.BrowserTaskArguments.safeParse({ ...args, goal: `${goal}a` }).success).toBe(false)
    expect(RemoteProtocol.BrowserRequest.safeParse({ ...invoke, goal: "" }).success).toBe(false)
    expect(
      RemoteProtocol.BrowserProviderOutbound.safeParse({ ...registration, label: "\u00e9".repeat(65) }).success,
    ).toBe(false)
    for (const fields of [
      { summary: "\u00e9".repeat(16385) },
      { evidence: [{ text: "\u00e9".repeat(4097) }] },
      { evidence: [{ title: "\u00e9".repeat(513) }] },
      { evidence: [{ url: `https://example.com/${"\u00e9".repeat(4096)}` }] },
    ]) {
      expect(RemoteProtocol.BrowserResult.safeParse({ ...completed, ...fields }).success).toBe(false)
    }
    expect(
      RemoteProtocol.BrowserResponse.safeParse({
        type: "browser_response",
        requestId,
        response: { kind: "error", code: "invalid_request", message: "\u00e9".repeat(513), retryable: false },
      }).success,
    ).toBe(false)
  })

  test("bounds serialized results at 64 KiB and complete frames below 128 KiB", () => {
    const padding = { text: "" }
    const evidence = [...Array.from({ length: 3 }, () => ({ text: "x".repeat(8192) })), padding]
    const result = { ...completed, summary: "x".repeat(32768), evidence }
    padding.text = "x".repeat(65536 - Buffer.byteLength(JSON.stringify(result), "utf8"))
    expect(RemoteProtocol.BrowserResult.parse(result)).toEqual(result)
    expect(
      RemoteProtocol.BrowserResult.safeParse({ ...result, summary: `${result.summary.slice(1)}\u00e9` }).success,
    ).toBe(false)
    const snapshot = { ...finished, result }
    const frame = {
      type: "provider_snapshot",
      ...binding,
      jobs: [snapshot],
    } satisfies RemoteProtocol.BrowserProviderInbound
    expect(RemoteProtocol.BrowserProviderInbound.parse(frame)).toEqual(frame)
    expect(RemoteProtocol.BrowserProviderInbound.safeParse({ ...frame, jobs: [snapshot, snapshot] }).success).toBe(
      false,
    )
    expect(
      RemoteProtocol.BrowserResult.safeParse({
        ...completed,
        evidence: Array.from({ length: 33 }, () => ({ text: "Observed" })),
      }).success,
    ).toBe(false)
  })

  test("bounds discovery pages, snapshot pages, and queue depth", () => {
    const frame = {
      type: "browser_response",
      requestId,
      response: { kind: "providers", providers: Array.from({ length: 25 }, () => provider) },
    } satisfies RemoteProtocol.BrowserResponse
    expect(RemoteProtocol.BrowserResponse.parse(frame)).toEqual(frame)
    expect(
      RemoteProtocol.BrowserResponse.safeParse({
        ...frame,
        response: { ...frame.response, providers: [...frame.response.providers, provider] },
      }).success,
    ).toBe(false)
    expect(
      RemoteProtocol.BrowserResponse.safeParse({
        ...frame,
        response: { ...frame.response, providers: [{ ...provider, queueDepth: 101 }] },
      }).success,
    ).toBe(false)
    expect(
      RemoteProtocol.BrowserProviderInbound.safeParse({
        type: "provider_snapshot",
        ...binding,
        jobs: Array.from({ length: 26 }, () => job),
      }).success,
    ).toBe(false)
  })

  test.each([
    { capabilities: undefined, supported: false },
    { capabilities: {}, supported: false },
    { capabilities: { browserJobsV1: false }, supported: false },
    { capabilities: { browserJobsV1: true }, supported: true },
  ])("normalizes negotiation without changing legacy envelopes: %j", ({ capabilities, supported }) => {
    const cases = [
      { schema: RemoteProtocol.Outbound, frame: { type: "heartbeat" as const, sessions: [] } },
      { schema: RemoteProtocol.Inbound, frame: { type: "heartbeat_ack" as const } },
      { schema: RemoteProtocol.WebOutbound, frame: { type: "ping" as const, nonce: "legacy-nonce" } },
      { schema: RemoteProtocol.WebInbound, frame: { type: "pong" as const, nonce: "legacy-nonce" } },
    ]
    for (const { schema, frame } of cases) {
      const input = { ...frame, ...(capabilities === undefined ? {} : { capabilities }) }
      const parsed = schema.parse(input)
      expect(parsed).toEqual(input)
      const advertised = "capabilities" in parsed ? parsed.capabilities : undefined
      expect(RemoteProtocol.NormalizedBrowserCapabilities.parse(advertised)).toEqual({ browserJobsV1: supported })
      expect(schema.safeParse({ ...frame, capabilities: { browserJobsV1: "yes" } }).success).toBe(false)
    }
  })

  // Frozen pre-browser callbacks must remain assignable to the legacy parser output.
  type LegacyInbound =
    | { type: "subscribe" | "unsubscribe"; sessionId: string }
    | { type: "command"; id: string; command: string; sessionId?: string; data: unknown }
    | { type: "system"; event: string; data: unknown }
    | { type: "heartbeat_ack" }
  type LegacyWebInbound =
    | { type: "event"; sessionId: string; event: string; data: unknown }
    | { type: "system"; event: string; data: unknown }
    | { type: "response"; id: string; result?: unknown; error?: unknown }
    | { type: "pong"; nonce: string }
  const cli: (message: RemoteProtocol.Inbound) => string = (message: LegacyInbound) => {
    switch (message.type) {
      case "subscribe":
      case "unsubscribe":
        return `${message.type}:${message.sessionId}`
      case "command":
        return `${message.command}:${message.id}`
      case "system":
        return message.event
      case "heartbeat_ack":
        return "alive"
    }
    throw new Error("Unexpected legacy CLI message")
  }
  const web: (message: RemoteProtocol.WebInbound) => unknown = (message: LegacyWebInbound) => {
    switch (message.type) {
      case "event":
        return `${message.sessionId}:${message.event}`
      case "system":
        return message.event
      case "response":
        return message.error ?? message.result
      case "pong":
        return message.nonce
    }
    throw new Error("Unexpected legacy web message")
  }

  test("preserves legacy callback types and delivered values", () => {
    const cliExamples = [
      { frame: { type: "subscribe", sessionId: "legacy-session" }, value: "subscribe:legacy-session" },
      { frame: { type: "unsubscribe", sessionId: "legacy-session" }, value: "unsubscribe:legacy-session" },
      {
        frame: { type: "command", id: "legacy-request", command: "list_sessions", data: null },
        value: "list_sessions:legacy-request",
      },
      { frame: { type: "system", event: "web.connected", data: {} }, value: "web.connected" },
      { frame: { type: "heartbeat_ack" }, value: "alive" },
    ] satisfies { frame: RemoteProtocol.Inbound; value: string }[]
    const webExamples = [
      {
        frame: { type: "event", sessionId: "legacy-session", event: "message.updated", data: {} },
        value: "legacy-session:message.updated",
      },
      { frame: { type: "system", event: "cli.connected", data: {} }, value: "cli.connected" },
      { frame: { type: "response", id: "legacy-request", result: { ok: true } }, value: { ok: true } },
      { frame: { type: "response", id: "legacy-request", error: "not found" }, value: "not found" },
      { frame: { type: "pong", nonce: "legacy-nonce" }, value: "legacy-nonce" },
    ] satisfies { frame: RemoteProtocol.WebInbound; value: unknown }[]
    for (const { frame, value } of cliExamples) {
      expect(cli(RemoteProtocol.Inbound.parse(frame))).toEqual(value)
      expect(RemoteProtocol.InboundWithBrowser.parse(frame)).toEqual(frame)
    }
    for (const { frame, value } of webExamples) {
      expect(web(RemoteProtocol.WebInbound.parse(frame))).toEqual(value)
      expect(RemoteProtocol.WebInboundWithBrowser.parse(frame)).toEqual(frame)
    }
    for (const frame of [
      { type: "heartbeat", sessions: [] },
      { type: "event", sessionId: "legacy-session", event: "message.updated", data: {} },
      { type: "response", id: "legacy-request", error: { arbitrary: ["legacy"] } },
    ] satisfies RemoteProtocol.Outbound[]) {
      expect(RemoteProtocol.OutboundWithBrowser.parse(frame)).toEqual(frame)
    }
    for (const frame of [
      { type: "subscribe", sessionId: "legacy-session" },
      { type: "unsubscribe", sessionId: "legacy-session" },
      { type: "command", id: "legacy-request", command: "list_sessions" },
      { type: "ping", nonce: "legacy-nonce" },
    ] satisfies RemoteProtocol.WebOutbound[]) {
      expect(RemoteProtocol.WebOutboundWithBrowser.parse(frame)).toEqual(frame)
    }
    expect(RemoteProtocol.Inbound.parse({ type: "subscribe", sessionId: "legacy-session", extra: true })).toEqual({
      type: "subscribe",
      sessionId: "legacy-session",
    })
    expect(RemoteProtocol.WebOutbound.parse({ type: "subscribe", sessionId: "legacy-session", extra: true })).toEqual({
      type: "subscribe",
      sessionId: "legacy-session",
    })
  })
})
