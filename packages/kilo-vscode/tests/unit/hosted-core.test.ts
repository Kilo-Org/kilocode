import { describe, expect, test } from "bun:test"
import { attachmentFailure, isRecoverable } from "../../src/hosted/failure"
import { classifyFrame, retag } from "../../src/hosted/events"
import { HostedRegistry } from "../../src/hosted/registry"

describe("attachment failures", () => {
  test("recoverable attachment codes allow one re-attach", () => {
    for (const code of ["unknown", "expired", "disposed", "unavailable"]) {
      const failure = attachmentFailure({ error: "KILO_SESSION_ATTACHMENT", code, message: code })
      expect(failure?.code).toBe(code as never)
      expect(isRecoverable({ code })).toBe(true)
    }
  })

  test("unrecoverable codes surface instead of re-attaching", () => {
    for (const code of ["invalid_request", "too_large", "payment_required", "signed_out"]) {
      expect(isRecoverable({ code })).toBe(false)
    }
  })

  test("parses a JSON string body and ignores unrelated errors", () => {
    expect(attachmentFailure('{"code":"expired","message":"gone"}')?.code).toBe("expired")
    expect(attachmentFailure({ code: "KILO_LIVE_RUNTIME_UNAVAILABLE" })).toBeUndefined()
    expect(attachmentFailure(new Error("boom"))).toBeUndefined()
    expect(attachmentFailure("not json")).toBeUndefined()
  })

  test("reads the body the SDK preserves under Error.cause", () => {
    const wrapped = new Error("Session attachment has expired", {
      cause: { body: { error: "KILO_SESSION_ATTACHMENT", code: "expired", message: "Session attachment has expired" } },
    })
    expect(attachmentFailure(wrapped)?.code).toBe("expired")
    expect(isRecoverable(wrapped)).toBe(true)
  })
})

describe("hosted stream frames", () => {
  test("classifies resnapshot and fence frames ahead of ordinary events", () => {
    expect(
      classifyFrame({ payload: { type: "kilo.native.resnapshot", properties: { reason: "overflow" } } }).kind,
    ).toBe("resnapshot")
    expect(classifyFrame({ payload: { type: "kilo.native.fence", properties: { generation: 1 } } }).kind).toBe("fence")
    expect(classifyFrame({ type: "message.updated", properties: {} }).kind).toBe("event")
    expect(classifyFrame({ payload: {} }).kind).toBe("ignore")
    expect(classifyFrame(undefined).kind).toBe("ignore")
  })

  test("retags only the matching native session identity", () => {
    const key = "host:kilo-cloud:ses_1"
    const event = {
      type: "message.part.updated",
      properties: { sessionID: "ses_1", part: { id: "prt_1", sessionID: "ses_1" } },
    }
    const next = retag(event, "ses_1", key) as typeof event
    expect(next.properties.sessionID).toBe(key)
    expect(next.properties.part.sessionID).toBe(key)

    const other = { type: "message.part.updated", properties: { sessionID: "ses_2" } }
    expect(retag(other, "ses_1", key)).toBe(other)
  })
})

describe("attachment registry", () => {
  const port = (calls: string[]) => ({
    attach: async () => {
      calls.push("attach")
      return { attachmentID: `wrk_att_${calls.length}`, expiresAt: Date.now() + 60_000 }
    },
    detach: async () => {
      calls.push("detach")
    },
  })

  test("coalesces concurrent attaches for one identity", async () => {
    const registry = new HostedRegistry()
    const calls: string[] = []
    const [a, b] = await Promise.all([
      registry.ensure("host:a:ses_1", { providerID: "a", sessionID: "ses_1" }, port(calls)),
      registry.ensure("host:a:ses_1", { providerID: "a", sessionID: "ses_1" }, port(calls)),
    ])
    expect(a.attachmentID).toBe(b.attachmentID)
    expect(calls.filter((call) => call === "attach")).toHaveLength(1)
  })

  test("invalidation forces the next request to mint a new attachment", async () => {
    const registry = new HostedRegistry()
    const calls: string[] = []
    const first = await registry.ensure("host:a:ses_1", { providerID: "a", sessionID: "ses_1" }, port(calls))
    registry.invalidate("host:a:ses_1")
    const second = await registry.ensure("host:a:ses_1", { providerID: "a", sessionID: "ses_1" }, port(calls))
    expect(second.attachmentID).not.toBe(first.attachmentID)
  })

  test("detach drops the entry and never throws for an unknown key", async () => {
    const registry = new HostedRegistry()
    const calls: string[] = []
    registry.ensure("host:a:ses_1", { providerID: "a", sessionID: "ses_1" }, port(calls)).catch(() => undefined)
    await registry.detach("host:a:ses_1", port(calls))
    expect(registry.get("host:a:ses_1")).toBeUndefined()
    await registry.detach("host:missing:ses_1", port(calls))
  })
})
