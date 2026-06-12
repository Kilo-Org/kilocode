import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloMorphRouter } from "../../src/kilocode/provider/morph-router"
import type { Provider } from "../../src/provider/provider"
import type { MessageV2 } from "../../src/session/message-v2"

function providerInfo(input: { models: string[]; key?: string; options?: Record<string, any> }) {
  return {
    models: Object.fromEntries(input.models.map((id) => [id, { id }])),
    key: input.key,
    options: input.options ?? {},
  } as unknown as Provider.Info
}

function connected(overrides?: Record<string, Provider.Info>): Record<string, Provider.Info> {
  return {
    morph: providerInfo({ models: ["morph-v3-fast", "auto"], key: "sk-morph-test" }),
    anthropic: providerInfo({ models: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"] }),
    google: providerInfo({ models: ["gemini-3.5-flash", "gemini-3.1-pro-preview"] }),
    ...overrides,
  }
}

function userMessage(text: string, opts?: { synthetic?: boolean; id?: string }): MessageV2.WithParts {
  return {
    info: { id: opts?.id ?? "msg_1", role: "user" },
    parts: [{ type: "text", text, synthetic: opts?.synthetic }],
  } as unknown as MessageV2.WithParts
}

const realFetch = globalThis.fetch

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; body: any }[] = []
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined })
    return handler(String(url), init)
  }) as typeof fetch
  return calls
}

afterEach(() => {
  globalThis.fetch = realFetch
  KiloMorphRouter.resetCache()
})

describe("KiloMorphRouter.isRouterModel", () => {
  test("matches only morph/auto", () => {
    expect(KiloMorphRouter.isRouterModel({ providerID: "morph", modelID: "auto" })).toBe(true)
    expect(KiloMorphRouter.isRouterModel({ providerID: "morph", modelID: "morph-v3-fast" })).toBe(false)
    expect(KiloMorphRouter.isRouterModel({ providerID: "anthropic", modelID: "auto" })).toBe(false)
    expect(KiloMorphRouter.isRouterModel(undefined)).toBe(false)
  })
})

describe("KiloMorphRouter.catalogModels", () => {
  test("injects the auto pseudo-model for morph only", () => {
    const models = KiloMorphRouter.catalogModels({ id: "morph", api: "https://api.morphllm.com/v1" })
    expect(models["auto"]).toBeDefined()
    expect(models["auto"].name).toBe(KiloMorphRouter.MODEL_NAME)
    expect(models["auto"].capabilities.toolcall).toBe(true)
    expect(KiloMorphRouter.catalogModels({ id: "anthropic" })).toEqual({})
  })
})

describe("KiloMorphRouter.candidates", () => {
  test("maps connected providers to router names", () => {
    expect(KiloMorphRouter.candidates(connected())).toEqual(["anthropic", "gemini"])
  })

  test("ignores providers without models and unsupported providers", () => {
    const providers = connected({
      openai: providerInfo({ models: [] }),
      openrouter: providerInfo({ models: ["openai/gpt-5.5"] }),
    })
    expect(KiloMorphRouter.candidates(providers)).toEqual(["anthropic", "gemini"])
  })
})

describe("KiloMorphRouter.resolveLocalModel", () => {
  const info = providerInfo({ models: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"] })

  test("exact match", () => {
    expect(KiloMorphRouter.resolveLocalModel(info, "claude-sonnet-4-6")).toBe("claude-sonnet-4-6")
  })

  test("tolerates version suffix drift in either direction", () => {
    expect(KiloMorphRouter.resolveLocalModel(info, "claude-haiku-4-5")).toBe("claude-haiku-4-5-20251001")
    const dated = providerInfo({ models: ["claude-haiku-4-5"] })
    expect(KiloMorphRouter.resolveLocalModel(dated, "claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5")
  })

  test("returns undefined when unavailable", () => {
    expect(KiloMorphRouter.resolveLocalModel(info, "gpt-5.5")).toBeUndefined()
    expect(KiloMorphRouter.resolveLocalModel(undefined, "gpt-5.5")).toBeUndefined()
  })
})

describe("KiloMorphRouter.mapResponse", () => {
  test("maps gemini to the local google provider", () => {
    const routed = KiloMorphRouter.mapResponse(
      connected(),
      { model: "gemini-3.5-flash", provider: "gemini" },
      ["anthropic", "gemini"],
    )
    expect(routed).toEqual({ type: "ok", providerID: "google", modelID: "gemini-3.5-flash" } as any)
  })

  test("scans allowed providers when provider field is missing", () => {
    const routed = KiloMorphRouter.mapResponse(connected(), { model: "claude-opus-4-8" }, ["anthropic", "gemini"])
    expect(routed?.providerID).toBe("anthropic" as any)
  })

  test("returns undefined for unavailable models", () => {
    expect(
      KiloMorphRouter.mapResponse(connected(), { model: "gpt-5.5", provider: "openai" }, ["anthropic", "gemini"]),
    ).toBeUndefined()
  })
})

describe("KiloMorphRouter.defaultSelection", () => {
  test("prefers the anthropic fallback when connected", () => {
    const selection = KiloMorphRouter.defaultSelection(connected(), ["anthropic", "gemini"])
    expect(selection).toEqual({ type: "ok", providerID: "anthropic", modelID: "claude-sonnet-4-6" } as any)
  })

  test("falls through to any available model", () => {
    const providers = { deepseek: providerInfo({ models: ["deepseek-chat"] }) }
    const selection = KiloMorphRouter.defaultSelection(providers, ["deepseek"])
    expect(selection).toEqual({ type: "ok", providerID: "deepseek", modelID: "deepseek-chat" } as any)
  })
})

describe("KiloMorphRouter.promptText", () => {
  test("uses the latest non-synthetic user text", () => {
    const messages = [
      userMessage("first question", { id: "msg_1" }),
      userMessage("synthetic reminder", { id: "msg_2", synthetic: true }),
    ]
    expect(KiloMorphRouter.promptText(messages)).toBe("first question")
  })

  test("truncates long prompts", () => {
    const text = KiloMorphRouter.promptText([userMessage("x".repeat(10_000))])
    expect(text.length).toBe(4_000)
  })

  test("returns empty string when no user text exists", () => {
    expect(KiloMorphRouter.promptText([])).toBe("")
  })
})

describe("KiloMorphRouter.route", () => {
  test("routes via the Morph API and caches per message", async () => {
    const calls = mockFetch(() =>
      Response.json({ model: "claude-haiku-4-5-20251001", provider: "anthropic", difficulty: "easy" }),
    )
    const input = { providers: connected(), messages: [userMessage("add error handling")], messageID: "msg_a" }

    const first = await Effect.runPromise(KiloMorphRouter.route(input))
    expect(first).toEqual({ type: "ok", providerID: "anthropic", modelID: "claude-haiku-4-5-20251001" } as any)
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe("https://api.morphllm.com/v1/router/multimodel")
    expect(calls[0].body).toMatchObject({
      input: "add error handling",
      allowed_providers: ["anthropic", "gemini"],
      policy: "balanced",
      default_model: "claude-sonnet-4-6",
    })

    const second = await Effect.runPromise(KiloMorphRouter.route(input))
    expect(second).toEqual(first)
    expect(calls.length).toBe(1)
  })

  test("falls back to the default selection when the router fails", async () => {
    mockFetch(() => new Response("oops", { status: 500 }))
    const result = await Effect.runPromise(
      KiloMorphRouter.route({ providers: connected(), messages: [userMessage("hi")], messageID: "msg_b" }),
    )
    expect(result).toEqual({ type: "ok", providerID: "anthropic", modelID: "claude-sonnet-4-6" } as any)
  })

  test("falls back when the router returns an unavailable model", async () => {
    mockFetch(() => Response.json({ model: "gpt-5.5", provider: "openai" }))
    const result = await Effect.runPromise(
      KiloMorphRouter.route({ providers: connected(), messages: [userMessage("hi")], messageID: "msg_c" }),
    )
    expect(result).toEqual({ type: "ok", providerID: "anthropic", modelID: "claude-sonnet-4-6" } as any)
  })

  test("errors when no Morph API key is available", async () => {
    const providers = connected({ morph: providerInfo({ models: ["auto"] }) })
    const result = await Effect.runPromise(
      KiloMorphRouter.route({ providers, messages: [userMessage("hi")], messageID: "msg_d" }),
    )
    expect(result.type).toBe("error")
    if (result.type === "error") expect(result.message).toContain("API key")
  })

  test("errors when no routable provider is connected", async () => {
    const providers = { morph: providerInfo({ models: ["auto"], key: "sk-morph-test" }) }
    const result = await Effect.runPromise(
      KiloMorphRouter.route({ providers, messages: [userMessage("hi")], messageID: "msg_e" }),
    )
    expect(result.type).toBe("error")
    if (result.type === "error") expect(result.message).toContain("no routable provider")
  })

  test("reads policy and base URL from provider options", async () => {
    const calls = mockFetch(() => Response.json({ model: "gemini-3.5-flash", provider: "gemini" }))
    const providers = connected({
      morph: providerInfo({
        models: ["auto"],
        key: "sk-morph-test",
        options: { routerPolicy: "cost_efficient", baseURL: "https://example.com/v1/" },
      }),
    })
    const result = await Effect.runPromise(
      KiloMorphRouter.route({ providers, messages: [userMessage("hi")], messageID: "msg_f" }),
    )
    expect(result).toEqual({ type: "ok", providerID: "google", modelID: "gemini-3.5-flash" } as any)
    expect(calls[0].url).toBe("https://example.com/v1/router/multimodel")
    expect(calls[0].body.policy).toBe("cost_efficient")
  })

  test("skips the router call when the prompt has no text", async () => {
    const calls = mockFetch(() => Response.json({ model: "claude-opus-4-8" }))
    const result = await Effect.runPromise(
      KiloMorphRouter.route({ providers: connected(), messages: [], messageID: "msg_g" }),
    )
    expect(result).toEqual({ type: "ok", providerID: "anthropic", modelID: "claude-sonnet-4-6" } as any)
    expect(calls.length).toBe(0)
  })
})
