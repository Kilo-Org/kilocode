import { describe, expect, test } from "bun:test"
import { buildMtplxRequest, isLoopbackMtplxUrl, mtplxChatUrl, resolveFimTarget } from "../src/fim"

describe("FIM target resolution", () => {
  test("keeps gateway autocomplete models on Kilo Gateway", () => {
    expect(resolveFimTarget("kilo", "mistralai/codestral-2508")).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "https://api.kilo.ai/api/fim/completions",
    })
    expect(resolveFimTarget("kilo", "inception/mercury-edit-2")).toEqual({
      provider: "kilo",
      model: "inception/mercury-edit-2",
      url: "https://api.kilo.ai/api/fim/completions",
    })
  })

  test("routes explicit provider autocomplete models directly", () => {
    expect(resolveFimTarget("mistral", "codestral-2508")).toEqual({
      provider: "mistral",
      model: "codestral-2508",
    })
    expect(resolveFimTarget("inception", "mercury-edit-2")).toEqual({
      provider: "inception",
      model: "mercury-edit-2",
      url: "https://api.inceptionlabs.ai/v1/fim/completions",
    })
    expect(resolveFimTarget("mtplx", "Qwen3.5-9B-MTPLX")).toEqual({
      provider: "mtplx",
      model: "Qwen3.5-9B-MTPLX",
    })
  })

  test("preserves gateway model pass-through behavior", () => {
    expect(resolveFimTarget()).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2501",
      url: "https://api.kilo.ai/api/fim/completions",
    })
    expect(resolveFimTarget(undefined, "mistralai/codestral-2508")).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "https://api.kilo.ai/api/fim/completions",
    })
    expect(resolveFimTarget(undefined, "inception/mercury-edit")).toEqual({
      provider: "kilo",
      model: "inception/mercury-edit",
      url: "https://api.kilo.ai/api/fim/completions",
    })
    expect(resolveFimTarget("kilo", "custom/fim-model")).toEqual({
      provider: "kilo",
      model: "custom/fim-model",
      url: "https://api.kilo.ai/api/fim/completions",
    })
  })
})

describe("MTPLX chat transport", () => {
  test("places the stable suffix before the changing prefix and disables thinking", () => {
    const request = buildMtplxRequest({
      model: "Qwen3.5-9B-MTPLX",
      prefix: "function add(a, b) { return ",
      suffix: "; }\n",
      maxTokens: 256,
      temperature: 0,
    })

    expect(request.max_tokens).toBe(64)
    expect(request.enable_thinking).toBe(false)
    expect(request.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(request.stop).toEqual(["; }"])
    expect(request.messages[1]?.content).toBe(
      "SUFFIX AFTER CURSOR:\n; }\n\n\nPREFIX BEFORE CURSOR:\nfunction add(a, b) { return \n\nINSERT AT CURSOR:",
    )
  })

  test("builds the chat endpoint and recognizes only loopback URLs as local", () => {
    expect(mtplxChatUrl()).toBe("http://127.0.0.1:8001/v1/chat/completions")
    expect(mtplxChatUrl("https://bifrost.example/v1/")).toBe("https://bifrost.example/v1/chat/completions")
    expect(isLoopbackMtplxUrl("http://localhost:8001/v1/chat/completions")).toBe(true)
    expect(isLoopbackMtplxUrl("https://bifrost.example/v1/chat/completions")).toBe(false)
  })
})
