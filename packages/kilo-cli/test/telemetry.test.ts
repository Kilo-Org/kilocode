import { afterEach, expect, test } from "bun:test"
import { $ } from "bun"
import { fixture } from "@kilocode/gateway-core/testing"
import { resetConsent } from "@kilocode/kilo-plugin/telemetry"
import { OpenCode } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { KiloTelemetryRpc } from "@opencode/schema/kilocode/telemetry"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// The kilocode.telemetry RPC through the real host and the generated client, with real kilo2.json files. A local
// PostHog stand-in receives what the engine delivers; the server drains the queue when it shuts down. The Kilo API is
// a local stand-in too, which answers the profile of a signed-in account.
type Batch = { api_key: string; batch: { event: string; distinct_id: string; properties: Record<string, unknown> }[] }

const boot = async (
  input: { global?: unknown; project?: unknown; env?: Record<string, string | undefined> },
  body: (rpc: Rpc, gateway: Gateway) => Promise<void>,
) => {
  using backend = fixture()
  const received: { path: string; body: Batch }[] = []
  const posthog = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      received.push({ path: new URL(request.url).pathname, body: (await request.json()) as Batch })
      return Response.json({ status: 1 })
    },
  })
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-telemetry-rpc-")))
  const directory = path.join(root, "repo")
  const global = path.join(root, "global")
  await $`git init -q -b main ${directory}`.quiet()
  if (input.global !== undefined) await Bun.write(path.join(global, "kilo2.json"), JSON.stringify(input.global))
  if (input.project !== undefined) await Bun.write(path.join(directory, "kilo2.json"), JSON.stringify(input.project))
  const variables = {
    KILO_API_URL: backend.url,
    KILO_API_KEY: undefined,
    KILO_TELEMETRY_URL: posthog.url.origin,
    KILO_MACHINE_ID: "machine-fixture",
    KILO_PLATFORM: "vscode",
    ...input.env,
  }
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
                config: { directory: global, project: true },
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
              async (request: string | URL | Request, init?: RequestInit) =>
                handler(request instanceof Request ? request : new Request(request, init)),
              { preconnect: fetch.preconnect },
            ),
          })
          const options = { location: { directory } }
          const telemetry = client.rpc(KiloTelemetryRpc.Definition)
          const gateway = client.rpc(KiloGatewayRpc.Definition)
          yield* Effect.promise(() =>
            body(
              {
                capture: (event, properties) => telemetry.capture({ event, properties }, options),
                setEnabled: (enabled) => telemetry.setEnabled({ enabled }, options),
                state: () => telemetry.state({}, options),
              },
              { authStatus: () => gateway.authStatus({}, options) },
            ),
          )
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
    )
    // The finalizer of the last location drains the PostHog queue before the scope closes.
    return received
  } finally {
    posthog.stop(true)
    apply(previous)
    await rm(root, { recursive: true, force: true })
  }
}

type Rpc = {
  capture: (event: string, properties?: Record<string, unknown>) => Promise<{ captured: boolean }>
  setEnabled: (enabled: boolean) => Promise<KiloTelemetryRpc.State>
  state: () => Promise<KiloTelemetryRpc.State>
}
type Gateway = { authStatus: () => Promise<unknown> }

function apply(variables: Record<string, string | undefined>) {
  Object.entries(variables).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
}

afterEach(() => resetConsent())

const event = KiloTelemetryRpc.EventName.AUTOCOMPLETE_ACCEPT_SUGGESTION

test(
  "a consented capture reaches PostHog with the engine and client properties",
  async () => {
    const received = await boot({ global: { shell: "sh" } }, async (rpc) => {
      expect(await rpc.state()).toEqual({ enabled: false, consent: null, config: true })
      expect(await rpc.setEnabled(true)).toEqual({ enabled: true, consent: true, config: true })
      expect(await rpc.capture(event, { suggestionLength: 12, appName: "kilo-code", platform: "vscode" })).toEqual({
        captured: true,
      })
    })
    expect(received.map((item) => item.path)).toEqual(["/batch/"])
    const [message] = received[0]!.body.batch
    expect(received[0]!.body.api_key).toStartWith("phc_")
    expect(message).toMatchObject({
      event: "Autocomplete Accept Suggestion",
      distinct_id: "machine-fixture",
      properties: {
        suggestionLength: 12,
        appName: "kilo-code",
        platform: "vscode",
        os_name: process.platform,
        os_arch: process.arch,
        appVersion: expect.any(String),
        kiloLine: "v2",
      },
    })
  },
  30_000,
)

test(
  "a signed-in capture carries the account email, its team and the alias of the machine",
  async () => {
    const received = await boot({ env: { KILO_API_KEY: "fixture-token" } }, async (rpc, gateway) => {
      await gateway.authStatus()
      await rpc.setEnabled(true)
      expect(await rpc.capture(KiloTelemetryRpc.EventName.TASK_CREATED, { taskId: "t1" })).toEqual({ captured: true })
    })
    const messages = received.flatMap((item) => item.body.batch)
    expect(messages.find((item) => item.event === "$create_alias")).toMatchObject({
      distinct_id: "profile@example.test",
      properties: { alias: "machine-fixture" },
    })
    expect(messages.find((item) => item.event === "Task Created")).toMatchObject({
      distinct_id: "profile@example.test",
      properties: { taskId: "t1" },
    })
  },
  30_000,
)

test(
  "without consent nothing leaves the machine",
  async () => {
    const received = await boot({}, async (rpc) => {
      expect(await rpc.capture(event)).toEqual({ captured: false })
      expect(await rpc.state()).toEqual({ enabled: false, consent: null, config: true })
    })
    expect(received).toEqual([])
  },
  30_000,
)

test(
  "a withdrawn consent drops the next events",
  async () => {
    const received = await boot({}, async (rpc) => {
      await rpc.setEnabled(true)
      expect(await rpc.capture(event, { n: 1 })).toEqual({ captured: true })
      expect(await rpc.setEnabled(false)).toEqual({ enabled: false, consent: false, config: true })
      expect(await rpc.capture(event, { n: 2 })).toEqual({ captured: false })
    })
    expect(received.flatMap((item) => item.body.batch).map((item) => item.properties.n)).toEqual([1])
  },
  30_000,
)

test(
  "experimental.openTelemetry false keeps every event local, also with consent",
  async () => {
    const received = await boot(
      { global: { experimental: { openTelemetry: false } }, project: { experimental: { openTelemetry: true } } },
      async (rpc) => {
        expect(await rpc.setEnabled(true)).toEqual({ enabled: false, consent: true, config: false })
        expect(await rpc.capture(event)).toEqual({ captured: false })
      },
    )
    expect(received).toEqual([])
  },
  30_000,
)
