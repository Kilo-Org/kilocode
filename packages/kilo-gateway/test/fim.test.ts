import { describe, expect, test } from "bun:test"
import { buildOpenAICompletionsRequest, isLoopbackUrl, openAICompletionsUrl, resolveFimTarget } from "../src/fim"

describe("FIM target resolution", () => {
  test("keeps gateway autocomplete models on Kilo Gateway", () => {
    expect(resolveFimTarget("kilo", "mistralai/codestral-2508")).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "https://api.kilo.ai/api/fim/completions",
    })
  })

  test("routes built-in direct providers without configured-provider lookup", () => {
    expect(resolveFimTarget("mistral", "codestral-2508")).toEqual({
      provider: "mistral",
      model: "codestral-2508",
    })
    expect(resolveFimTarget("inception", "mercury-edit-2")).toEqual({
      provider: "inception",
      model: "mercury-edit-2",
      url: "https://api.inceptionlabs.ai/v1/fim/completions",
    })
  })

  test("routes arbitrary explicit selections through their configured provider", () => {
    expect(resolveFimTarget("llamacpp", "qwen2.5-coder-1.5b")).toEqual({
      provider: "configured",
      providerID: "llamacpp",
      model: "qwen2.5-coder-1.5b",
    })
  })

  test("fails closed when an explicit provider has no model", () => {
    expect(resolveFimTarget("lmstudio")).toEqual({
      provider: "configured",
      providerID: "lmstudio",
      model: "",
    })
  })

  test("preserves the default gateway behavior when no provider is selected", () => {
    expect(resolveFimTarget()).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2501",
      url: "https://api.kilo.ai/api/fim/completions",
    })
  })
})

describe("OpenAI-compatible FIM transport", () => {
  test("uses the standard prompt and suffix completions fields", () => {
    expect(
      buildOpenAICompletionsRequest({
        model: "qwen2.5-coder-1.5b",
        prefix: "function add(a, b) { return ",
        suffix: "; }\n",
        maxTokens: 64,
        temperature: 0,
      }),
    ).toEqual({
      model: "qwen2.5-coder-1.5b",
      prompt: "function add(a, b) { return ",
      suffix: "; }\n",
      max_tokens: 64,
      temperature: 0,
      stream: true,
    })
  })

  test("joins the completions endpoint and recognizes loopback servers", () => {
    expect(openAICompletionsUrl("http://127.0.0.1:1234/v1/")).toBe("http://127.0.0.1:1234/v1/completions")
    expect(openAICompletionsUrl("https://inference.example/v1")).toBe("https://inference.example/v1/completions")
    expect(isLoopbackUrl("http://localhost:1234/v1/completions")).toBe(true)
    expect(isLoopbackUrl("https://inference.example/v1/completions")).toBe(false)
  })
})
