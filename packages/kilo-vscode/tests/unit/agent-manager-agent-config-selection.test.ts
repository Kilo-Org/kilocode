import { describe, expect, it } from "bun:test"
import {
  agentConfigSelection,
  agentConfigVariant,
  promptVariant,
} from "../../webview-ui/agent-manager/agent-config-selection"
import type { Config, ModelSelection } from "../../webview-ui/src/types/messages"

const model: ModelSelection = { providerID: "anthropic", modelID: "claude-sonnet-4" }
const other: ModelSelection = { providerID: "openai", modelID: "gpt-5" }
const variants = ["low", "medium", "high"]
const exists = (sel: ModelSelection) => sel.providerID === model.providerID && sel.modelID === model.modelID
const list = (sel: ModelSelection | null) => (sel && exists(sel) ? variants : [])

describe("Agent Manager agent config selection", () => {
  it("uses the newly selected agent variant when agents share the same model", () => {
    const config: Config = {
      model: "anthropic/claude-sonnet-4",
      agent: {
        code: { model: "anthropic/claude-sonnet-4", variant: "low" },
        ask: { model: "anthropic/claude-sonnet-4", variant: "high" },
      },
    }

    expect(agentConfigSelection({ config, agent: "ask", fallback: model, exists, variants: list })).toEqual({
      model,
      variant: "high",
    })
  })

  it("does not fall back to the first variant when an agent has no configured variant", () => {
    const config: Config = {
      model: "anthropic/claude-sonnet-4",
      agent: {
        ask: { model: "anthropic/claude-sonnet-4" },
      },
    }

    expect(agentConfigSelection({ config, agent: "ask", fallback: model, exists, variants: list })).toEqual({
      model,
      variant: undefined,
    })
  })

  it("uses the global configured model before the previous agent fallback", () => {
    const config: Config = {
      model: "anthropic/claude-sonnet-4",
      agent: {
        ask: {},
      },
    }

    expect(agentConfigSelection({ config, agent: "ask", fallback: other, exists, variants: list })).toEqual({
      model,
      variant: undefined,
    })
  })

  it("ignores a configured variant when the configured agent model does not match the selected model", () => {
    const config: Config = {
      agent: {
        ask: { model: "openai/gpt-5", variant: "high" },
      },
    }

    expect(agentConfigVariant({ config, agent: "ask", model, variants })).toBeUndefined()
  })

  it("keeps the current fallback model when the configured agent model is unavailable", () => {
    const config: Config = {
      agent: {
        ask: { model: "openai/gpt-5", variant: "high" },
      },
    }

    expect(agentConfigSelection({ config, agent: "ask", fallback: model, exists, variants: list })).toEqual({
      model,
      variant: undefined,
    })
    expect(other).toEqual({ providerID: "openai", modelID: "gpt-5" })
  })

  it("preserves an explicit Default selection despite a configured high variant", () => {
    const config: Config = {
      agent: {
        ask: { model: "anthropic/claude-sonnet-4", variant: "high" },
      },
    }

    expect(agentConfigVariant({ config, agent: "ask", model, variants })).toBe("high")
    expect(promptVariant("default", variants)).toBe("default")
  })

  it("submits an untouched configured variant", () => {
    const config: Config = {
      agent: {
        ask: { model: "anthropic/claude-sonnet-4", variant: "high" },
      },
    }

    const value = agentConfigVariant({ config, agent: "ask", model, variants })
    expect(promptVariant(value, variants)).toBe("high")
  })

  it("drops absent and invalid prompt variants", () => {
    expect(promptVariant(undefined, variants)).toBeUndefined()
    expect(promptVariant("ultra", variants)).toBeUndefined()
  })
})
