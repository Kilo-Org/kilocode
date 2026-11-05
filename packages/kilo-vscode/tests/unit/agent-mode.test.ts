import { describe, expect, it } from "bun:test"
import {
  MODE_OPTIONS,
  agentMode,
  candidates,
  editable,
  modeOptions,
  pin,
} from "../../webview-ui/src/components/settings/agent-mode"
import { dict } from "../../webview-ui/src/i18n/en"

describe("MODE_OPTIONS", () => {
  it("offers every CLI agent mode once", () => {
    expect(MODE_OPTIONS.map((o) => o.value)).toEqual(["primary", "subagent", "all"])
  })

  it("only uses label keys that exist in the English dictionary", () => {
    for (const option of MODE_OPTIONS) {
      expect(Object.keys(dict)).toContain(option.labelKey)
    }
  })
})

describe("agentMode", () => {
  it("prefers the configured (draft) mode over the mode reported by the CLI", () => {
    expect(agentMode({ mode: "subagent" }, { name: "reviewer", mode: "primary" })).toBe("subagent")
  })

  it("falls back to the CLI mode when the config does not set one", () => {
    expect(agentMode({}, { name: "explore", mode: "subagent", native: true })).toBe("subagent")
  })

  it("defaults config-only agents to all, matching the CLI default", () => {
    expect(agentMode({})).toBe("all")
  })
})

describe("editable", () => {
  it("allows custom agents reported by the CLI", () => {
    expect(editable("reviewer", {}, { name: "reviewer", mode: "primary", native: false })).toBe(true)
  })

  it("locks built-in agents", () => {
    expect(editable("explore", {}, { name: "explore", mode: "subagent", native: true })).toBe(false)
  })

  it("allows unsaved agents created from the settings, which always set a mode", () => {
    expect(editable("reviewer", { mode: "primary" })).toBe(true)
  })

  it("locks agents missing from the CLI list without a configured mode, such as a disabled built-in agent", () => {
    expect(editable("explore", { disable: true })).toBe(false)
  })

  it("locks the legacy build alias of the built-in code agent", () => {
    expect(editable("build", { mode: "primary", temperature: 0.2 })).toBe(false)
  })
})

describe("pin", () => {
  it("is unset for an agent that is not the default", () => {
    expect(pin("reviewer", "code", undefined)).toBeUndefined()
  })

  it("flags the effective (draft) default agent", () => {
    expect(pin("reviewer", "reviewer", undefined)).toBe("default")
  })

  it("flags a project-level default even after the global default changes in the draft", () => {
    expect(pin("reviewer", "code", "reviewer")).toBe("project")
  })
})

describe("modeOptions", () => {
  it("offers every mode when the agent is not pinned", () => {
    expect(modeOptions(false, "primary")).toEqual(MODE_OPTIONS)
  })

  it("does not let a pinned agent become a subagent only", () => {
    expect(modeOptions(true, "primary").map((o) => o.value)).toEqual(["primary", "all"])
  })

  it("keeps subagent when a pinned agent already has it, so the current mode stays visible", () => {
    expect(modeOptions(true, "subagent")).toEqual(MODE_OPTIONS)
  })
})

describe("candidates", () => {
  const agents = [
    { name: "code", mode: "primary" as const, native: true },
    { name: "reviewer", mode: "primary" as const, native: false },
    { name: "helper", mode: "all" as const, native: false },
  ]

  it("keeps agents that remain selectable as primary agents", () => {
    expect(candidates(agents, undefined).map((a) => a.name)).toEqual(["code", "reviewer", "helper"])
  })

  it("drops agents switched to subagent in the unsaved draft", () => {
    const cfg = { reviewer: { mode: "subagent" as const }, helper: { mode: "subagent" as const } }
    expect(candidates(agents, cfg).map((a) => a.name)).toEqual(["code"])
  })
})
