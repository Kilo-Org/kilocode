import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"

describe("ProviderTransform.message - prompt cache breakpoint endpoint gating", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "gpt-5.6",
      providerID: "openai",
      api: {
        id: "gpt-5.6",
        url: "https://api.openai.com/v1",
        npm: "@ai-sdk/openai",
      },
      name: "GPT 5.6",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.00125, output: 0.01, cache: { read: 0.000125, write: 0 } },
      limit: { context: 400_000, output: 128_000 },
      status: "active",
      options: {},
      headers: {},
      ...overrides,
    }) as any

  const msgs = () =>
    [
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "Hello" },
    ] as any[]

  test("custom @ai-sdk/openai provider does not apply promptCacheBreakpoint", () => {
    const model = createModel({
      providerID: "custom",
      api: {
        id: "gpt-5.6-sol",
        url: "https://redacted/v1",
        npm: "@ai-sdk/openai",
      },
      id: "gpt-5.6-sol",
    })

    const result = ProviderTransform.message(msgs(), model, {}) as any[]

    expect(result[0].providerOptions?.openai?.promptCacheBreakpoint).toBeUndefined()
    expect(result[1].providerOptions?.openai?.promptCacheBreakpoint).toBeUndefined()
  })

  test("openai provider with a custom endpoint override does not apply promptCacheBreakpoint", () => {
    const model = createModel()

    const result = ProviderTransform.message(msgs(), model, {
      providerEndpointOverride: "https://proxy.example.com/v1",
    }) as any[]

    expect(result[0].providerOptions?.openai?.promptCacheBreakpoint).toBeUndefined()
    expect(result[1].providerOptions?.openai?.promptCacheBreakpoint).toBeUndefined()
  })

  test("openai provider with a model-level baseURL override does not apply promptCacheBreakpoint", () => {
    const model = createModel()

    const result = ProviderTransform.message(msgs(), model, {
      baseURL: "https://gateway.internal:8443/openai/v1",
    }) as any[]

    expect(result[0].providerOptions?.openai?.promptCacheBreakpoint).toBeUndefined()
    expect(result[1].providerOptions?.openai?.promptCacheBreakpoint).toBeUndefined()
  })

  test("openai provider with an unparseable override does not apply promptCacheBreakpoint", () => {
    const model = createModel()

    const result = ProviderTransform.message(msgs(), model, {
      providerEndpointOverride: "not a url",
    }) as any[]

    expect(result[0].providerOptions?.openai?.promptCacheBreakpoint).toBeUndefined()
    expect(result[1].providerOptions?.openai?.promptCacheBreakpoint).toBeUndefined()
  })

  test("first-party openai without overrides still applies promptCacheBreakpoint", () => {
    const model = createModel()

    const result = ProviderTransform.message(msgs(), model, {}) as any[]

    expect(result[0].providerOptions?.openai?.promptCacheBreakpoint).toEqual({ mode: "explicit" })
    expect(result[1].providerOptions?.openai?.promptCacheBreakpoint).toEqual({ mode: "explicit" })
  })

  test("azure endpoint override on an azure host still applies promptCacheBreakpoint", () => {
    const model = createModel({
      providerID: "azure",
      api: {
        id: "gpt-5.6",
        url: "",
        npm: "@ai-sdk/azure",
      },
    })

    const result = ProviderTransform.message(msgs(), model, {
      providerEndpointOverride: "https://myresource.cognitiveservices.azure.com/openai/v1",
    }) as any[]

    expect(result[0].providerOptions?.azure?.promptCacheBreakpoint).toEqual({ mode: "explicit" })
    expect(result[1].providerOptions?.azure?.promptCacheBreakpoint).toEqual({ mode: "explicit" })
  })

  test("azure endpoint override on a non-azure host does not apply promptCacheBreakpoint", () => {
    const model = createModel({
      providerID: "azure",
      api: {
        id: "gpt-5.6",
        url: "",
        npm: "@ai-sdk/azure",
      },
    })

    const result = ProviderTransform.message(msgs(), model, {
      providerEndpointOverride: "https://proxy.example.com/azure/v1",
    }) as any[]

    expect(result[0].providerOptions?.azure?.promptCacheBreakpoint).toBeUndefined()
    expect(result[1].providerOptions?.azure?.promptCacheBreakpoint).toBeUndefined()
  })
})
