import { describe, expect, test } from "bun:test"
import { jsonSchema, type ModelMessage, type Tool } from "ai"
import { LLMEvent } from "@opencode-ai/llm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "@/provider/provider"
import {
  AUTO_DECISION_HEADER,
  ClientCustomRouterEntrySchema,
  CustomRouterEntryRefSchema,
  parseCustomRouterCandidateModel,
  type CustomRouterListEntry,
  type CustomRouterListResponse,
  type FetchLike,
} from "@kilocode/kilo-gateway"
import { KiloCustomRouter } from "@/kilocode/auto-routing/router"
import { clientEntry, linkChoice } from "@/kilocode/auto-routing/entries"
import { openaiMessages, openaiTools } from "@/kilocode/auto-routing/messages"
import { KiloRoutedModel } from "@/kilocode/session/routed-model"

const KILO = ProviderV2.ID.make("kilo")

function model(
  providerID: string,
  id: string,
  input?: { variants?: Record<string, Record<string, unknown>>; price?: number },
): Provider.Model {
  const pid = ProviderV2.ID.make(providerID)
  return {
    id: ModelV2.ID.make(id),
    providerID: pid,
    api: { id, url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
    name: id,
    family: "test",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: input?.price ?? 0, output: input?.price ?? 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 4_096 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    ...(input?.variants ? { variants: input.variants } : {}),
  }
}

function provider(id: string, models: Record<string, Provider.Model>): Provider.Info {
  const pid = ProviderV2.ID.make(id)
  return { id: pid, name: id, source: "config", env: [], options: {}, models }
}

const CATALOG: Record<ProviderV2.ID, Provider.Info> = {
  [ProviderV2.ID.make("ollama")]: provider("ollama", {
    qwen3: model("ollama", "qwen3", { variants: { low: {}, high: {} } }),
  }),
  [KILO]: provider("kilo", {
    "anthropic/claude-sonnet-4": model("kilo", "anthropic/claude-sonnet-4"),
    "kilo-auto/custom/myrouter": model("kilo", "kilo-auto/custom/myrouter"),
  }),
}

const ROUTER_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"

function clientListing(overrides: Partial<CustomRouterListEntry> = {}): CustomRouterListEntry {
  return {
    key: "client:ollama/qwen3",
    entry: ClientCustomRouterEntrySchema.parse({
      kind: "client",
      provider: "ollama",
      model: "qwen3",
      variants: ["low", "high"],
      capabilities: { contextLength: 128_000, inputModalities: ["text", "image"], toolCall: true, reasoning: true },
      pricing: null,
    }),
    needsClientEval: true,
    variants: [{ variant: null, status: "missing", failureReason: null, linked: false }],
    ...overrides,
  }
}

function gatewayListing(): CustomRouterListEntry {
  return {
    key: "gateway:anthropic/claude-sonnet-4",
    entry: { kind: "gateway", model: "anthropic/claude-sonnet-4" },
    needsClientEval: false,
    variants: [{ variant: null, status: "ready", failureReason: null, linked: false }],
  }
}

function listResponse(entries: CustomRouterListEntry[]): CustomRouterListResponse {
  return {
    routers: [
      {
        id: ROUTER_ID,
        scope: "user",
        slug: "myrouter",
        name: "My Router",
        modelId: "kilo-auto/custom/myrouter",
        baseRouter: "efficient",
        mode: "cost_per_accuracy",
        defaultEntryKey: entries[0]?.key ?? "client:ollama/qwen3",
        canEdit: true,
        entries,
      },
    ],
  }
}

type Route = { path: string; body: unknown; status?: number }

function respond(routes: Route[]): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = []
  const stub = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const path = new URL(url).pathname
    calls.push(path)
    const match = routes.find((route) => route.path === path)
    if (!match) return new Response("{}", { status: 404 })
    return new Response(JSON.stringify(match.body), {
      status: match.status ?? 200,
      headers: { "content-type": "application/json" },
    })
  }
  return { fetch: stub, calls }
}

function resolveInput(fetch: FetchLike, token: string) {
  return {
    modelID: "kilo-auto/custom/myrouter",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    sessionID: "ses_1",
    requestID: "msg_1",
    mode: "code",
    machineId: "machine-1",
    token,
    organizationId: null,
    providers: CATALOG,
    fetch,
  }
}

describe("KiloCustomRouter detection", () => {
  test("accepts custom router ids on the kilo provider only", () => {
    expect(KiloCustomRouter.isCustomRouter({ providerID: "kilo", modelID: "kilo-auto/custom/myrouter" })).toBe(true)
    expect(KiloCustomRouter.isCustomRouter({ providerID: "kilo", modelID: "kilo-auto/custom/org/myrouter" })).toBe(true)
    expect(KiloCustomRouter.isCustomRouter({ providerID: "kilo", modelID: "kilo-auto/efficient" })).toBe(false)
    expect(KiloCustomRouter.isCustomRouter({ providerID: "kilo", modelID: "kilo-auto/custom/org" })).toBe(false)
    expect(KiloCustomRouter.isCustomRouter({ providerID: "openai", modelID: "kilo-auto/custom/myrouter" })).toBe(false)
    expect(KiloCustomRouter.isCustomRouter({ providerID: "kilo", modelID: undefined })).toBe(false)
  })
})

describe("KiloCustomRouter servable entries", () => {
  test("keeps only client entries this CLI can serve", () => {
    expect(KiloCustomRouter.servable(clientListing().entry, CATALOG)).toBe(true)
    expect(KiloCustomRouter.servable({ kind: "gateway", model: "anthropic/claude-sonnet-4" }, CATALOG)).toBe(false)
    expect(KiloCustomRouter.servable({ kind: "client", provider: "lmstudio", model: "qwen3" }, CATALOG)).toBe(false)
    expect(KiloCustomRouter.servable({ kind: "client", provider: "ollama", model: "missing" }, CATALOG)).toBe(false)
  })

  test("selects the servable subset of a router", () => {
    const router = listResponse([clientListing(), gatewayListing()]).routers[0]!
    const servable = KiloCustomRouter.servableEntries(router, CATALOG)
    expect(servable.map((entry) => entry.model)).toEqual(["qwen3"])
  })
})

describe("KiloCustomRouter routing decision", () => {
  test("sends the custom id to the gateway when no client entry is servable", async () => {
    const { fetch, calls } = respond([
      { path: "/api/auto-routing/custom-routers", body: listResponse([gatewayListing()]) },
      { path: "/v1/decide", body: { decision: null } },
    ])
    const pick = await KiloCustomRouter.resolve(resolveInput(fetch, "token-a"))
    expect(pick).toBeUndefined()
    expect(calls).toEqual(["/api/auto-routing/custom-routers"])
  })

  test("routes a client pick to the local provider and model", async () => {
    const { fetch } = respond([
      { path: "/api/auto-routing/custom-routers", body: listResponse([clientListing()]) },
      {
        path: "/v1/decide",
        body: {
          decision: {
            entry: { kind: "client", provider: "ollama", model: "qwen3" },
            model: "client:ollama/qwen3",
            variant: "high",
            stale: false,
            fallback: false,
            sticky: false,
            taskType: null,
            subtaskType: null,
            tableVersion: null,
          },
          decisionId: "decision-1",
        },
      },
    ])
    const pick = await KiloCustomRouter.resolve(resolveInput(fetch, "token-b"))
    expect(pick).toEqual({ kind: "client", provider: "ollama", model: "qwen3", variant: "high" })
  })

  test("routes a gateway pick through the gateway with the decision token", async () => {
    const { fetch } = respond([
      { path: "/api/auto-routing/custom-routers", body: listResponse([clientListing(), gatewayListing()]) },
      {
        path: "/v1/decide",
        body: {
          decision: {
            entry: { kind: "gateway", model: "anthropic/claude-sonnet-4" },
            model: "anthropic/claude-sonnet-4",
            variant: null,
            stale: true,
            fallback: true,
            sticky: false,
            taskType: "code",
            subtaskType: null,
            tableVersion: "v1",
          },
          decisionId: "decision-2",
        },
      },
    ])
    const pick = await KiloCustomRouter.resolve(resolveInput(fetch, "token-c"))
    expect(pick).toEqual({
      kind: "gateway",
      model: "anthropic/claude-sonnet-4",
      variant: null,
      decisionId: "decision-2",
    })
  })

  test("refuses a client pick the CLI cannot serve", async () => {
    const { fetch } = respond([
      { path: "/api/auto-routing/custom-routers", body: listResponse([clientListing()]) },
      {
        path: "/v1/decide",
        body: {
          decision: {
            entry: { kind: "client", provider: "lmstudio", model: "qwen3" },
            model: "client:lmstudio/qwen3",
            variant: null,
            stale: false,
            fallback: false,
            sticky: false,
            taskType: null,
            subtaskType: null,
            tableVersion: null,
          },
          decisionId: "decision-3",
        },
      },
    ])
    await expect(KiloCustomRouter.resolve(resolveInput(fetch, "token-d"))).rejects.toThrow(
      "No model in this custom auto router can serve this request",
    )
  })

  test("fails when the router is missing instead of routing elsewhere", async () => {
    const { fetch } = respond([
      {
        path: "/api/auto-routing/custom-routers",
        body: { routers: [{ ...listResponse([clientListing()]).routers[0]!, modelId: "kilo-auto/custom/other" }] },
      },
    ])
    await expect(KiloCustomRouter.resolve(resolveInput(fetch, "token-e"))).rejects.toThrow("was not found")
  })

  test("fails without a Kilo token", async () => {
    const { fetch } = respond([])
    await expect(KiloCustomRouter.resolve(resolveInput(fetch, ""))).rejects.toThrow("Sign in to Kilo")
  })

  test("surfaces worker error codes with specific messages", async () => {
    const codes = [
      ["insufficient_balance", "balance is too low"],
      ["quota_exceeded", "benchmark limit for this router owner is reached. Try again later"],
      ["unauthorized", "Sign in to Kilo"],
      ["forbidden", "do not have access"],
      ["router_not_found", "was not found"],
      ["invalid_request", "rejected the custom router request"],
      ["custom_router_unavailable", "can serve this request"],
      ["stale_engine_identity", "needs a fresh evaluation"],
      ["internal_error", "auto routing failed"],
    ] as const
    for (const [code, needle] of codes) {
      expect(KiloCustomRouter.errorMessage(code)).toContain(needle)
    }

    const { fetch } = respond([
      { path: "/api/auto-routing/custom-routers", body: listResponse([clientListing()]) },
      { path: "/v1/decide", status: 402, body: { error: { code: "insufficient_balance", message: "no credit" } } },
    ])
    await expect(KiloCustomRouter.resolve(resolveInput(fetch, "token-f"))).rejects.toThrow("Top up")

    const malformed = respond([
      { path: "/api/auto-routing/custom-routers", body: listResponse([clientListing()]) },
      { path: "/v1/decide", body: { unexpected: true } },
    ])
    await expect(KiloCustomRouter.resolve(resolveInput(malformed.fetch, "token-g"))).rejects.toThrow(
      "Unexpected response from the custom router service",
    )
  })

  test("reports the quota reset time when the worker sends one", async () => {
    const limited = respond([
      { path: "/api/auto-routing/custom-routers", body: listResponse([clientListing()]) },
      {
        path: "/v1/decide",
        status: 429,
        body: { error: { code: "quota_exceeded", message: "limit", retryAt: "2026-10-17T00:00:00.000Z" } },
      },
    ])
    await expect(KiloCustomRouter.resolve(resolveInput(limited.fetch, "token-h"))).rejects.toThrow(
      "Try again after 2026-10-17T00:00:00.000Z",
    )

    const bare = respond([
      { path: "/api/auto-routing/custom-routers", body: listResponse([clientListing()]) },
      { path: "/v1/decide", status: 429, body: "slow down" },
    ])
    await expect(KiloCustomRouter.resolve(resolveInput(bare.fetch, "token-i"))).rejects.toThrow(
      "benchmark limit for this router owner is reached. Try again later",
    )
  })
})

describe("KiloCustomRouter routed model", () => {
  test("resolves a client pick from the local catalog", () => {
    const base = CATALOG[ProviderV2.ID.kilo]!.models["kilo-auto/custom/myrouter"]!
    const routed = KiloCustomRouter.routedModel({
      pick: { kind: "client", provider: "ollama", model: "qwen3", variant: null },
      base,
      providers: CATALOG,
    })
    expect(String(routed?.providerID)).toBe("ollama")
    expect(String(routed?.id)).toBe("qwen3")
  })

  test("keeps the router request shape for a gateway model the catalog omits", () => {
    const base = CATALOG[KILO]!.models["kilo-auto/custom/myrouter"]!
    const known = KiloCustomRouter.routedModel({
      pick: { kind: "gateway", model: "anthropic/claude-sonnet-4", variant: null, decisionId: "d" },
      base,
      providers: CATALOG,
    })
    expect(String(known?.id)).toBe("anthropic/claude-sonnet-4")

    const unknown = KiloCustomRouter.routedModel({
      pick: { kind: "gateway", model: "vendor/private-model", variant: null, decisionId: "d" },
      base,
      providers: CATALOG,
    })
    expect(String(unknown?.id)).toBe("vendor/private-model")
    expect(unknown?.api.id).toBe("vendor/private-model")
    expect(String(unknown?.providerID)).toBe("kilo")
  })

  test("carries the signed decision to the gateway and leaves the catalog model untouched", () => {
    const base = CATALOG[KILO]!.models["kilo-auto/custom/myrouter"]!
    const routed = KiloCustomRouter.routedModel({
      pick: { kind: "gateway", model: "anthropic/claude-sonnet-4", variant: null, decisionId: "signed-token" },
      base,
      providers: CATALOG,
    })
    expect(routed?.headers[AUTO_DECISION_HEADER]).toBe("signed-token")
    expect(base.headers[AUTO_DECISION_HEADER]).toBeUndefined()
    expect(CATALOG[KILO]!.models["anthropic/claude-sonnet-4"]!.headers[AUTO_DECISION_HEADER]).toBeUndefined()
  })

  test("returns undefined for a client pick that vanished from the catalog", () => {
    const base = CATALOG[KILO]!.models["kilo-auto/custom/myrouter"]!
    expect(
      KiloCustomRouter.routedModel({
        pick: { kind: "client", provider: "lmstudio", model: "qwen3", variant: null },
        base,
        providers: CATALOG,
      }),
    ).toBeUndefined()
  })
})

describe("custom router contracts mirror", () => {
  test("rejects a gateway entry that uses the reserved client prefix", () => {
    expect(CustomRouterEntryRefSchema.safeParse({ kind: "gateway", model: "client:ollama/qwen3" }).success).toBe(false)
    expect(parseCustomRouterCandidateModel("client:ollama/qwen3")).toEqual({
      kind: "client",
      provider: "ollama",
      model: "qwen3",
    })
    expect(parseCustomRouterCandidateModel("anthropic/claude-sonnet-4")).toEqual({
      kind: "gateway",
      model: "anthropic/claude-sonnet-4",
    })
  })
})

describe("client entry construction", () => {
  test("describes capabilities, pricing, and variants from the resolved model", () => {
    const priced = model("ollama", "qwen3", { variants: { low: {}, high: {} }, price: 3 })
    expect(clientEntry(priced)).toEqual({
      kind: "client",
      provider: "ollama",
      model: "qwen3",
      variants: ["low", "high"],
      capabilities: {
        contextLength: 128_000,
        inputModalities: ["text", "image"],
        toolCall: true,
        reasoning: true,
      },
      pricing: { inputPerMTokUsd: 3, outputPerMTokUsd: 3 },
    })

    expect(clientEntry(model("lmstudio", "local")).pricing).toBeNull()
    expect(clientEntry(model("lmstudio", "local")).variants).toEqual([])
  })

  test("includes the confirmed platform measurement without changing the client model", () => {
    const entry = clientEntry(model("ollama", "qwen3", { variants: { low: {}, high: {} } }), "qwen/qwen3")
    expect(entry).toMatchObject({
      kind: "client",
      provider: "ollama",
      model: "qwen3",
      measuredAs: "qwen/qwen3",
      variants: ["low", "high"],
    })
    expect(ClientCustomRouterEntrySchema.parse(entry)).toEqual(entry)
  })
})

describe("openai message conversion", () => {
  test("maps system, user, assistant tool calls, and tool results", () => {
    const messages = [
      { role: "system", content: "be brief" },
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", image: new URL("https://example.com/a.png") },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "working" },
          { type: "tool-call", toolCallId: "call_1", toolName: "read", input: { path: "a.ts" } },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call_1", toolName: "read", output: { type: "text", value: "ok" } },
        ],
      },
    ] as unknown as ModelMessage[]
    expect(openaiMessages(messages)).toEqual([
      { role: "system", content: "be brief" },
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "https://example.com/a.png" } },
        ],
      },
      {
        role: "assistant",
        content: "working",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "a.ts" }) } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "ok" },
    ])
  })

  test("converts session file attachments the way the gateway provider does", () => {
    // Session messages carry attachments as `file` parts whose data is the part URL.
    const messages = [
      {
        role: "user",
        content: [
          { type: "file", mediaType: "image/png", filename: "a.png", data: "data:image/png;base64,iVBO" },
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "spec.pdf",
            data: "data:application/pdf;base64,JVBE",
          },
          { type: "file", mediaType: "text/plain", filename: "notes.txt", data: new Uint8Array([104, 105]) },
          { type: "file", mediaType: "image/jpeg", data: new URL("https://example.com/b.jpg") },
          { type: "file", mediaType: "audio/mpeg", data: "data:audio/mpeg;base64,SUQz" },
          { type: "file", mediaType: "audio/x-wav", data: "UklG" },
          { type: "file", mediaType: "audio/basic", data: "AAAA" },
          { type: "file", mediaType: "audio/constructor", data: "AAAA" },
        ],
      },
    ] as unknown as ModelMessage[]
    expect(openaiMessages(messages)).toEqual([
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBO" } },
          { type: "file", file: { filename: "spec.pdf", file_data: "data:application/pdf;base64,JVBE" } },
          { type: "file", file: { filename: "notes.txt", file_data: "data:text/plain;base64,aGk=" } },
          { type: "image_url", image_url: { url: "https://example.com/b.jpg" } },
          { type: "input_audio", input_audio: { data: "SUQz", format: "mp3" } },
          { type: "input_audio", input_audio: { data: "UklG", format: "wav" } },
        ],
      },
    ])
  })

  test("drops unsupported parts and keeps an empty content string", () => {
    expect(
      openaiMessages([{ role: "user", content: [{ type: "reasoning", text: "x" }] } as unknown as ModelMessage]),
    ).toEqual([{ role: "user", content: "" }])
  })

  test("serializes tool schemas", async () => {
    const tools: Record<string, Tool> = {
      read: {
        description: "read a file",
        inputSchema: jsonSchema({ type: "object", properties: { path: { type: "string" } } }),
      },
    }
    const converted = (await openaiTools(tools)) as Array<{
      type: string
      function: { name: string; parameters: unknown }
    }>
    expect(converted[0]!.type).toBe("function")
    expect(converted[0]!.function.name).toBe("read")
    expect(converted[0]!.function.parameters).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
    })
  })
})

describe("routed model metadata", () => {
  test("stamps the client provider and keeps a provider-reported model id", () => {
    const meta = KiloRoutedModel.write(undefined, "qwen3:8b")
    const stamped = KiloRoutedModel.writeRoute(meta, { providerID: "ollama", modelID: "qwen3" })
    expect(KiloRoutedModel.read(stamped, KILO)).toEqual({
      providerID: ProviderV2.ID.make("ollama"),
      modelID: ModelV2.ID.make("qwen3:8b"),
    })
  })

  test("falls back to the routed model id when the provider reports none", () => {
    const stamped = KiloRoutedModel.writeRoute(undefined, { providerID: "lmstudio", modelID: "qwen3-4b" })
    expect(KiloRoutedModel.read(stamped, KILO)).toEqual({
      providerID: ProviderV2.ID.make("lmstudio"),
      modelID: ModelV2.ID.make("qwen3-4b"),
    })
  })

  test("stamps step-finish events and leaves other events alone", () => {
    const route = { providerID: "ollama", modelID: "qwen3" }
    const stamped = KiloRoutedModel.stamp(LLMEvent.stepFinish({ index: 0, reason: "stop" }), route)
    const body = JSON.stringify(stamped)
    expect(body).toContain('"routedProviderID":"ollama"')
    expect(body).toContain('"routedModelID":"qwen3"')

    const untouched = LLMEvent.textDelta({ id: "text-0", text: "hi" })
    expect(KiloRoutedModel.stamp(untouched, route)).toBe(untouched)
  })
})

describe("linkChoice", () => {
  const base = { yes: false, interactive: true, suggestion: "anthropic/claude-opus-5.5" }

  test("an explicit link wins over the suggestion and needs no answer", () => {
    expect(linkChoice({ ...base, interactive: false, measuredAs: "vendor/other" })).toEqual({
      kind: "link",
      measuredAs: "vendor/other",
    })
  })

  test("--yes accepts the suggestion without asking", () => {
    expect(linkChoice({ ...base, yes: true, interactive: false })).toEqual({
      kind: "link",
      measuredAs: "anthropic/claude-opus-5.5",
    })
  })

  test("asks on an interactive terminal", () => {
    expect(linkChoice(base)).toEqual({ kind: "ask", suggestion: "anthropic/claude-opus-5.5" })
  })

  test("registers without a link when no one can answer", () => {
    expect(linkChoice({ ...base, interactive: false })).toEqual({ kind: "skip" })
  })

  test("registers without a link when nothing matches", () => {
    expect(linkChoice({ ...base, yes: true, suggestion: null })).toEqual({ kind: "skip" })
  })
})
