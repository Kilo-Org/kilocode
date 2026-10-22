import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

const auto = { providerID: "kilo", id: "kilo-auto/frontier", variant: "default" }
const steps = [
  {
    route: "anthropic/route-tool",
    cost: 0.125,
    usage: { cost: 0.9, cost_details: { upstream_inference_cost: "0.125" } },
    gateway: { marketCost: 0.75 },
    tool: true,
  },
  { route: "openai/route-answer", cost: 0.25, gateway: { marketCost: "0.25", cost: 99, gatewayCost: 88 } },
  { route: "google/route-free", cost: 0, gateway: { marketCost: 0, cost: 99 } },
  {
    route: "deepseek/route-byok",
    cost: 0,
    usage: { cost: 0.7, cost_details: { upstream_inference_cost: 0 } },
    gateway: { marketCost: 0.6 },
  },
  { route: "mistral/route-fallback", cost: 0.0116 },
]
const title = { route: "openai/route-title", cost: 0.375, usage: { cost: "0.375" }, text: "Gateway usage fixture" }
const compaction = {
  route: "anthropic/route-summary",
  cost: 0.0625,
  usage: { cost: 5, cost_details: { upstream_inference_cost: "0.0625" } },
  text: "## Objective\nVerify Gateway usage.\n\n## Next Move\n1. Continue testing.",
}

// Only the HTTP peer is controlled. The host, plugin interceptors, protocol parser, Session execution,
// projections, and statistics use their real implementations, including after the file database is reopened.
test("settles Gateway usage per routed step without changing Auto, and retains it after a server restart", async () => {
  using backend = gateway()
  await isolated(backend.url, async (directory) => {
    await Bun.write(path.join(directory, "fixture.txt"), "Known tool result\n")
    const database = path.join(directory, "session.sqlite")
    const saved = await server(directory, database, async (client) => {
      const session = await client.session.create({ title: "Usage integration", location: { directory }, model: auto })
      for (const text of [
        "Read fixture.txt, then answer.",
        "Use a free route.",
        "Use a BYOK route.",
        "Use token pricing.",
      ]) {
        await client.session.prompt({ sessionID: session.id, text })
        await client.session.wait({ sessionID: session.id })
      }
      const messages = await client.session.context({ sessionID: session.id })
      const assistants = messages.filter((message) => message.type === "assistant")
      expect(assistants).toHaveLength(steps.length)
      expect(messages.filter((message) => message.type === "user")).toHaveLength(4)
      assistants.forEach((message, index) => {
        expect(message.error).toBeUndefined()
        expect(message.model).toEqual(auto)
        expect(message.cost).toBeCloseTo(steps[index]!.cost, 10)
        expect(message.native).toMatchObject({
          kilo: { routedModelID: steps[index]!.route, vercelID: `fixture-${index}` },
        })
        expect(message.native?.kilo).not.toHaveProperty("gateway")
        expect(message.tokens).toEqual({
          input: 1000,
          output: 60,
          reasoning: 20,
          cache: { read: 0, write: 0 },
        })
      })
      expect(assistants[0]!.content).toContainEqual(
        expect.objectContaining({ type: "reasoning", text: "Inspect the fixture." }),
      )
      expect(assistants[0]!.content).toContainEqual(
        expect.objectContaining({
          type: "tool",
          name: "read",
          state: expect.objectContaining({ status: "completed" }),
        }),
      )
      expect(assistants[1]!.content).toContainEqual({ type: "text", text: "Answer 1" })
      expect(backend.requests).toHaveLength(steps.length)
      expect(
        backend.requests.every((request) => request.model === auto.id && request.sessionID === session.id),
      ).toBeTrue()
      expect(backend.requests[1]!.messages).toContainEqual(
        expect.objectContaining({ role: "tool", content: expect.stringContaining("Known tool result") }),
      )
      await verifySession(
        client,
        session.id,
        steps.reduce((sum, step) => sum + step.cost, 0),
      )

      // Regenerating a title is a real auxiliary call, not another assistant step.
      await client.session.update({ sessionID: session.id, title: "" })
      expect((await client.session.get({ sessionID: session.id })).title).toBe(title.text)
      await verifySession(
        client,
        session.id,
        steps.reduce((sum, step) => sum + step.cost, title.cost),
      )
      await client.session.compact({ sessionID: session.id })
      await client.session.wait({ sessionID: session.id })
      const exported = await client.session.export({ sessionID: session.id })
      expect(exported.messages.filter((message) => message.type === "assistant")).toEqual(assistants)
      expect(exported.messages).toContainEqual(
        expect.objectContaining({ type: "compaction", status: "completed", cost: compaction.cost }),
      )
      expect(backend.requests).toHaveLength(steps.length + 2)
      await verifySession(
        client,
        session.id,
        steps.reduce((sum, step) => sum + step.cost, title.cost + compaction.cost),
      )
      return { sessionID: session.id, messages: exported.messages }
    })

    // Closing the first graph disposes its database, execution state, and plugin metadata cache.
    await server(directory, database, async (client) => {
      const sessionID = saved.sessionID
      await verifySession(
        client,
        sessionID,
        steps.reduce((sum, step) => sum + step.cost, title.cost + compaction.cost),
      )
      const exported = await client.session.export({ sessionID })
      expect(exported.messages).toEqual(saved.messages)
      expect(backend.requests).toHaveLength(steps.length + 2)
      const session = await client.session.get({ sessionID })
      const stats = await client.session.stats({ project: session.projectID })
      expect(stats.steps).toBe(steps.length)
      expect(stats.models).toHaveLength(steps.length)
      for (const step of steps) {
        expect(stats.models).toContainEqual(
          expect.objectContaining({
            model: expect.objectContaining({ providerID: "kilo", id: step.route }),
            steps: 1,
            cost: expect.closeTo(step.cost, 10),
          }),
        )
      }
      expect(stats.models.some((model) => model.model.id === auto.id)).toBeFalse()
    })
  })
}, 60_000)

test.each(["anthropic", "openai"] as const)(
  "settles native %s Gateway responses and counts child usage exactly once",
  async (dialect) => {
    const replies = [
      { route: `${dialect}/market`, cost: 0.1875, gateway: { marketCost: "0.1875" } },
      {
        route: `${dialect}/upstream`,
        cost: 0.0625,
        usage: { cost: 9, cost_details: { upstream_inference_cost: "0.0625" } },
        gateway: { marketCost: 5 },
      },
      { route: `${dialect}/child`, cost: 0.03125, gateway: { marketCost: "0.03125" } },
    ]
    using backend = gateway(dialect, replies)
    await isolated(backend.url, async (directory) => {
      await server(directory, ":memory:", async (client) => {
        const parent = await client.session.create({ title: "Native usage", location: { directory }, model: auto })
        for (const text of ["Use market pricing.", "Use upstream pricing."]) {
          await client.session.prompt({ sessionID: parent.id, text })
          await client.session.wait({ sessionID: parent.id })
        }
        await verifySession(client, parent.id, 0.25)
        const child = await client.session.create({ parentID: parent.id, title: "Child usage", model: auto })
        await client.session.prompt({ sessionID: child.id, text: "One child step." })
        await client.session.wait({ sessionID: child.id })
        expect((await client.session.get({ sessionID: child.id })).parentID).toBe(parent.id)
        await verifySession(client, parent.id, 0.25)
        await verifySession(client, child.id, 0.03125)
        const messages = [
          ...(await client.session.context({ sessionID: parent.id })),
          ...(await client.session.context({ sessionID: child.id })),
        ].filter((message) => message.type === "assistant")
        expect(messages).toHaveLength(replies.length)
        messages.forEach((message, index) => {
          expect(message.error).toBeUndefined()
          expect(message.model).toEqual(auto)
          expect(message.cost).toBeCloseTo(replies[index]!.cost, 10)
          expect(message.native?.kilo).toMatchObject({
            routedModelID: replies[index]!.route,
            vercelID: `fixture-${index}`,
            responseID: `native-${index}`,
            generationID: `generation-${index}`,
          })
          expect(message.content).toContainEqual(expect.objectContaining({ type: "text", text: `Answer ${index}` }))
          expect(message.tokens).toEqual({ input: 1000, output: 60, reasoning: 20, cache: { read: 0, write: 0 } })
        })
        expect(backend.requests.map((request) => request.sessionID)).toEqual([parent.id, parent.id, child.id])
        expect(backend.requests.every((request) => request.model === auto.id)).toBeTrue()
        expect(backend.requests.map((request) => request.pathname)).toEqual(
          replies.map(() => `/api/gateway/v1/${dialect === "anthropic" ? "messages" : "responses"}`),
        )
        const stats = await client.session.stats({ project: parent.projectID })
        expect(stats).toMatchObject({ sessions: 1, subagents: 1, prompts: 2, steps: 3 })
        expect(stats.cost).toBeCloseTo(0.28125, 10)
        expect(stats.models).toHaveLength(replies.length)
        replies.forEach((reply) => {
          expect(stats.models).toContainEqual(
            expect.objectContaining({
              model: expect.objectContaining({ providerID: "kilo", id: reply.route }),
              steps: 1,
              cost: reply.cost,
            }),
          )
        })
      })
    })
  },
  30_000,
)

async function isolated(url: string, body: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-gateway-usage-"))
  const variables = {
    KILO_API_URL: url,
    KILO_API_KEY: "fixture-token",
    KILOCODE_TOKEN: undefined,
    KILO_AUTH_CONTENT: undefined,
    KILO_ORG_ID: undefined,
    KILO_AI_GATEWAY_URL: undefined,
  }
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
  apply(variables)
  try {
    await body(directory)
  } finally {
    apply(previous)
    await rm(directory, { recursive: true, force: true })
  }
}

async function verifySession(client: ReturnType<typeof OpenCode.make>, sessionID: string, cost: number) {
  const session = await client.session.get({ sessionID })
  expect(session.model).toEqual(auto)
  expect(session.cost).toBeCloseTo(cost, 10)
}

function server<A>(
  directory: string,
  database: string,
  body: (client: ReturnType<typeof OpenCode.make>) => Promise<A>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          createRoutes(
            {
              password: "secret",
              database: { path: database },
              models: { fetch: false },
              fs: { filewatcher: false },
              config: { directory, project: false },
            },
            () => [],
            KiloHost.overrides,
          ).pipe(Layer.provide(HttpServer.layerServices)),
        )
        const handler = Context.get(context, HttpRouter.HttpRouter)
          .asHttpEffect()
          .pipe(HttpEffect.toWebHandlerWith(context))
        const client = OpenCode.make({
          baseUrl: "http://kilo.local",
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
          fetch: Object.assign(
            async (input: string | URL | Request, init?: RequestInit) =>
              handler(input instanceof Request ? input : new Request(input, init)),
            { preconnect: fetch.preconnect },
          ),
        })
        // Wait for the same catalog activation that a real client uses before submitting a prompt.
        const models = yield* Effect.promise(() =>
          client.rpc(KiloGatewayRpc.Definition).models({}, { location: { directory } }),
        )
        expect(models.map((model) => model.id)).toContain(auto.id)
        return yield* Effect.promise(() => body(client))
      }),
    ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
  )
}

function gateway(
  dialect: "openrouter" | "anthropic" | "openai" = "openrouter",
  responses: {
    route: string
    cost: number
    usage?: object
    gateway?: object
    tool?: boolean
    text?: string
  }[] = [...steps, title, compaction],
) {
  const requests: {
    model: string
    messages: { role: string; content: unknown }[]
    sessionID: string | null
    pathname: string
  }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      if (pathname === "/api/profile")
        return Response.json({ user: { email: "usage@example.test" }, organizations: [], hasPersonalAccount: true })
      if (pathname.endsWith("/models"))
        return Response.json({
          data: [
            {
              id: auto.id,
              name: "Kilo Auto Frontier",
              context_length: 200000,
              max_completion_tokens: 32000,
              supported_parameters: ["tools", "reasoning"],
              pricing: { prompt: "0.00001", completion: "0.00002" },
              isFree: false,
              opencode: { ai_sdk_provider: dialect },
            },
          ],
        })
      if (pathname === "/api/defaults") return Response.json({ defaultModel: auto.id })
      if (!/^\/api\/gateway\/v1\/(chat\/completions|messages|responses)$/.test(pathname))
        return new Response(null, { status: 404 })
      const index = requests.length
      const body = (await request.json()) as { model: string; messages: { role: string; content: unknown }[] }
      requests.push({ ...body, pathname, sessionID: request.headers.get("x-kilocode-taskid") })
      const response = responses[index]
      if (!response) return new Response("Unexpected model request", { status: 500 })
      const native = {
        id: `native-${index}`,
        model: "transport/alias",
        provider_metadata: {
          gateway: {
            routing: { canonicalSlug: response.route },
            generationId: `generation-${index}`,
            ...response.gateway,
          },
        },
      }
      const text = response.text ?? `Answer ${index}`
      const frames =
        dialect === "anthropic"
          ? [
              {
                type: "message_start",
                message: {
                  ...native,
                  type: "message",
                  role: "assistant",
                  content: [],
                  usage: { input_tokens: 1000, output_tokens: 0 },
                },
              },
              { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
              { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
              { type: "content_block_stop", index: 0 },
              {
                type: "message_delta",
                delta: { stop_reason: "end_turn" },
                usage: { output_tokens: 80, output_tokens_details: { thinking_tokens: 20 }, ...response.usage },
              },
              { type: "message_stop" },
            ]
          : dialect === "openai"
            ? [
                { type: "response.created", response: { ...native, status: "in_progress" } },
                {
                  type: "response.output_item.added",
                  output_index: 0,
                  item: { id: `text-${index}`, type: "message", role: "assistant", content: [] },
                },
                {
                  type: "response.output_text.delta",
                  item_id: `text-${index}`,
                  output_index: 0,
                  content_index: 0,
                  delta: text,
                },
                {
                  type: "response.output_item.done",
                  output_index: 0,
                  item: {
                    id: `text-${index}`,
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text, annotations: [] }],
                  },
                },
                {
                  type: "response.completed",
                  response: {
                    id: native.id,
                    model: native.model,
                    status: "completed",
                    output: [],
                    usage: {
                      input_tokens: 1000,
                      output_tokens: 80,
                      output_tokens_details: { reasoning_tokens: 20 },
                      total_tokens: 1080,
                      ...response.usage,
                    },
                  },
                },
              ]
            : undefined
      if (frames)
        return new Response(
          frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(""),
          {
            headers: { "content-type": "text/event-stream", "x-vercel-id": `fixture-${index}` },
          },
        )
      const chunks = [
        // Routing arrives before usage, and may differ from the transport's model field.
        {
          model: "transport/alias",
          provider_metadata: { gateway: { routing: { canonicalSlug: response.route }, ...response.gateway } },
          choices: [],
        },
        ...(response.tool
          ? [
              { choices: [{ delta: { reasoning: "Inspect the fixture." } }] },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "fixture-read",
                          type: "function",
                          function: {
                            name: "read",
                            arguments: JSON.stringify({ path: "fixture.txt" }),
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            ]
          : [{ choices: [{ delta: { content: response.text ?? `Answer ${index}` } }] }]),
        { choices: [{ delta: {}, finish_reason: response.tool ? "tool_calls" : "stop" }] },
        // The usage frame deliberately has no model or provider_metadata of its own.
        {
          choices: [],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 80,
            total_tokens: 1080,
            completion_tokens_details: { reasoning_tokens: 20 },
            ...response.usage,
          },
        },
      ]
      return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream", "x-vercel-id": `fixture-${index}` },
      })
    },
  })
  return { requests, url: server.url.origin, [Symbol.dispose]: () => server.stop(true) }
}

function apply(variables: Record<string, string | undefined>) {
  Object.entries(variables).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
}
