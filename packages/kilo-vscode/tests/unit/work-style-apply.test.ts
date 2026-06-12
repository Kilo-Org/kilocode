import { describe, expect, it } from "bun:test"
import { applyWorkStyle, type WorkStyleStore } from "../../src/kilo-provider/work-style-apply"
import type { WorkStyleConfig } from "../../src/shared/work-style-presets"

function setup(input?: {
  config?: WorkStyleConfig
  customized?: boolean
  failPatch?: boolean
  failWrite?: (key: string, value: unknown) => boolean
}) {
  const settings = new Map<string, unknown>([["agentWorkStyle", "unset"]])
  const events: string[] = []
  const store: WorkStyleStore = {
    read: async () => input?.config ?? {},
    inspect: (key) => ({
      customized: key === "showTaskTimeline" && (input?.customized ?? false),
      global: settings.get(key),
    }),
    write: async (key, value) => {
      events.push(`write:${key}:${String(value)}`)
      settings.set(key, value)
      if (input?.failWrite?.(key, value)) throw new Error(`Failed to write ${key}`)
    },
    patch: async (config) => {
      events.push(`patch:${Object.keys(config).sort().join(",")}`)
      if (input?.failPatch) throw new Error("Failed to patch config")
    },
  }
  return { store, settings, events }
}

describe("applyWorkStyle", () => {
  it("applies extension settings before the CLI config in one operation", async () => {
    const state = setup()

    const result = await applyWorkStyle("human-in-the-loop", state.store)

    expect(result).toEqual({ ok: true })
    expect(state.settings.get("showTaskTimeline")).toBe(true)
    expect(state.settings.get("agentWorkStyle")).toBe("human-in-the-loop")
    expect(state.events).toEqual([
      "write:showTaskTimeline:true",
      "write:agentWorkStyle:human-in-the-loop",
      "patch:auto_collapse_reasoning,permission,terminal_command_display",
    ])
  })

  it("rolls extension settings back when the CLI config update fails", async () => {
    const state = setup({ failPatch: true })

    const result = await applyWorkStyle("autonomous", state.store)

    expect(result).toEqual({ ok: false, error: "Failed to patch config", rollback: [] })
    expect(state.settings.get("showTaskTimeline")).toBeUndefined()
    expect(state.settings.get("agentWorkStyle")).toBe("unset")
    expect(state.events).toEqual([
      "write:showTaskTimeline:false",
      "write:agentWorkStyle:autonomous",
      "patch:auto_collapse_reasoning,terminal_command_display",
      "write:agentWorkStyle:unset",
      "write:showTaskTimeline:undefined",
    ])
  })

  it("rolls back earlier writes when persisting the style fails", async () => {
    const state = setup({ failWrite: (key, value) => key === "agentWorkStyle" && value === "human-in-the-loop" })

    const result = await applyWorkStyle("human-in-the-loop", state.store)

    expect(result).toEqual({ ok: false, error: "Failed to write agentWorkStyle", rollback: [] })
    expect(state.settings.get("showTaskTimeline")).toBeUndefined()
    expect(state.settings.get("agentWorkStyle")).toBe("unset")
    expect(state.events).not.toContain("patch:auto_collapse_reasoning,permission,terminal_command_display")
  })

  it("continues rollback and reports settings that could not be restored", async () => {
    const state = setup({
      failPatch: true,
      failWrite: (key, value) => key === "agentWorkStyle" && value === "unset",
    })

    const result = await applyWorkStyle("human-in-the-loop", state.store)

    expect(result).toEqual({ ok: false, error: "Failed to patch config", rollback: ["agentWorkStyle"] })
    expect(state.settings.get("showTaskTimeline")).toBeUndefined()
  })

  it("preserves customized extension settings", async () => {
    const state = setup({ customized: true })

    const result = await applyWorkStyle("autonomous", state.store)

    expect(result).toEqual({ ok: true })
    expect(state.events[0]).toBe("write:agentWorkStyle:autonomous")
    expect(state.events.some((event) => event.startsWith("write:showTaskTimeline"))).toBe(false)
  })
})
