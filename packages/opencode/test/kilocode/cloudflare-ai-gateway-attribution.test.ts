// Wire-level regression: the Cloudflare AI Gateway custom loader ignores the SDK
// built from provider.options and creates its own transports, so headers
// configured on the provider only reach the wire through the per-request
// headers. Runs the real Provider + LLM services and the real loader (no
// options.baseURL, which would bypass it); only Cloudflare's hosts are pointed
// at a local HTTP server.
import { afterAll, beforeAll, beforeEach, describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { Agent } from "@/agent/agent"
import { DEFAULT_HEADERS } from "@/kilocode/const"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([LLM.node, Provider.node])))

const PROVIDER = "cloudflare-ai-gateway"
const ENV = {
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  CLOUDFLARE_GATEWAY_ID: "test-gateway",
  CLOUDFLARE_API_TOKEN: "test-token",
}
const HOSTS = ["https://gateway.ai.cloudflare.com/", "https://api.cloudflare.com/"]

type Capture = { url: URL; headers: Headers; body: unknown }

const realFetch = globalThis.fetch
const savedEnv: Record<string, string | undefined> = {}
let server: ReturnType<typeof Bun.serve> | undefined
let captures: Capture[] = []

function chatStream() {
  const chunks = [
    { id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: { role: "assistant" } }] },
    { id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: { content: "ok" } }] },
    { id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: {}, finish_reason: "stop" }] },
  ]
  return [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`), "data: [DONE]"].join("\n\n") + "\n\n"
}

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV)) {
    savedEnv[key] = process.env[key]
    process.env[key] = value
  }
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      captures.push({ url: new URL(req.url), headers: req.headers, body: await req.json() })
      return new Response(chatStream(), { status: 200, headers: { "Content-Type": "text/event-stream" } })
    },
  })
  const origin = server.url.origin
  const handle = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const host = HOSTS.find((prefix) => url.startsWith(prefix))
    if (!host) return realFetch(input, init)
    return realFetch(`${origin}/${url.slice(host.length)}`, init)
  }
  globalThis.fetch = Object.assign(handle, { preconnect: realFetch.preconnect.bind(realFetch) })
})

beforeEach(() => {
  captures = []
})

afterAll(() => {
  globalThis.fetch = realFetch
  void server?.stop()
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

// The headers the upstream request carries: the unified/passthrough routes wrap
// it in the gateway envelope, the REST route sends it directly.
function upstreamHeaders(capture: Capture) {
  if (!Array.isArray(capture.body)) return capture.headers
  const step: unknown = capture.body[0]
  if (typeof step !== "object" || step === null || !("headers" in step)) return new Headers()
  return new Headers(Object.entries(step.headers ?? {}).map(([key, value]) => [key, String(value)]))
}

const run = (modelID: string) =>
  Effect.gen(function* () {
    const model = yield* Provider.use.getModel(ProviderV2.ID.make(PROVIDER), ModelV2.ID.make(modelID))
    const sessionID = SessionID.make("ses_cf_attribution")
    const agent = {
      name: "code",
      mode: "primary",
      options: {},
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    } satisfies Agent.Info
    const user = {
      id: MessageID.make("msg_cf_attribution"),
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: agent.name,
      model: { providerID: model.providerID, modelID: model.id },
    } satisfies SessionV1.User
    yield* LLM.Service.use((svc) =>
      svc
        .stream({
          user,
          sessionID,
          model,
          agent,
          system: ["You are a helpful assistant."],
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })
        .pipe(Stream.runDrain),
    )
    expect(captures).toHaveLength(1)
    return upstreamHeaders(captures[0])
  })

// workers-ai/* rides the gateway's unified route; any other third-party id the
// REST route built with createOpenAICompatible. Neither sees provider.options.
const UNIFIED = "workers-ai/@cf/meta/llama-3.1-8b-instruct"
const REST = "google/test-model"

const config = (headers?: Record<string, string>) => ({
  enabled_providers: [PROVIDER],
  provider: {
    [PROVIDER]: {
      options: headers ? { headers } : {},
      models: { [REST]: { name: "Test model", tool_call: true } },
    },
  },
})

describe("Cloudflare AI Gateway attribution headers on the wire", () => {
  for (const modelID of [UNIFIED, REST]) {
    it.instance(
      `sends configured HTTP-Referer / X-Title through ${modelID}`,
      () =>
        Effect.gen(function* () {
          const headers = yield* run(modelID)
          expect(headers.get("HTTP-Referer")).toBe("https://example.com/")
          expect(headers.get("X-Title")).toBe("Example App")
        }),
      { config: () => config({ "http-referer": "https://example.com/", "X-Title": "Example App" }) },
    )

    it.instance(
      `sends Kilo's default attribution through ${modelID} when none is configured`,
      () =>
        Effect.gen(function* () {
          const headers = yield* run(modelID)
          expect(headers.get("HTTP-Referer")).toBe(DEFAULT_HEADERS["HTTP-Referer"])
          expect(headers.get("X-Title")).toBe(DEFAULT_HEADERS["X-Title"])
        }),
      { config: () => config() },
    )
  }
})
