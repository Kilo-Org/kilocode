import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// The reference Kilo RPC end to end: the contract in @opencode/schema, the handlers in the Gateway plugin of
// packages/kilo-plugin, the plugin registered by the host overrides, and the call through the generated client's
// `rpc` entry point (`POST /api/rpc/:rpcID/:method`), as the TUI and the IDE clients make it. A local stand-in for
// the Kilo API answers the Gateway.
const boot = (env: Record<string, string>, body: (rpc: ReturnType<typeof gateway>) => Promise<void>) => async () => {
  using backend = fixture()
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-rpc-"))
  // Keep a developer's Kilo login out of the test.
  const variables = { ...signedOut, KILO_API_URL: backend.url, ...env }
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
            // The client sends its requests to the server in this process instead of the network.
            fetch: Object.assign(
              async (input: string | URL | Request, init?: RequestInit) =>
                handler(input instanceof Request ? input : new Request(input, init)),
              { preconnect: fetch.preconnect },
            ),
          })
          yield* Effect.promise(() => body(gateway(client, directory, backend.url)))
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    apply(previous)
    await rm(directory, { recursive: true, force: true })
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

function gateway(client: ReturnType<typeof OpenCode.make>, directory: string, server: string) {
  return { rpc: client.rpc(KiloGatewayRpc.Definition), options: { location: { directory } }, server }
}

test(
  "a signed-out client reads the Gateway state and catalog through the generated client",
  boot({}, async (gateway) => {
    expect(await gateway.rpc.authStatus({}, gateway.options)).toEqual({
      authenticated: false,
      organizationID: null,
      server: gateway.server,
    })
    const models = await gateway.rpc.models({}, gateway.options)
    expect(models.find((model) => model.id === "kilo-auto/free")).toMatchObject({ name: "Kilo Auto Free", isFree: true })
    // A handler error keeps its contract name through the HTTP route.
    await expect(gateway.rpc.profile({}, gateway.options)).rejects.toMatchObject({
      type: "unauthorized",
      message: "Not signed in to Kilo Gateway",
    })
  }),
  30_000,
)

test(
  "a signed-in client reads the profile and switches the team through the generated client",
  boot({ KILO_API_KEY: "fixture-token" }, async (gateway) => {
    expect(await gateway.rpc.profile({}, gateway.options)).toEqual({
      email: "profile@example.test",
      name: "Fixture",
      organizations: [
        { id: "first", name: "First", role: "member" },
        { id: "selected", name: "Selected", role: "owner" },
      ],
      hasPersonalAccount: true,
      organizationID: null,
    })
    expect(await gateway.rpc["organization.set"]({ organizationID: "first" }, gateway.options)).toEqual({})
    expect(await gateway.rpc.authStatus({}, gateway.options)).toEqual({
      authenticated: true,
      organizationID: "first",
      server: gateway.server,
    })
  }),
  30_000,
)
