import { describe, expect, test } from "bun:test"
import { createAnthropic } from "@ai-sdk/anthropic"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { generateText } from "ai"
import { AceCatalog } from "@/kilocode/provider/acedatacloud"
import { customProviderVariants, patchConfigModel } from "@/kilocode/provider/provider"
import { Effect } from "effect"

const chat = {
  api_id: "chat-api",
  protocol: "chat_completions",
  path: "/v1/chat/completions",
  base_url: "https://api.acedata.cloud/v1",
  auth: "bearer",
}
const messages = {
  api_id: "messages-api",
  protocol: "messages",
  path: "/v1/messages",
  base_url: "https://api.acedata.cloud",
  auth: "bearer",
}
const item = (id: string, endpoints: (typeof chat & { unit?: string; pricing?: unknown })[] = [chat]) => ({
  id,
  name: id,
  modality: "chat",
  capabilities: ["reasoning", "vision"],
  endpoints,
})

describe("Ace live model catalog", () => {
  test("publishes only identity without contacting Ace until the user configures it", async () => {
    let calls = 0
    const cache = AceCatalog.create(async () => {
      calls++
      return Response.json({ items: [item("configured")] })
    })
    const idle = await Effect.runPromise(cache.overlay({}, {}, { active: false }))
    expect(calls).toBe(0)
    expect(idle.acedatacloud?.models).toEqual({})
    await Effect.runPromise(cache.overlay({}, { disabled_providers: ["acedatacloud"] }, { active: true }))
    expect(calls).toBe(0)
    const active = await Effect.runPromise(cache.overlay({}, {}, { active: true }))
    expect(calls).toBe(1)
    expect(active.acedatacloud?.models.configured).toBeDefined()
    active.acedatacloud!.models.configured!.limit.context = 8192
    const fresh = await Effect.runPromise(cache.overlay({}, {}, { active: true }))
    expect(fresh.acedatacloud?.models.configured?.limit.context).toBe(0)
  })

  test("discovers future IDs through their explicit protocol and excludes media", async () => {
    const cache = AceCatalog.create(async () =>
      Response.json({
        items: [
          item("future-unlisted-chat"),
          item("messages-only", [messages]),
          { ...item("image-model"), modality: "image" },
        ],
      }),
    )
    const { provider } = await cache.get()
    expect(Object.keys(provider.models)).toEqual(["future-unlisted-chat", "messages-only"])
    expect(provider.models["future-unlisted-chat"]?.api.npm).toBe("@ai-sdk/openai-compatible")
    expect(provider.models["messages-only"]?.api).toEqual({
      id: "messages-only",
      npm: "@ai-sdk/anthropic",
      url: "https://api.acedata.cloud/v1",
    })
  })

  test("does not publish invented capacities, prices, tools, variants or lab defaults", async () => {
    const cache = AceCatalog.create(async () =>
      Response.json({
        items: [{ ...item("gpt-new"), truncation_policy: { limit: 10000 }, context_length: 999999 }],
      }),
    )
    const model = (await cache.get()).provider.models["gpt-new"]!
    expect(model.unpublished).toEqual(["context", "output", "pricing", "tools"])
    expect(model.limit).toEqual({ context: 0, output: 0 })
    expect(model.isFree).toBeUndefined()
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.unpublished).toContain("tools")
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.variants).toEqual({})
    expect(model.release_date).toBe("")
  })

  test("records declared tool support separately from the unknown-model attempt policy", async () => {
    const cache = AceCatalog.create(async () =>
      Response.json({ items: [{ ...item("tools"), capabilities: ["tool_call"] }] }),
    )
    const model = (await cache.get()).provider.models.tools!
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.unpublished).not.toContain("tools")
    expect(model.capabilities.reasoning).toBe(false)
    expect(model.capabilities.input.image).toBe(false)
  })

  test("explicit unsupported tools take precedence over capability tags and defaults", async () => {
    const cache = AceCatalog.create(async () =>
      Response.json({ items: [{ ...item("no-tools"), tool_call: false, capabilities: ["tool_call"] }] }),
    )
    const model = (await cache.get()).provider.models["no-tools"]!
    expect(model.capabilities.toolcall).toBe(false)
    expect(model.unpublished).not.toContain("tools")
  })

  test("uses the API's explicit ordinary uncached quote only as a Credits reference", async () => {
    const price = {
      kind: "tokens",
      basis: "ordinary_context_uncached",
      input_credits: 12,
      output_credits: 36,
      source: { kind: "api", id: chat.api_id },
    }
    const cache = AceCatalog.create(async () =>
      Response.json({
        items: [
          item("quoted", [{ ...chat, unit: "1M tokens", pricing: price }]),
          item("service-price", [
            { ...chat, unit: "1M tokens", pricing: { ...price, source: { kind: "service", id: "service" } } },
          ]),
          item("per-request", [{ ...chat, unit: "request", pricing: { ...price, kind: "unit" } }]),
        ],
      }),
    )
    const models = (await cache.get()).provider.models
    expect(models.quoted?.referenceCost).toEqual({ input: 12, output: 36 })
    expect(models.quoted?.unpublished).toContain("pricing")
    expect(models["service-price"]?.referenceCost).toBeUndefined()
    expect(models["per-request"]?.referenceCost).toBeUndefined()
  })

  test("rejects unknown hosts, protocol mismatches and unsupported auth", async () => {
    const cache = AceCatalog.create(async () =>
      Response.json({
        items: [
          item("wrong-host", [{ ...chat, base_url: "https://example.invalid" }]),
          item("wrong-path", [{ ...chat, path: "/custom/chat/completions" }]),
          item("wrong-auth", [{ ...chat, auth: "query" }]),
          item("rest-only", [{ ...chat, protocol: "rest" }]),
        ],
      }),
    )
    expect((await cache.get()).provider.models).toEqual({})
  })

  test("coalesces requests, caches five minutes and refreshes removed and added IDs", async () => {
    let now = 0
    let calls = 0
    const cache = AceCatalog.create(
      async (url, init) => {
        calls++
        expect(url).toBe("https://platform.acedata.cloud/api/v1/models/catalog/")
        expect(init.credentials).toBe("omit")
        expect(init.redirect).toBe("error")
        expect(new Headers(init.headers).has("Authorization")).toBe(false)
        return Response.json({ items: [item(calls === 1 ? "old" : "new")] })
      },
      () => now,
    )
    await Promise.all([cache.get(), cache.get(), cache.get()])
    expect(calls).toBe(1)
    now = 299999
    expect((await cache.get()).provider.models).toHaveProperty("old")
    now = 300000
    const next = await cache.get()
    expect(calls).toBe(2)
    expect(next.changed).toBe(true)
    expect(Object.keys(next.provider.models)).toEqual(["new"])
  })

  test("retains the last good catalog after HTTP, malformed data or transport failures", async () => {
    let now = 0
    let calls = 0
    const cache = AceCatalog.create(
      async () => {
        calls++
        if (calls === 2) return new Response("upstream unavailable", { status: 503 })
        if (calls === 3) return Response.json({ items: [{ ...item("broken"), endpoints: undefined }] })
        if (calls === 4) throw new Error("offline fixture")
        return Response.json({ items: [item(calls === 1 ? "known" : "recovered")] })
      },
      () => now,
    )
    await cache.get()
    for (const time of [300000, 600000, 900000]) {
      now = time
      expect(Object.keys((await cache.get()).provider.models)).toEqual(["known"])
      expect(cache.failed()).toBe(true)
    }
    now = 1200000
    expect(Object.keys((await cache.get()).provider.models)).toEqual(["recovered"])
    expect(cache.failed()).toBe(false)
  })

  test("honors user metadata overrides without assigning them to unknown fields", async () => {
    const cache = AceCatalog.create(async () => Response.json({ items: [item("custom")] }))
    const model = (await cache.get()).provider.models.custom!
    expect(patchConfigModel({ limit: { context: 8192 }, tool_call: true }, model).unpublished).toEqual([
      "output",
      "pricing",
    ])
    expect(patchConfigModel({ cost: { input: 3, output: 9 } }, model).unpublished).toEqual([
      "context",
      "output",
      "tools",
    ])
    expect(model.unpublished).toEqual(["context", "output", "pricing", "tools"])
    expect(patchConfigModel({ tool_call: false }, model).unpublished).not.toContain("tools")
    expect(AceCatalog.identity({}).acedatacloud?.env).toEqual(["ACEDATACLOUD_API_KEY"])
  })

  test("does not generate reasoning efforts for discovered models with explicit SDK config", async () => {
    const cache = AceCatalog.create(async () => Response.json({ items: [item("reasoning")] }))
    const model = (await cache.get()).provider.models.reasoning!
    const generated = { high: { reasoningEffort: "high" } }
    expect(customProviderVariants(model, "@ai-sdk/openai-compatible", () => generated)).toEqual({})
    const configured = { low: { reasoningEffort: "low" } }
    expect(
      customProviderVariants({ ...model, variants: configured }, "@ai-sdk/openai-compatible", () => generated),
    ).toEqual(configured)
  })

  test("Anthropic SDK sends Messages to the verified path with Bearer auth", async () => {
    const cache = AceCatalog.create(async () => Response.json({ items: [item("messages-only", [messages])] }))
    const model = (await cache.get()).provider.models["messages-only"]!
    const options: Record<string, unknown> = { apiKey: "noncredential-fixture", baseURL: model.api.url }
    AceCatalog.auth(model, options)
    expect(options.apiKey).toBeUndefined()
    let calls = 0
    const sdk = createAnthropic({
      ...options,
      fetch: Object.assign(
        async (url: URL | RequestInfo, init?: RequestInit) => {
          calls++
          expect(String(url)).toBe("https://api.acedata.cloud/v1/messages")
          expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer noncredential-fixture")
          expect(new Headers(init?.headers).has("x-api-key")).toBe(false)
          return Response.json({
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            model: "messages-only",
            content: [{ type: "text", text: "fixture" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          })
        },
        { preconnect: fetch.preconnect },
      ),
    })
    const result = await generateText({
      model: sdk.languageModel(model.id),
      prompt: "fixture",
      maxOutputTokens: 8,
      maxRetries: 0,
    })
    expect(result.text).toBe("fixture")
    expect(calls).toBe(1)
  })

  test("preserves explicit Bearer credentials and leaves other providers untouched", async () => {
    const cache = AceCatalog.create(async () => Response.json({ items: [item("messages-only", [messages])] }))
    const model = (await cache.get()).provider.models["messages-only"]!
    const options: Record<string, unknown> = { apiKey: "stored-fixture", authToken: "configured-fixture" }
    AceCatalog.auth(model, options)
    expect(options).toEqual({ authToken: "configured-fixture" })
    const other = { apiKey: "other-fixture" }
    AceCatalog.auth({ ...model, providerID: ProviderV2.ID.make("cloudflare-ai-gateway") }, other)
    expect(other).toEqual({ apiKey: "other-fixture" })
  })
})
