import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { OpenCode } from "@opencode/client"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { KiloSessionDrainRpc } from "@opencode/schema/kilocode/session-drain"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { KiloHost } from "../src/host"
import { loadPlugins } from "./lib/plugins"

type Env = {
  readonly client: ReturnType<typeof OpenCode.make>
  readonly location: { readonly directory: string }
  readonly llm: Context.Service.Shape<typeof TestLLM.Test>
  readonly run: <A>(effect: Effect.Effect<A>) => Promise<A>
}

// The session drain end to end: the contract in @opencode/schema, the handler in the session-drain plugin, the plugin
// registered by the host overrides, and the call through the generated client's `rpc` entry point. A scripted model
// stands in for the provider, and a local stand-in for the Kilo API answers the Gateway.
const boot = (body: (env: Env) => Promise<void>) => async () => {
  using backend = fixture()
  // The shared fixture resolves Windows paths and explicitly retries EBUSY after process teardown.
  await using temporary = await tmpdir("kilo-drain-")
  const directory = temporary.path
  await Bun.write(
    path.join(directory, "kilo2.json"),
    JSON.stringify({
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    }),
  )
  const variables = { ...signedOut, KILO_API_URL: backend.url }
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
  apply(variables)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const model = yield* Layer.build(TestLLM.testLayer())
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "secret",
                database: { path: ":memory:" },
                models: { fetch: false },
                fs: { filewatcher: false },
                config: { directory, project: false },
              },
              () => [],
              [
                ...KiloHost.overrides,
                LayerNodePlatform.llmClient.replace(Layer.succeedContext(model)),
                SessionRunnerModel.node.replace(
                  Layer.succeed(SessionRunnerModel.Service, {
                    resolve: () =>
                      Effect.succeed(
                        SessionRunnerModel.resolved(
                          LanguageModel.make({ id: "drain", provider: "test", route: OpenAIChat.route }),
                          {
                            capabilities: { tools: true, input: ["text"], output: ["text"] },
                            cost: [],
                            limit: { context: 200_000, output: 32_000 },
                          },
                        ),
                      ),
                  }),
                ),
              ],
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
          // The server no longer waits for a Location's plugins in rpc.call, so a one-shot caller waits itself.
          yield* loadPlugins(context, directory)
          const run = Effect.runPromiseWith(yield* Effect.context<never>())
          yield* Effect.promise(() =>
            body({ client, location: { directory }, llm: Context.get(model, TestLLM.Test), run }),
          )
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    apply(previous)
  }
}

const signedOut = {
  KILO_API_KEY: undefined,
  KILOCODE_TOKEN: undefined,
  KILO_AUTH_CONTENT: undefined,
  KILO_ORG_ID: undefined,
  KILO_AI_GATEWAY_URL: undefined,
}

function apply(variables: Record<string, string | undefined>) {
  Object.entries(variables).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
}

const session = (env: Env) =>
  env.client.session.create({
    location: env.location,
    title: "Drain",
    agent: "build",
    model: { providerID: "test", id: "drain" },
  })

test(
  "drains a session through the generated client and publishes the token event",
  boot(async (env) => {
    const created = await session(env)
    const rpc = env.client.rpc(KiloSessionDrainRpc.Definition)
    const controller = new AbortController()
    const events = env.client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
    try {
      expect((await events.next()).value?.type).toBe("server.connected")
      const received = (async () => {
        for await (const event of { [Symbol.asyncIterator]: () => events }) {
          if (event.type === "rpc.kilocode.session-drain.drained") return event.data
        }
        throw new Error("Event stream disconnected before the token event")
      })()
      expect(await rpc.drain({ sessionID: created.id, token: "round-trip" }, { location: env.location })).toBe(true)
      expect(await received).toEqual({ sessionID: created.id, token: "round-trip" })
    } finally {
      controller.abort()
      await events.return?.(undefined)
    }
    expect(await rpc.drain({ sessionID: created.id }, { location: env.location })).toBe(true)
    await expect(rpc.drain({ sessionID: "ses_missing" }, { location: env.location })).rejects.toMatchObject({
      type: "not_found",
    })
    await expect(rpc.drain({ sessionID: created.id, token: "" }, { location: env.location })).rejects.toMatchObject({
      type: "rpc.invalid_input",
    })
  }),
  30_000,
)
