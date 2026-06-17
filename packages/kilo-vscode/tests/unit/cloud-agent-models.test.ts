import { describe, expect, it } from "bun:test"
import { initial, modes, options } from "../../webview-ui/agent-manager/cloud-agent/models"
import type { EnrichedModel } from "../../webview-ui/src/context/provider-utils"

function model(id: string, providerID: string): EnrichedModel {
  return { id, name: id, providerID, providerName: providerID }
}

function agent(name: string, extra: { native?: boolean; mode?: string; hidden?: boolean } = {}) {
  return { name, native: true, mode: "primary", ...extra }
}

describe("Cloud Agent creation choices", () => {
  it("uses the fixed supported cloud mode allowlist", () => {
    const items = [
      agent("code"),
      agent("plan"),
      agent("debug"),
      agent("orchestrator"),
      agent("ask"),
      agent("architect"),
      agent("code", { native: false }),
      agent("plan", { mode: "subagent" }),
      agent("debug", { hidden: true }),
    ]

    expect(modes(items).map((item) => item.name)).toEqual(["code", "plan", "debug", "orchestrator", "ask"])
  })

  it("offers only discovered Kilo models and has no fallback model", () => {
    const kilo = { ...model("anthropic/claude-sonnet-4-6", "kilo"), options: { description: "Recommended" } }

    expect(options([])).toEqual([])
    expect(options([model("gpt-5", "openai")])).toEqual([])
    expect(options([model("gpt-5", "openai"), kilo])).toEqual([kilo])
  })

  it("uses the selected Kilo model when available, otherwise the first discovered model", () => {
    const items = [model("kilo-auto/frontier", "kilo"), model("kilo-auto/free", "kilo")]

    expect(initial(items, { providerID: "kilo", modelID: "kilo-auto/free" })).toBe("kilo-auto/free")
    expect(initial(items, { providerID: "openai", modelID: "gpt-5" })).toBe("kilo-auto/frontier")
    expect(initial([], { providerID: "kilo", modelID: "kilo-auto/free" })).toBeUndefined()
  })
})
