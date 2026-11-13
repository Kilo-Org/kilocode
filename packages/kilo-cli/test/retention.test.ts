import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { KiloRetentionRpc } from "@opencode/schema/kilocode/retention"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { KiloHost } from "../src/host"

type Env = { readonly client: ReturnType<typeof OpenCode.make>; readonly location: { readonly directory: string } }

// Session retention end to end: the contract in @opencode/schema, the handlers in the retention plugin, the plugin
// registered by the host overrides, and the calls through the generated client's `rpc` entry point, as the VS Code
// extension makes them. Expiry, cancellation and joining are covered against a real store in
// packages/kilo-plugin/test/retention.test.ts; this suite checks the host wiring and the wire shapes.
const boot = (retention: unknown, body: (env: Env) => Promise<void>) => async () => {
  using backend = fixture()
  await using temporary = await tmpdir("kilo-retention-")
  const directory = temporary.path
  await Bun.write(path.join(directory, "kilo2.json"), JSON.stringify(retention === undefined ? {} : { retention }))
  const variables = { ...signedOut, KILO_API_URL: backend.url }
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
  apply(variables)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
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
          yield* Effect.promise(() => body({ client, location: { directory } }))
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

test(
  "runs a pass, reports it as the last result and keeps fresh sessions",
  boot({ enabled: true, maxAgeDays: 7 }, async (env) => {
    const created = await env.client.session.create({ location: env.location, title: "Fresh" })
    const rpc = env.client.rpc(KiloRetentionRpc.Definition)
    expect(await rpc.status({}, { location: env.location })).toEqual({ policy: { enabled: true, maxAgeDays: 7 } })

    const status = await rpc.run({}, { location: env.location })
    expect(status.policy).toEqual({ enabled: true, maxAgeDays: 7 })
    expect(status.progress).toBeUndefined()
    expect(status.last).toMatchObject({ scanned: 1, deleted: 0, skippedActive: 0, failed: 0 })
    expect(typeof status.last?.at).toBe("number")
    expect(await env.client.session.get({ sessionID: created.id })).toMatchObject({ id: created.id })

    // Nothing runs, so there is nothing to cancel, and the result stays the last one.
    expect(await rpc.cancel({}, { location: env.location })).toEqual({ requested: false })
    expect(await rpc.status({}, { location: env.location })).toEqual(status)
    // A scheduled pass within the spacing window is held back and returns the same last result.
    expect(await rpc.run({}, { location: env.location })).toEqual(status)
  }),
)

test(
  "a disabled policy runs nothing over the wire",
  boot({ enabled: false }, async (env) => {
    const rpc = env.client.rpc(KiloRetentionRpc.Definition)
    expect(await rpc.run({ force: true }, { location: env.location })).toEqual({
      policy: { enabled: false, maxAgeDays: 30 },
    })
    await expect(rpc.run({ force: "yes" } as never, { location: env.location })).rejects.toMatchObject({
      type: "rpc.invalid_input",
    })
  }),
)
