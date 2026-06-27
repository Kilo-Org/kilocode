import { expect, test } from "bun:test"
import type { Agent as ACPAgent } from "@agentclientprotocol/sdk"
import { ACP } from "@/acp/agent"

const methods = [
  "initialize",
  "authenticate",
  "newSession",
  "loadSession",
  "listSessions",
  "resumeSession",
  "closeSession",
  "unstable_forkSession",
  "setSessionConfigOption",
  "setSessionMode",
  "unstable_setSessionModel",
  "prompt",
  "cancel",
] as const satisfies readonly (keyof ACPAgent)[]

test("ACP Agent exposes every supported SDK-routed method", () => {
  for (const method of methods) {
    expect(typeof ACP.Agent.prototype[method], `Missing ACP Agent method: ${method}`).toBe("function")
  }
})
