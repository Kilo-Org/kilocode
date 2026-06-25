import { describe, expect, it } from "bun:test"
import {
  applyWorkStyle,
  type WorkStyleConfigPatch,
  type WorkStyleStore,
} from "../../src/kilo-provider/work-style-apply"
import type { WorkStyleConfig } from "../../src/shared/work-style-presets"

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function merge(current: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const next = record(current) ? structuredClone(current) : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key]
      continue
    }
    next[key] = record(value) ? merge(next[key], value) : value
  }
  return next
}

function setup(input?: {
  config?: WorkStyleConfig
  global?: WorkStyleConfigPatch
  customized?: boolean
  failPatch?: (config: WorkStyleConfigPatch, call: number) => boolean
  failWrite?: (key: string, value: unknown) => boolean
}) {
  const settings = new Map<string, unknown>([["agentWorkStyle", "unset"]])
  const global = new Map<string, unknown>(Object.entries(input?.global ?? {}))
  const events: string[] = []
  const patches: WorkStyleConfigPatch[] = []
  let calls = 0
  const store: WorkStyleStore = {
    read: async () => input?.config ?? {},
    global: async () => Object.fromEntries(global) as WorkStyleConfigPatch,
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
      calls++
      const patch = structuredClone(config)
      patches.push(patch)
      events.push(`patch:${Object.keys(config).sort().join(",")}`)
      if (input?.failPatch?.(config, calls)) throw new Error("Failed to patch config")
      const next = merge(Object.fromEntries(global), config)
      global.clear()
      for (const [key, value] of Object.entries(next)) global.set(key, value)
    },
  }
  return { store, settings, global, events, patches }
}

describe("applyWorkStyle", () => {
  it("patches CLI config before committing the work style", async () => {
    const state = setup()

    const result = await applyWorkStyle("human-in-the-loop", "code", state.store)

    expect(result).toEqual({ ok: true, style: "human-in-the-loop", agent: "code" })
    expect(state.settings.get("showTaskTimeline")).toBe(true)
    expect(state.settings.get("agentWorkStyle")).toBe("human-in-the-loop")
    expect(state.patches[0]).toEqual({
      permission: expect.any(Object),
      terminal_command_display: "expanded",
      auto_collapse_reasoning: false,
      default_agent: "code",
    })
    expect(state.events).toEqual([
      "write:showTaskTimeline:true",
      "patch:auto_collapse_reasoning,default_agent,permission,terminal_command_display",
      "write:agentWorkStyle:human-in-the-loop",
    ])
  })

  it("accepts Data as the default agent", async () => {
    const state = setup()

    const result = await applyWorkStyle("autonomous", "data", state.store)

    expect(result).toEqual({ ok: true, style: "autonomous", agent: "data" })
    expect(state.patches[0]?.default_agent).toBe("data")
    expect(state.global.get("default_agent")).toBe("data")
  })

  it("serializes concurrent submissions and keeps the first completed choice", async () => {
    const state = setup()
    const patch = state.store.patch
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    state.store.patch = async (config) => {
      entered.resolve()
      await gate.promise
      await patch(config)
    }

    const first = applyWorkStyle("human-in-the-loop", "code", state.store)
    await entered.promise
    const count = state.events.length
    const second = applyWorkStyle("autonomous", "data", state.store)
    await Promise.resolve()

    expect(state.events).toHaveLength(count)
    gate.resolve()
    expect(await Promise.all([first, second])).toEqual([
      { ok: true, style: "human-in-the-loop", agent: "code" },
      { ok: true, style: "human-in-the-loop", agent: "code" },
    ])
    expect(state.patches).toHaveLength(1)
  })

  it("rejects Ask and unknown default agents without side effects", async () => {
    for (const agent of ["ask", "plan"]) {
      const state = setup()

      const result = await applyWorkStyle("autonomous", agent, state.store)

      expect(result).toEqual({ ok: false, error: "Invalid default agent", rollback: [] })
      expect(state.events).toEqual([])
    }
  })

  it("restores extension settings when the CLI config update fails", async () => {
    const state = setup({
      global: { default_agent: "ask" },
      failPatch: (_, call) => call === 1,
    })

    const result = await applyWorkStyle("autonomous", "code", state.store)

    expect(result).toEqual({ ok: false, error: "Failed to patch config", rollback: [] })
    expect(state.settings.get("showTaskTimeline")).toBeUndefined()
    expect(state.settings.get("agentWorkStyle")).toBe("unset")
    expect(state.global.get("default_agent")).toBe("ask")
    expect(state.patches[1]).toEqual({
      terminal_command_display: null,
      auto_collapse_reasoning: null,
      default_agent: "ask",
    })
  })

  it("restores prior global config when committing the style fails", async () => {
    const state = setup({
      global: {
        terminal_command_display: "expanded",
        default_agent: "code",
      },
      failWrite: (key, value) => key === "agentWorkStyle" && value === "human-in-the-loop",
    })

    const result = await applyWorkStyle("human-in-the-loop", "data", state.store)

    expect(result).toEqual({ ok: false, error: "Failed to write agentWorkStyle", rollback: [] })
    expect(state.settings.get("showTaskTimeline")).toBeUndefined()
    expect(state.settings.get("agentWorkStyle")).toBe("unset")
    expect(state.patches[1]?.permission).toBeNull()
    expect(Object.fromEntries(state.global)).toEqual({
      terminal_command_display: "expanded",
      default_agent: "code",
    })
  })

  it("reports config and setting rollback failures", async () => {
    const state = setup({
      failPatch: (_, call) => call === 2,
      failWrite: (key, value) =>
        (key === "agentWorkStyle" && value === "human-in-the-loop") || (key === "agentWorkStyle" && value === "unset"),
    })

    const result = await applyWorkStyle("human-in-the-loop", "code", state.store)

    expect(result).toEqual({
      ok: false,
      error: "Failed to write agentWorkStyle",
      rollback: ["config", "agentWorkStyle"],
    })
    expect(state.settings.get("showTaskTimeline")).toBeUndefined()
  })

  it("updates only the agent when work-style settings are customized", async () => {
    const config: WorkStyleConfig = {
      permission: { edit: "deny" },
      terminal_command_display: "expanded",
      auto_collapse_reasoning: false,
    }
    const state = setup({ config, customized: true, global: { default_agent: "reviewer" } })

    const result = await applyWorkStyle("autonomous", "data", state.store)

    expect(result).toEqual({ ok: true, style: "autonomous", agent: "data" })
    expect(state.patches).toEqual([{ default_agent: "data" }])
    expect(state.events.some((event) => event.startsWith("write:showTaskTimeline"))).toBe(false)
    expect(state.settings.get("agentWorkStyle")).toBe("autonomous")
  })
})
