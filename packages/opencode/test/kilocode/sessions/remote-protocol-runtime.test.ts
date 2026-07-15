import { describe, expect, test } from "bun:test"
import { RemoteProtocol } from "@/kilo-sessions/remote-protocol"

const validRuntime: RemoteProtocol.RuntimePresence = {
  runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
  connectionId: "conn-1",
  protocolVersion: 1,
  cliVersion: "7.4.7",
  displayName: "Alice Mac",
  projectName: "customer-repo",
  capabilities: ["catalog.v1", "create-and-run.v1"],
}

describe("RemoteProtocol.Heartbeat (runtime presence)", () => {
  test("legacy heartbeat without runtime remains valid", () => {
    const msg = {
      type: "heartbeat" as const,
      sessions: [],
    }
    const parsed = RemoteProtocol.Heartbeat.parse(msg)
    expect(parsed.runtime).toBeUndefined()
  })

  test("runtime-bearing heartbeat with empty sessions is valid", () => {
    const parsed = RemoteProtocol.Heartbeat.parse({
      type: "heartbeat",
      sessions: [],
      runtime: validRuntime,
    })
    expect(parsed.runtime).toEqual(validRuntime)
  })

  test("runtime-bearing heartbeat with sessions is valid", () => {
    const parsed = RemoteProtocol.Heartbeat.parse({
      type: "heartbeat",
      sessions: [{ id: "ses_1", status: "busy", title: "Test" }],
      runtime: validRuntime,
    })
    expect(parsed.runtime).toEqual(validRuntime)
  })

  test("rejects a runtime with an unknown capability", () => {
    const bad = { ...validRuntime, capabilities: ["not-a-cap"] }
    const result = RemoteProtocol.Heartbeat.safeParse({
      type: "heartbeat",
      sessions: [],
      runtime: bad,
    })
    expect(result.success).toBe(false)
  })

  test("rejects a runtime with duplicate capabilities", () => {
    const bad = { ...validRuntime, capabilities: ["catalog.v1", "catalog.v1"] }
    const result = RemoteProtocol.Heartbeat.safeParse({
      type: "heartbeat",
      sessions: [],
      runtime: bad,
    })
    expect(result.success).toBe(false)
  })

  test("rejects a runtime with a non-UUID runtimeId", () => {
    const bad = { ...validRuntime, runtimeId: "not-a-uuid" }
    const result = RemoteProtocol.Heartbeat.safeParse({
      type: "heartbeat",
      sessions: [],
      runtime: bad,
    })
    expect(result.success).toBe(false)
  })
})

describe("RemoteProtocol.Heartbeat (sequencing)", () => {
  test("heartbeat accepts an optional sequence number", () => {
    const parsed = RemoteProtocol.Heartbeat.parse({
      type: "heartbeat",
      sessions: [],
      sequence: 7,
    })
    expect(parsed.sequence).toBe(7)
  })

  test("heartbeat without sequence remains valid", () => {
    const parsed = RemoteProtocol.Heartbeat.parse({
      type: "heartbeat",
      sessions: [],
    })
    expect(parsed.sequence).toBeUndefined()
  })

  test("heartbeat rejects a negative sequence", () => {
    const result = RemoteProtocol.Heartbeat.safeParse({
      type: "heartbeat",
      sessions: [],
      sequence: -1,
    })
    expect(result.success).toBe(false)
  })
})

describe("RemoteProtocol.HeartbeatAck", () => {
  test("legacy ack without sequence remains valid", () => {
    const parsed = RemoteProtocol.HeartbeatAck.parse({ type: "heartbeat_ack" })
    expect(parsed.sequence).toBeUndefined()
  })

  test("ack echoes an optional sequence", () => {
    const parsed = RemoteProtocol.HeartbeatAck.parse({ type: "heartbeat_ack", sequence: 42 })
    expect(parsed.sequence).toBe(42)
  })
})
