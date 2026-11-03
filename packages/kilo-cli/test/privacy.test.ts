import { expect, test } from "bun:test"
import { $ } from "bun"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { KiloPrivacyRpc } from "@opencode/schema/kilocode/privacy"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// The kilocode.privacy RPC through the real host and the generated client, with real global and project kilo2.json
// files. The Kilo API is a local stand-in.
const boot = (files: { global?: unknown; project?: unknown }, body: (client: Client, directory: string) => Promise<void>) => async () => {
  using backend = fixture()
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-privacy-rpc-")))
  const directory = path.join(root, "repo")
  const global = path.join(root, "global")
  await $`git init -q -b main ${directory}`.quiet()
  if (files.global !== undefined) await Bun.write(path.join(global, "kilo2.json"), JSON.stringify(files.global))
  if (files.project !== undefined) await Bun.write(path.join(directory, "kilo2.json"), JSON.stringify(files.project))
  const previous = { KILO_API_URL: process.env.KILO_API_URL, KILO_API_KEY: process.env.KILO_API_KEY }
  process.env.KILO_API_URL = backend.url
  delete process.env.KILO_API_KEY
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
              async (input: string | URL | Request, init?: RequestInit) =>
                handler(input instanceof Request ? input : new Request(input, init)),
              { preconnect: fetch.preconnect },
            ),
          })
          yield* Effect.promise(() => body(client, directory))
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
    )
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
    await rm(root, { recursive: true, force: true })
  }
}

type Client = ReturnType<typeof OpenCode.make>

const enabled = (client: Client, directory: string) =>
  client.rpc(KiloPrivacyRpc.Definition).get({}, { location: { directory } })

test(
  "privacy mode is off without privacy_mode",
  boot({ global: { shell: "sh" } }, async (client, directory) => {
    expect(await enabled(client, directory)).toEqual({ enabled: false })
  }),
  30_000,
)

test(
  "a global privacy_mode true turns privacy mode on, also under a project false",
  boot({ global: { privacy_mode: true }, project: { privacy_mode: false } }, async (client, directory) => {
    expect(await enabled(client, directory)).toEqual({ enabled: true })
    // The upstream config route does not carry Kilo keys, which is why clients read privacy mode through the RPC.
    const entries = await client.config.get({ location: { directory } })
    expect(JSON.stringify(entries)).not.toContain("privacy_mode")
  }),
  30_000,
)

test(
  "a project privacy_mode true turns privacy mode on",
  boot({ project: { privacy_mode: true } }, async (client, directory) => {
    expect(await enabled(client, directory)).toEqual({ enabled: true })
  }),
  30_000,
)

test(
  "an invalid privacy_mode is not applied",
  boot({ global: { privacy_mode: "yes" } }, async (client, directory) => {
    expect(await enabled(client, directory)).toEqual({ enabled: false })
  }),
  30_000,
)
