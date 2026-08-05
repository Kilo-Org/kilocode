import { describe, expect, it } from "bun:test"
import { validateCustomProvider } from "../../webview-ui/src/components/settings/CustomProviderValidation"
import type { FormState } from "../../webview-ui/src/components/settings/CustomProviderValidation"
import { advanced, mergeMetadata } from "../../webview-ui/src/components/settings/CustomProviderReasoningOptions"

const t = (key: string) => key

function base(): FormState {
  return {
    providerID: "my-provider",
    name: "My Provider",
    npm: "@ai-sdk/openai-compatible",
    baseURL: "https://example.com/v1",
    apiKey: "",
    efforts: [],
    models: [
      {
        id: "model-1",
        name: "Model One",
        reasoning: false,
        supportsImages: false,
        modalities: {},
        mode: "inherit",
        efforts: [],
      },
    ],
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

describe("validateCustomProvider", () => {
  it("preserves advanced metadata while updating known effort values", () => {
    const source = [
      { type: "budget_tokens" as const, min: 1024 },
      { type: "effort" as const, values: ["default", "high"] },
      { type: "effort" as const, values: ["provider-specific"] },
    ]
    expect(advanced(source)).toBe(true)
    expect(mergeMetadata(source, ["low", "max"])).toEqual([
      { type: "budget_tokens", min: 1024 },
      { type: "effort", values: ["low", "max", "default", "provider-specific"] },
    ])
  })

  it("persists the selected provider package", () => {
    const form = base()
    form.npm = "@ai-sdk/openai"
    expect(validateCustomProvider(args(form)).result?.config.npm).toBe("@ai-sdk/openai")
  })

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

  it("serializes provider default reasoning efforts", () => {
    const form = base()
    form.efforts = ["none", "low", "medium", "high", "xhigh", "max"]
    expect(validateCustomProvider(args(form)).result?.config.reasoning_options).toEqual([
      { type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] },
    ])
  })

  it("omits model reasoning options when inheriting provider defaults", () => {
    const form = base()
    form.models[0].reasoning = true
    const saved = validateCustomProvider(args(form)).result?.config.models["model-1"] as Record<string, unknown>
    expect(saved.reasoning).toBe(true)
    expect(saved.reasoning_options).toBeUndefined()
  })

  it("serializes a model-specific reasoning effort set", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].mode = "custom"
    form.models[0].efforts = ["minimal", "high", "max"]
    const saved = validateCustomProvider(args(form)).result?.config.models["model-1"] as Record<string, unknown>
    expect(saved.reasoning_options).toEqual([{ type: "effort", values: ["minimal", "high", "max"] }])
  })

  it("serializes an explicit model opt-out as an empty option set", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].mode = "none"
    const saved = validateCustomProvider(args(form)).result?.config.models["model-1"] as Record<string, unknown>
    expect(saved.reasoning_options).toEqual([])
  })

  it("preserves existing reasoning metadata and advanced variants", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].mode = "custom"
    form.models[0].metadata = [{ type: "budget_tokens", min: 1024, max: 8192 }]
    form.models[0].variants = { fast: { budgetTokens: 1024, custom: true } }
    const saved = validateCustomProvider(args(form)).result?.config.models["model-1"] as Record<string, unknown>
    expect(saved.reasoning_options).toEqual([{ type: "budget_tokens", min: 1024, max: 8192 }])
    expect(saved.variants).toEqual({ fast: { budgetTokens: 1024, custom: true } })
  })

  it("omits reasoning metadata but preserves advanced variants when reasoning is disabled", () => {
    const form = base()
    form.models[0].metadata = [{ type: "effort", values: ["high"] }]
    form.models[0].variants = { high: { reasoningEffort: "high" } }
    const saved = validateCustomProvider(args(form)).result?.config.models["model-1"] as Record<string, unknown>
    expect(saved.reasoning).toBe(false)
    expect(saved.reasoning_options).toBeUndefined()
    expect(saved.variants).toEqual({ high: { reasoningEffort: "high" } })
  })

  it("treats model IDs differing only in case as duplicates", () => {
    const form = base()
    form.models = [
      {
        id: "qwen2.5-coder:14b",
        name: "Qwen",
        reasoning: false,
        supportsImages: false,
        modalities: {},
        mode: "inherit",
        efforts: [],
      },
      {
        id: "QWEN2.5-CODER:14B",
        name: "Qwen Upper",
        reasoning: false,
        supportsImages: false,
        modalities: {},
        mode: "inherit",
        efforts: [],
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].id).toBeUndefined()
    expect(out.errors.models[1].id).toBe("provider.custom.error.duplicate")
  })

  it("serializes image modality when supportsImages is set", () => {
    const form = base()
    form.models[0].supportsImages = true
    const saved = validateCustomProvider(args(form)).result?.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ input: ["text", "image"] })
  })

  it("preserves existing image-only input when saving", () => {
    const form = base()
    form.models[0].modalities = { input: ["image"] }
    form.models[0].supportsImages = true
    const saved = validateCustomProvider(args(form)).result?.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ input: ["image"] })
  })

  it("preserves unsupported UI modalities when toggling image support", () => {
    const form = base()
    form.models[0].modalities = {
      input: ["text", "audio", "image", "video", "pdf"],
      output: ["text", "audio"],
    }
    form.models[0].supportsImages = false
    const saved = validateCustomProvider(args(form)).result?.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ input: ["text", "audio", "video", "pdf"], output: ["text", "audio"] })
  })
})
