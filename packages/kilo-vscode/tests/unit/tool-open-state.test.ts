import { describe, expect, it, beforeEach } from "bun:test"
import {
  readToolOpen,
  resetToolOpenState,
  toolOpenKey,
  writeToolOpen,
} from "../../../kilo-ui/src/components/tool-open-state"

describe("tool open state", () => {
  beforeEach(() => {
    resetToolOpenState()
  })

  it("keys state by tool and stable call id", () => {
    const key = toolOpenKey({ tool: "bash", callID: "call_1", partID: "part_1" })
    expect(key).toBe("bash:call_1")
  })

  it("falls back until the user toggles a tool", () => {
    const key = toolOpenKey({ tool: "bash", callID: "call_1" })
    expect(readToolOpen(key, false)).toBe(false)
    writeToolOpen(key, true)
    expect(readToolOpen(key, false)).toBe(true)
  })

  it("separates different tool instances", () => {
    const bash = toolOpenKey({ tool: "bash", callID: "call_1" })
    const grep = toolOpenKey({ tool: "grep", callID: "call_1" })
    writeToolOpen(bash, true)
    writeToolOpen(grep, false)
    expect(readToolOpen(bash, false)).toBe(true)
    expect(readToolOpen(grep, true)).toBe(false)
  })
})
