// kilocode_change - new file: integration coverage for the 128-tool ceiling on
// the custom auto router path. Unlike the component test in
// auto-custom-router.test.ts, this drives the real LLM.stream -> LLM.route ->
// KiloCustomRouter.resolve -> /v1/decide chain, so deleting the cap wiring in
// src/session/llm.ts makes the test fail.
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn } from "bun:test"
import { tool, type Tool } from "ai"
import { Effect, Stream } from "effect"
import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { testEffect } from "../../lib/effect"
import type { Agent } from "@/agent/agent"
import { SessionID, MessageID } from "@/session/schema"
import { KiloToolLimit } from "@/kilocode/session/tool-limit"
import { ClientCustomRouterEntrySchema, type FetchLike } from "@kilocode/kilo-gateway"
import z from "zod"

const ROUTER_MODEL_ID = "kilo-auto/custom/myrouter"
const CLIENT_PROVIDER = "alibaba"
const CLIENT_MODEL = "qwen-plus"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([LLM.node, Provider.node])))
const drain = (input: LLM.StreamInput) => LLM.Service.use((svc) => svc.stream(input).pipe(Stream.runDrain))

type ConfigModel = NonNullable<NonNullable<NonNullable<ConfigV1.Info["provider"]>[string]>["models"]>[string]

const fixtureText = await Bun.file(
  path.join(import.meta.dir, "../../tool/fixtures/models-api.json"),
).text()
const MODELS_FIXTURE: Record<string, ModelsDev.Provider> = JSON.parse(fixtureText)

const CLIENT_CONFIG_MODEL: ConfigModel = JSON.parse(
  JSON.stringify(MODELS_FIXTURE[CLIENT_PROVIDER].models[CLIENT_MODEL]),
)

function makeManyTools(total: number): Record<string, Tool> {
  const tools: Record<string, Tool> = {}
  for (let i = 0; i < total - 1; i++) {
    const name = `mcp_srv_tool_${String(i).padStart(3, "0")}`
    tools[name] = tool({ description: name, inputSchema: z.object({}), execute: async () => ({ output: "" }) })
  }
  tools[KiloToolLimit.STRUCTURED_OUTPUT_TOOL] = tool({
    description: "structured output",
    inputSchema: z.object({}),
    execute: async () => ({ output: "" }),
  })
  return tools
}

function chatStream(text: string) {
  const payload =
    [
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: { role: "assistant" } }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: { content: text } }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
    ].join("\n\n") + "\n\n"
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.close()
    },
  })
}

const serverState = {
  server: null as ReturnType<typeof Bun.serve> | null,
  chatRequests: [] as Array<{ url: URL; body: Record<string, unknown> }>,
}

let decideCapture: { tools?: Array<{ function?: { name?: string } }> } | undefined
let fetchSpy: { mockRestore(): void } | undefined

function routerList() {
  return {
    routers: [
      {
        id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
        scope: "user",
        slug: "myrouter",
        name: "My Router",
        modelId: ROUTER_MODEL_ID,
        baseRouter: "efficient",
        mode: "cost_per_accuracy",
        defaultEntryKey: `client:${CLIENT_PROVIDER}/${CLIENT_MODEL}`,
        canEdit: true,
        entries: [
          {
            key: `client:${CLIENT_PROVIDER}/${CLIENT_MODEL}`,
            entry: ClientCustomRouterEntrySchema.parse({
              kind: "client",
              provider: CLIENT_PROVIDER,
              model: CLIENT_MODEL,
              variants: [],
              capabilities: { contextLength: 128_000, inputModalities: ["text"], toolCall: true, reasoning: false },
              pricing: null,
            }),
            needsClientEval: true,
            variants: [{ variant: null, status: "missing", failureReason: null }],
          },
        ],
      },
    ],
  }
}

function decideResponse() {
  return {
    decision: {
      entry: { kind: "client", provider: CLIENT_PROVIDER, model: CLIENT_MODEL },
      model: `client:${CLIENT_PROVIDER}/${CLIENT_MODEL}`,
      variant: null,
      stale: false,
      fallback: false,
      sticky: false,
      taskType: null,
      subtaskType: null,
      tableVersion: null,
    },
    decisionId: "decision-integration-cap",
  }
}

beforeAll(() => {
  serverState.server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname.endsWith("/chat/completions")) {
        serverState.chatRequests.push({ url, body: await req.json() })
        return new Response(chatStream("Hello"), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      return new Response("not found", { status: 404 })
    },
  })

  const originalFetch = globalThis.fetch.bind(globalThis)
  const routerFetch: FetchLike = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const path = new URL(url).pathname
    const headers = { "content-type": "application/json" }
    if (path.endsWith("/api/auto-routing/custom-routers")) {
      return new Response(JSON.stringify(routerList()), { headers })
    }
    if (path.endsWith("/v1/decide")) {
      decideCapture = JSON.parse(typeof init?.body === "string" ? init.body : "{}")
      return new Response(JSON.stringify(decideResponse()), { headers })
    }
    return originalFetch(input, init)
  }
  // Bun's fetch carries a static `preconnect` member, so the mock needs the
  // same shape to satisfy mockImplementation's typeof fetch parameter.
  const fetchMock = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => routerFetch(input, init),
    { preconnect: () => undefined },
  )
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchMock)
})

afterAll(() => {
  fetchSpy?.mockRestore()
  void serverState.server?.stop(true)
})

// Keep module-level capture state isolated if more cases are added later.
beforeEach(() => {
  decideCapture = undefined
  serverState.chatRequests.length = 0
})

describe("LLM.stream custom router tool ceiling", () => {
  it.instance(
    "caps the real /v1/decide request at 128 tools through the LLM.route wiring",
    () =>
      Effect.gen(function* () {
        const resolved = yield* Provider.use.getModel(
          ProviderV2.ID.make("kilo"),
          ModelV2.ID.make(ROUTER_MODEL_ID),
        )
        const sessionID = SessionID.make("session-test-router-tool-limit")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        yield* drain({
          user: {
            id: MessageID.make("msg_user-router-tool-limit"),
            sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: agent.name,
            model: { providerID: ProviderV2.ID.make("kilo"), modelID: resolved.id },
          } satisfies SessionV1.User,
          sessionID,
          model: resolved,
          agent,
          system: ["You are a helpful assistant."],
          messages: [{ role: "user", content: "Hello" }],
          tools: makeManyTools(130),
        })

        // The routing worker saw the capped tool record via the production LLM.route path.
        expect(decideCapture).toBeDefined()
        const outbound = decideCapture!.tools!
        expect(outbound).toHaveLength(KiloToolLimit.MAX_TOOLS)
        const names = outbound.map((item) => item.function?.name)
        expect(names).toContain(KiloToolLimit.STRUCTURED_OUTPUT_TOOL)
        expect(names).toContain("mcp_srv_tool_000")
        // StructuredOutput is protected and sorts first; the two alphabetically
        // last MCP tools (127, 128) are the deterministic over-budget drops.
        expect(names).not.toContain("mcp_srv_tool_127")
        expect(names).not.toContain("mcp_srv_tool_128")

        // The routed client provider then served the actual chat request.
        expect(serverState.chatRequests).toHaveLength(1)
        const chatBody: { tools?: Array<{ function?: { name?: string } }> } = serverState.chatRequests[0].body
        expect(chatBody.tools).toHaveLength(KiloToolLimit.MAX_TOOLS)
        // The run()-side hard guard applies the same protected/deterministic rules.
        const chatNames = chatBody.tools?.map((item) => item.function?.name) ?? []
        expect(chatNames).toContain(KiloToolLimit.STRUCTURED_OUTPUT_TOOL)
        expect(chatNames).not.toContain("mcp_srv_tool_127")
        expect(chatNames).not.toContain("mcp_srv_tool_128")
      }),
    {
      config: () => ({
        enabled_providers: ["kilo", CLIENT_PROVIDER],
        provider: {
          kilo: {
            options: { apiKey: "test-kilo-key" },
            models: {
              [ROUTER_MODEL_ID]: { release_date: "2026-01-01" },
            },
          },
          [CLIENT_PROVIDER]: {
            options: { apiKey: "test-key", baseURL: `${serverState.server!.url.origin}/v1` },
            models: { [CLIENT_MODEL]: CLIENT_CONFIG_MODEL },
          },
        },
      }),
    },
  )
})
