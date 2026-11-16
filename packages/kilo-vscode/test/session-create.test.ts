import { describe, expect, it } from "bun:test"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { sessionCreateBody } from "../src/agent-manager/session-create"

describe("sessionCreateBody", () => {
  // The Gateway reads this key from the root session to send `X-KILOCODE-FEATURE: agent-manager`.
  it("marks the session with the platform key the Gateway reads", () => {
    const body = sessionCreateBody({ directory: "/repo", metadata: { kind: "worktree" } })

    expect(body.metadata).toMatchObject({ kind: "worktree" })
    expect(body.metadata[KiloGatewayRpc.PLATFORM_METADATA_KEY]).toBe("agent-manager")
  })
})
