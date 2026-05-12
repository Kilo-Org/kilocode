// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { KiloRunAuto } from "../../src/kilocode/cli/run-auto"

describe("KiloRunAuto", () => {
  test("tracks task child sessions without allowing unrelated sessions", () => {
    const state = KiloRunAuto.create("ses_root")

    expect(KiloRunAuto.allowed(state, "ses_root")).toBe(true)
    expect(KiloRunAuto.allowed(state, "ses_child")).toBe(false)

    KiloRunAuto.track(state, {
      type: "tool",
      tool: "task",
      sessionID: "ses_root",
      state: {
        metadata: {
          sessionId: "ses_child",
        },
      },
    })

    expect(KiloRunAuto.allowed(state, "ses_child")).toBe(true)
    expect(KiloRunAuto.allowed(state, "ses_other")).toBe(false)
  })

  test("ignores malformed or non-root task metadata", () => {
    const state = KiloRunAuto.create("ses_root")

    KiloRunAuto.track(state, {
      type: "tool",
      tool: "task",
      sessionID: "ses_root",
      state: {
        metadata: {
          sessionId: "",
        },
      },
    })
    KiloRunAuto.track(state, {
      type: "tool",
      tool: "task",
      sessionID: "ses_other",
      state: {
        metadata: {
          sessionId: "ses_wrong",
        },
      },
    })
    KiloRunAuto.track(state, {
      type: "text",
      sessionID: "ses_root",
      state: {},
    })

    expect(KiloRunAuto.allowed(state, "ses_wrong")).toBe(false)
    expect(KiloRunAuto.allowed(state, "")).toBe(false)
  })
})
