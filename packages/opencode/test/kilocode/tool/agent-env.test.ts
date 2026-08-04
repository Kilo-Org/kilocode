import { describe, expect, test } from "bun:test"
import { agentEnv } from "../../../src/kilocode/tool/agent-env"

describe("agentEnv", () => {
  test("sets the Kilo Code marker by default", () => {
    expect(agentEnv({}).AI_AGENT).toBe("kilo-code")
  })

  test("preserves an explicit marker", () => {
    expect(agentEnv({ AI_AGENT: "wrapper" }).AI_AGENT).toBe("wrapper")
  })

  test("replaces a whitespace-only marker", () => {
    expect(agentEnv({ AI_AGENT: "  " }).AI_AGENT).toBe("kilo-code")
  })
})
