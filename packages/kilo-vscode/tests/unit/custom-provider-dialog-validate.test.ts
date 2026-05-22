import { describe, expect, it } from "bun:test"
import { validateCustomProvider } from "../../webview-ui/src/components/settings/CustomProviderValidation"
import type { FormState } from "../../webview-ui/src/components/settings/CustomProviderValidation"

// Simple translator that returns the key so tests can assert on key names
const t = (key: string) => key

function base(): FormState {
  return {
    providerID: "my-provider",
    name: "My Provider",
    baseURL: "https://example.com/v1",
    apiKey: "",
    models: [{ id: "model-1", name: "Model One", reasoning: false, variants: [] }],
    headers: [],
    saving: false,
  }
}

function args(form: FormState) {
  return {
    form,
    t,
    editing: false,
    disabledProviders: [],
    existingProviderIDs: new Set<string>(),
  }
}

describe("validateCustomProvider – variant name validation", () => {
  it("allows reconnecting a disabled provider id", () => {
    const form = base()
    const out = validateCustomProvider({
      ...args(form),
      disabledProviders: ["my-provider"],
      existingProviderIDs: new Set(["my-provider"]),
    })

    expect(out.result?.providerID).toBe("my-provider")
    expect(out.errors.providerID).toBeUndefined()
  })

  it("allows submit when reasoning is enabled with no variants", () => {
    const form = base()
    form.models[0].reasoning = true
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    expect(out.errors.models[0].variants).toEqual([])
  })

  it("allows submit when reasoning is enabled with a named variant", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "fast",
        enableThinking: undefined,
        thinking: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    expect(out.errors.models[0].variants?.[0]?.name).toBeUndefined()
  })

  it("blocks submit and reports error when reasoning is enabled with an empty variant name", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "",
        enableThinking: undefined,
        thinking: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].variants?.[0]?.name).toBe("provider.custom.error.required")
  })

  it("blocks submit and reports error when reasoning is enabled with a whitespace-only variant name", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "   ",
        enableThinking: undefined,
        thinking: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].variants?.[0]?.name).toBe("provider.custom.error.required")
  })

  it("blocks submit and reports duplicate error for two variants with the same name", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "fast",
        enableThinking: undefined,
        thinking: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
      {
        name: "fast",
        enableThinking: undefined,
        thinking: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].variants?.[1]?.name).toBe("provider.custom.error.duplicate")
  })

  it("ignores variants entirely when reasoning is disabled, even if they have empty names", () => {
    const form = base()
    form.models[0].reasoning = false
    form.models[0].variants = [
      {
        name: "",
        enableThinking: undefined,
        thinking: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    // No variant errors produced; form is allowed to submit
    expect(out.errors.models[0].variants).toEqual([])
    // Variant is not included in the saved config
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.variants).toBeUndefined()
  })

  it("persists named variants in the saved config when reasoning is enabled", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      { name: "eco", enableThinking: true, thinking: undefined, reasoningEffort: "low", chatTemplateArgs: undefined },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.variants).toEqual({ eco: { enable_thinking: true, reasoningEffort: "low" } })
  })
})
