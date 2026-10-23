import { describe, expect, test } from "bun:test"
import { Media, Message } from "@opencode/ai"
import { KiloCustomRouter } from "@kilocode/gateway-core"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { Effect } from "effect"
import { GatewayRouters } from "../src/gateway/routers"

// Port of the message, routed model, and eval config assertions of v1 auto-custom-router.test.ts and
// auto-eval.test.ts (#15183, #15245) for the v2 request and catalog shapes.
function model(providerID: string, id: string, extra: Partial<Model.Info> = {}): Model.Info {
  return {
    ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)),
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    limit: { context: 128_000, output: 4_096 },
    ...extra,
  }
}

const ROUTER = model("kilo", "kilo-auto/custom/myrouter", { headers: { "X-Title": "Kilo Code" } })
const SONNET = model("kilo", "anthropic/claude-sonnet-4", { variants: [{ id: Model.VariantID.make("high") }] })
const QWEN = model("ollama", "qwen3", {
  modelID: Model.ID.make("qwen3:8b"),
  package: "@opencode/ai/providers/openai-compatible",
  variants: [
    { id: Model.VariantID.make("low") },
    { id: Model.VariantID.make("high"), settings: { reasoningEffort: "high" } },
  ],
  cost: [
    {
      input: Money.USDPerMillionTokens.make(1),
      output: Money.USDPerMillionTokens.make(2),
      cache: { read: Money.USDPerMillionTokens.make(0), write: Money.USDPerMillionTokens.make(0) },
    },
  ],
  headers: { "X-Route": "eu", Authorization: "Bearer sk-secret-value", "x-api-key": "k" },
})
const CATALOG = [ROUTER, SONNET, QWEN]

describe("openai message conversion", () => {
  test("maps system, user, assistant tool calls, and tool results", () => {
    const messages = [
      Message.user([
        { type: "text", text: "look" },
        Message.media(Media.from({ type: "url", url: "https://example.com/a.png", mediaType: "image/png" })),
      ]),
      Message.assistant([
        { type: "reasoning", text: "hidden" },
        { type: "text", text: "working" },
        { type: "tool-call", id: "call_1", name: "read", input: { path: "a.ts" } },
      ]),
      Message.tool({ id: "call_1", name: "read", result: "ok", resultType: "text" }),
      Message.tool({ id: "call_2", name: "glob", result: { files: 1 } }),
    ]
    expect(GatewayRouters.openaiMessages(messages)).toEqual([
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
      { role: "tool", tool_call_id: "call_2", content: JSON.stringify({ files: 1 }) },
    ])
  })

  test("converts file attachments the way the gateway provider does, with mapped audio formats", () => {
    const media = (source: Media.Source, filename?: string) =>
      Message.media(Media.from(source), filename ? { filename } : undefined)
    const messages = [
      Message.user([
        media({ type: "base64", data: "iVBO", mediaType: "image/png" }, "a.png"),
        media({ type: "base64", data: "JVBE", mediaType: "application/pdf" }, "spec.pdf"),
        media({ type: "bytes", data: new Uint8Array([104, 105]), mediaType: "text/plain" }, "notes.txt"),
        media({ type: "url", url: "https://example.com/b.jpg", mediaType: "image/jpeg" }),
        media({ type: "base64", data: "AAAA", mediaType: "video/mp4" }),
        media({ type: "base64", data: "SUQz", mediaType: "audio/mpeg" }),
        media({ type: "base64", data: "UklG", mediaType: "audio/x-wav" }),
        media({ type: "base64", data: "AAAA", mediaType: "audio/basic" }),
        media({ type: "base64", data: "AAAA", mediaType: "audio/constructor" }),
        media({ type: "base64", data: "AAAA", mediaType: "audio/__proto__" }),
        media({ type: "ref", provider: "openai" as never, id: "file-1", mediaType: "application/pdf" }),
      ]),
    ]
    expect(GatewayRouters.openaiMessages(messages)).toEqual([
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBO" } },
          { type: "file", file: { filename: "spec.pdf", file_data: "data:application/pdf;base64,JVBE" } },
          { type: "file", file: { filename: "notes.txt", file_data: "data:text/plain;base64,aGk=" } },
          { type: "image_url", image_url: { url: "https://example.com/b.jpg" } },
          { type: "video_url", video_url: { url: "data:video/mp4;base64,AAAA" } },
          { type: "input_audio", input_audio: { data: "SUQz", format: "mp3" } },
          { type: "input_audio", input_audio: { data: "UklG", format: "wav" } },
        ],
      },
    ])
  })

  test("drops unsupported parts and keeps an empty content string", () => {
    expect(GatewayRouters.openaiMessages([Message.user([{ type: "reasoning", text: "x" }])])).toEqual([
      { role: "user", content: "" },
    ])
  })

  test("serializes tool schemas", () => {
    const parameters = { type: "object", properties: { path: { type: "string" } } }
    expect(GatewayRouters.openaiTools({ read: { description: "read a file", input: parameters } })).toEqual([
      { type: "function", function: { name: "read", description: "read a file", parameters } },
    ])
  })
})

describe("routed model", () => {
  test("resolves a client pick from the local catalog with a known variant", () => {
    const routed = GatewayRouters.target(
      { kind: "client", provider: "ollama", model: "qwen3", variant: "high" },
      ROUTER,
      CATALOG,
    )
    expect(routed?.model.providerID).toBe(Provider.ID.make("ollama"))
    expect(routed?.model.id).toBe(Model.ID.make("qwen3"))
    expect(routed?.variant).toBe(Model.VariantID.make("high"))
    const unknownVariant = GatewayRouters.target(
      { kind: "client", provider: "ollama", model: "qwen3", variant: "max" },
      ROUTER,
      CATALOG,
    )
    expect(unknownVariant?.variant).toBeUndefined()
  })

  test("routes a client pick even when the router itself is not in the catalog", () => {
    const routed = GatewayRouters.target(
      { kind: "client", provider: "ollama", model: "qwen3", variant: null },
      undefined,
      CATALOG,
    )
    expect(routed?.model.id).toBe(Model.ID.make("qwen3"))
    expect(routed?.variant).toBeUndefined()
  })

  test("returns undefined for a client pick that vanished from the catalog", () => {
    expect(
      GatewayRouters.target({ kind: "client", provider: "lmstudio", model: "qwen3", variant: null }, ROUTER, CATALOG),
    ).toBeUndefined()
  })

  test("keeps the router request shape for a gateway model the catalog omits", () => {
    const known = GatewayRouters.target(
      { kind: "gateway", model: "anthropic/claude-sonnet-4", variant: "high", decisionId: "d" },
      ROUTER,
      CATALOG,
    )
    expect(known?.model.id).toBe(Model.ID.make("anthropic/claude-sonnet-4"))
    expect(known?.variant).toBe(Model.VariantID.make("high"))
    const unknown = GatewayRouters.target(
      { kind: "gateway", model: "vendor/private-model", variant: null, decisionId: "d" },
      ROUTER,
      CATALOG,
    )
    expect(unknown?.model.id).toBe(Model.ID.make("vendor/private-model"))
    expect(unknown?.model.modelID).toBe(Model.ID.make("vendor/private-model"))
    expect(unknown?.model.providerID).toBe(Provider.ID.make("kilo"))
    // v1 kept the router model's request shape, including its variants.
    expect(unknown?.model.variants).toEqual(ROUTER.variants)
  })

  test("carries the signed decision to the gateway and leaves the catalog model untouched", () => {
    const routed = GatewayRouters.target(
      { kind: "gateway", model: "anthropic/claude-sonnet-4", variant: null, decisionId: "signed-token" },
      ROUTER,
      CATALOG,
    )
    expect(routed?.model.headers?.[KiloCustomRouter.DECISION_HEADER]).toBe("signed-token")
    expect(ROUTER.headers?.[KiloCustomRouter.DECISION_HEADER]).toBeUndefined()
    expect(SONNET.headers).toBeUndefined()
  })
})

describe("routed client model stamp", () => {
  test("a concurrent title request keeps the client route of the primary step", async () => {
    const routes = new Map([["ses_1:primary", { provider: "local", model: "echo" }]])
    const base = { sessionID: "ses_1", agent: "code", system: [], messages: [], tools: {} } as unknown as Parameters<
      typeof GatewayRouters.route
    >[0]
    await Effect.runPromise(
      GatewayRouters.route(
        {
          ...base,
          kind: "title",
          model: { providerID: Provider.ID.make("kilo"), id: Model.ID.make("kilo-auto/small") },
        },
        { account: undefined, routes, models: Effect.succeed([]), machineID: Effect.succeed(undefined) },
      ),
    )
    const chunk = { id: "x", model: "echo", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }
    const event = {
      sessionID: "ses_1",
      kind: "primary",
      model: { providerID: Provider.ID.make("local"), id: Model.ID.make("echo") },
      response: new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      }),
    } as unknown as Parameters<typeof GatewayRouters.stamp>[0]
    GatewayRouters.stamp(event, routes)
    expect(await event.response.text()).toContain('"routedModelID":"echo"')

    const silent = {
      ...event,
      response: new Response(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1 } })}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      }),
    } as typeof event
    GatewayRouters.stamp(silent, routes)
    // A provider that reports no model records the routed model, as v1 did.
    expect(await silent.response.text()).toContain('"routedModelID":"echo"')

    // Only the kilo provider has custom routers: the same ID elsewhere is not routed and needs no account.
    const foreign = {
      ...base,
      kind: "primary",
      model: { providerID: Provider.ID.make("openrouter"), id: Model.ID.make("kilo-auto/custom/myrouter") },
    } as Parameters<typeof GatewayRouters.route>[0]
    await Effect.runPromise(
      GatewayRouters.route(foreign, {
        account: undefined,
        routes,
        models: Effect.succeed([]),
        machineID: Effect.succeed(undefined),
      }),
    )
    expect(foreign.target).toBeUndefined()

    const other = { ...event, kind: "title", response: new Response("data: {}\n\n") } as typeof event
    const original = other.response
    GatewayRouters.stamp(other, routes)
    expect(other.response).toBe(original)
  })
})

describe("routed client model stamp framing", () => {
  const routes = new Map([["ses_1:primary", { provider: "local", model: "echo" }]])
  const event = (body: ReadableStream<Uint8Array> | string, headers: Record<string, string> = {}) =>
    ({
      sessionID: "ses_1",
      kind: "primary",
      model: { providerID: Provider.ID.make("local"), id: Model.ID.make("echo") },
      response: new Response(body, { headers: { "content-type": "text/event-stream", ...headers } }),
    }) as unknown as Parameters<typeof GatewayRouters.stamp>[0]

  test("keeps SSE events intact when a data line spans chunks", async () => {
    const data = `data: ${JSON.stringify({ model: "echo", choices: [], usage: { prompt_tokens: 1 } })}`
    const parts = ["event: message\r\n", data.slice(0, 20), data.slice(20), "\r\n\r\n"]
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        parts.forEach((part) => controller.enqueue(new TextEncoder().encode(part)))
        controller.close()
      },
    })
    const stamped = event(body, { "content-length": "999", "content-encoding": "gzip" })
    GatewayRouters.stamp(stamped, routes)
    const text = await stamped.response.text()
    expect(text.startsWith('event: message\r\ndata: {"model":"echo"')).toBe(true)
    expect(text).toContain('"routedModelID":"echo"}}\r\n\r\n')
    expect(text.split("\n").filter((line) => line === "").length).toBe(1)
    expect(stamped.response.headers.get("content-length")).toBeNull()
    expect(stamped.response.headers.get("content-encoding")).toBeNull()
  })

  test("a direct request to the same provider clears the previous client route", async () => {
    const own = new Map(routes)
    const direct = {
      sessionID: "ses_1",
      agent: "code",
      kind: "primary",
      model: { providerID: Provider.ID.make("local"), id: Model.ID.make("echo") },
      system: [],
      messages: [],
      tools: {},
    } as unknown as Parameters<typeof GatewayRouters.route>[0]
    await Effect.runPromise(
      GatewayRouters.route(direct, {
        account: undefined,
        routes: own,
        models: Effect.succeed([]),
        machineID: Effect.succeed(undefined),
      }),
    )
    const response = event(`data: ${JSON.stringify({ model: "echo", usage: { prompt_tokens: 1 } })}\n\n`)
    const original = response.response
    GatewayRouters.stamp(response, own)
    expect(response.response).toBe(original)
  })
})

describe("client entry from the catalog", () => {
  test("describes capabilities, pricing, and variants from the resolved model", () => {
    expect(KiloCustomRouter.clientEntry(GatewayRouters.clientModel(QWEN))).toEqual({
      kind: "client",
      provider: "ollama",
      model: "qwen3",
      variants: ["low", "high"],
      capabilities: { contextLength: 128_000, inputModalities: ["text", "image"], toolCall: true, reasoning: true },
      pricing: { inputPerMTokUsd: 1, outputPerMTokUsd: 2 },
    })
    const local = KiloCustomRouter.clientEntry(GatewayRouters.clientModel(model("lmstudio", "local")))
    expect(local.pricing).toBeNull()
    expect(local.variants).toEqual([])
    expect(local.capabilities.reasoning).toBe(false)
  })
})

describe("eval container config", () => {
  const provider: Provider.Info = {
    id: Provider.ID.make("ollama"),
    name: "Ollama",
    activation: "enabled",
    package: "@opencode/ai/providers/openai-compatible",
    settings: { baseURL: "http://localhost:11434/v1", apiKey: "sk-secret-value", kilocodeToken: "kilo-token-value" },
  } as Provider.Info
  const config = () => GatewayRouters.providerConfig(provider, QWEN)

  test("rewrites loopback endpoints and keeps remote endpoints", () => {
    expect(KiloCustomRouter.hostUrl("http://localhost:11434/v1")).toBe("http://host.docker.internal:11434/v1")
    expect(KiloCustomRouter.hostUrl("http://127.0.0.1:1234/v1/")).toBe("http://host.docker.internal:1234/v1/")
    expect(KiloCustomRouter.hostUrl("http://0.0.0.0:8080/v1")).toBe("http://host.docker.internal:8080/v1")
    expect(KiloCustomRouter.hostUrl("http://[::1]:11434/v1")).toBe("http://host.docker.internal:11434/v1")
    expect(KiloCustomRouter.hostUrl("https://api.example.com/v1")).toBe("https://api.example.com/v1")
    expect(config().provider.ollama!.options.baseURL).toBe("http://host.docker.internal:11434/v1")
  })

  test("strips credentials and declares only the resolved model of that provider", () => {
    expect(JSON.stringify(config())).not.toContain("sk-secret-value")
    expect(JSON.stringify(config())).not.toContain("kilo-token-value")
    const entry = config().provider.ollama!.models.qwen3!
    expect(config().enabled_providers as unknown).toEqual(["ollama"])
    expect(config().provider.ollama!.npm).toBe("@ai-sdk/openai-compatible")
    expect(entry.id).toBe(Model.ID.make("qwen3:8b"))
    expect(entry.tool_call).toBe(true)
    expect(entry.modalities.input).toEqual(["text", "image"])
    expect(entry.limit).toEqual({ context: 128_000, output: 4_096 })
    expect(entry.cost as unknown).toEqual({ input: 1, output: 2, cache_read: 0, cache_write: 0 })
    expect(Object.keys(entry.variants ?? {})).toEqual(["low", "high"])
    expect(entry.headers).toEqual({ "X-Route": "eu" })
  })

  test("maps v2 packages to packages the published CLI can load", async () => {
    const npm = (pkg: string) =>
      GatewayRouters.providerConfig({ ...provider, package: pkg }, { ...QWEN, package: undefined }).provider.ollama!.npm
    expect(npm("aisdk:@ai-sdk/openai")).toBe("@ai-sdk/openai")
    expect(npm("@opencode/ai/providers/openai-compatible")).toBe("@ai-sdk/openai-compatible")
    expect(npm("@opencode/ai/providers/openrouter")).toBe("@openrouter/ai-sdk-provider")
    expect(npm("@opencode/ai/providers/google-vertex-chat")).toBe("@ai-sdk/google-vertex")
    expect(npm("@opencode/ai/providers/vercel-ai-gateway")).toBe("@ai-sdk/gateway")
    await expect(
      Effect.runPromise(
        GatewayRouters.evalConfig({
          entry: { kind: "client", provider: "ollama", model: "qwen3" },
          account: { server: "https://api.kilo.ai", token: "kilo-token", version: "1.0.0" },
          models: [{ ...QWEN, package: "@opencode/ai/providers/zai-coding-plan" }, ROUTER],
          provider: () => Effect.succeed(provider),
          credential: () => Effect.succeed(undefined),
        }),
      ),
    ).rejects.toThrow("Client evals do not support provider ollama")
  })

  test("reads the credential of the provider's integration", async () => {
    const seen: string[] = []
    await Effect.runPromise(
      GatewayRouters.evalConfig({
        entry: { kind: "client", provider: "ollama", model: "qwen3" },
        account: { server: "https://api.kilo.ai", token: "kilo-token", version: "1.0.0" },
        models: CATALOG,
        provider: () => Effect.succeed(provider),
        credential: (info) => Effect.sync(() => void seen.push(info.id)).pipe(Effect.as(undefined)),
      }),
    )
    expect(seen).toEqual(["ollama"])
  })

  test("sends the provider credential and the Kilo account only in auth", async () => {
    const result = await Effect.runPromise(
      GatewayRouters.evalConfig({
        entry: { kind: "client", provider: "ollama", model: "qwen3" },
        account: { server: "https://api.kilo.ai", token: "kilo-token", organizationID: "team", version: "1.0.0" },
        models: CATALOG,
        provider: () => Effect.succeed(provider),
        credential: () => Effect.succeed(undefined),
      }),
    )
    expect(result.auth as unknown).toEqual({
      ollama: { type: "api", key: "sk-secret-value" },
      kilo: { type: "api", key: "kilo-token", organizationId: "team" },
    })
    const gateway = await Effect.runPromise(
      GatewayRouters.evalConfig({
        entry: { kind: "gateway", model: "anthropic/claude-sonnet-4" },
        account: { server: "https://api.kilo.ai", token: "kilo-token", version: "1.0.0" },
        models: CATALOG,
        provider: () => Effect.succeed(undefined),
        credential: () => Effect.succeed(undefined),
      }),
    )
    expect(gateway).toMatchObject({
      provider: "kilo",
      model: "anthropic/claude-sonnet-4",
      config: { enabled_providers: ["kilo"] },
    })
    await expect(
      Effect.runPromise(
        GatewayRouters.evalConfig({
          entry: { kind: "client", provider: "lmstudio", model: "qwen3" },
          account: { server: "https://api.kilo.ai", token: "kilo-token", version: "1.0.0" },
          models: CATALOG,
          provider: () => Effect.succeed(undefined),
          credential: () => Effect.succeed(undefined),
        }),
      ),
    ).rejects.toThrow("is not configured locally")
  })
})
