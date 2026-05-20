import { describe, expect, test } from "bun:test"
import { KiloLLM } from "../../../src/kilocode/session/llm"

describe("KiloLLM.repairToolName", () => {
  const tools = {
    read: {},
    bash: {},
    customTool: {},
  }

  test("repairs leading whitespace before known tool names", () => {
    expect(KiloLLM.repairToolName({ name: " read", tools })).toBe("read")
  })

  test("repairs case and surrounding whitespace together", () => {
    expect(KiloLLM.repairToolName({ name: " Bash ", tools })).toBe("bash")
  })

  test("keeps unknown tool names unknown", () => {
    expect(KiloLLM.repairToolName({ name: " missing ", tools })).toBeUndefined()
  })

  test("does not change exact custom tool names", () => {
    expect(KiloLLM.repairToolName({ name: "customTool", tools })).toBeUndefined()
  })
})
