import { expect, test } from "bun:test"
import { $ } from "bun"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"
import { loadPlugins } from "./lib/plugins"

// The kilocode.indexing RPC through the real host and the generated client, with real global and project kilo2.json
// files. The Kilo API is a local stand-in; indexing itself stays disabled, so no embedder is called.
const boot =
  (files: { global?: unknown; project?: unknown }, body: (client: Client, directory: string, global: string) => Promise<void>) =>
  async () => {
    using backend = fixture()
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-indexing-rpc-")))
    const directory = path.join(root, "repo")
    const global = path.join(root, "global")
    await $`git init -q -b main ${directory}`.quiet()
    if (files.global !== undefined) await Bun.write(path.join(global, "kilo2.json"), JSON.stringify(files.global))
    if (files.project !== undefined) await Bun.write(path.join(directory, "kilo2.json"), JSON.stringify(files.project))
    const previous = { KILO_API_URL: process.env.KILO_API_URL, KILO_API_KEY: process.env.KILO_API_KEY, KILO_PLATFORM: process.env.KILO_PLATFORM }
    process.env.KILO_API_URL = backend.url
    delete process.env.KILO_API_KEY
    delete process.env.KILO_PLATFORM
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
            yield* loadPlugins(context, directory)
            yield* Effect.promise(() => body(client, directory, global))
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

const rpc = (client: Client) => client.rpc(KiloIndexingRpc.Definition)

test(
  "indexing is disabled until the config enables it",
  boot({ global: { shell: "sh" } }, async (client, directory) => {
    const status = await rpc(client).status({}, { location: { directory } })
    expect(["Disabled", "In Progress"]).toContain(status.state)
    const settled = await waitFor(() => rpc(client).status({}, { location: { directory } }), (value) => value.state !== "In Progress")
    expect(settled).toMatchObject({ state: "Disabled", message: "Indexing disabled." })
    expect(await rpc(client).warnings({}, { location: { directory } })).toEqual([])
  }),
  30_000,
)

test(
  "the config method reads the indexing key of the global and project files",
  boot(
    { global: { indexing: { provider: "ollama", ollama: { baseUrl: "http://127.0.0.1:1" } } }, project: { indexing: { searchMaxResults: 7 } } },
    async (client, directory) => {
      const settings = await rpc(client).config({}, { location: { directory } })
      expect(settings).toEqual({
        global: { provider: "ollama", ollama: { baseUrl: "http://127.0.0.1:1" } },
        project: { searchMaxResults: 7 },
        kilo: false,
      })
      // The upstream config route does not carry Kilo keys, which is why clients read indexing through the RPC.
      const entries = await client.config.get({ location: { directory } })
      expect(JSON.stringify(entries)).not.toContain("searchMaxResults")
    },
  ),
  30_000,
)

test(
  "an invalid field empties the config answer like the engine instead of failing the read",
  boot({ project: { indexing: { enabled: true, provider: "ollama", searchMinScore: 2 } } }, async (client, directory) => {
    const settings = await rpc(client).config({}, { location: { directory } })
    expect(settings.project).toEqual({})
    const status = await waitFor(() => rpc(client).status({}, { location: { directory } }), (value) => value.state !== "In Progress")
    expect(status.state).toBe("Disabled")
  }),
  30_000,
)

test(
  "config.update applies the saved settings without a config watcher",
  boot({ project: { privacy_mode: false } }, async (client, directory) => {
    const disabled = await waitFor(() => rpc(client).status({}, { location: { directory } }), (value) => value.state !== "In Progress")
    expect(disabled.state).toBe("Disabled")
    await rpc(client)["config.update"](
      {
        scope: "project",
        config: { enabled: true, provider: "ollama", vectorStore: "qdrant", ollama: { baseUrl: "http://127.0.0.1:1" }, qdrant: { url: "http://127.0.0.1:1" } },
      },
      { location: { directory } },
    )
    const status = await waitFor(() => rpc(client).status({}, { location: { directory } }), (value) => value.state === "Error")
    expect(status.state).toBe("Error")
  }),
  30_000,
)

test(
  "config.update writes the indexing key in place and removes it when empty",
  boot({ project: { privacy_mode: false } }, async (client, directory, global) => {
    await rpc(client)["config.update"]({ scope: "project", config: { enabled: false, vectorStore: "qdrant" } }, { location: { directory } })
    expect(await Bun.file(path.join(directory, "kilo2.json")).json()).toEqual({
      privacy_mode: false,
      indexing: { enabled: false, vectorStore: "qdrant" },
    })
    await rpc(client)["config.update"]({ scope: "global", config: { provider: "openai" } }, { location: { directory } })
    expect(await Bun.file(path.join(global, "kilo2.json")).json()).toEqual({ indexing: { provider: "openai" } })
    expect(await rpc(client).config({}, { location: { directory } })).toMatchObject({
      global: { provider: "openai" },
      project: { enabled: false, vectorStore: "qdrant" },
    })

    await rpc(client)["config.update"]({ scope: "project", config: {} }, { location: { directory } })
    expect(await Bun.file(path.join(directory, "kilo2.json")).json()).toEqual({ privacy_mode: false })
  }),
  30_000,
)

test(
  "an enabled index with an unreachable embedder reports the error",
  boot(
    { project: { indexing: { enabled: true, provider: "ollama", vectorStore: "qdrant", ollama: { baseUrl: "http://127.0.0.1:1" }, qdrant: { url: "http://127.0.0.1:1" } } } },
    async (client, directory) => {
      const status = await waitFor(
        () => rpc(client).status({}, { location: { directory } }),
        (value) => value.state === "Error",
      )
      expect(status.state).toBe("Error")
      expect(status.message).toStartWith("Failed to initialize:")
    },
  ),
  30_000,
)

test(
  "consent is answered without effect outside VS Code",
  boot({}, async (client, directory) => {
    const status = await rpc(client).consent({ enabled: true }, { location: { directory } })
    expect(status.state).not.toBe("Error")
  }),
  30_000,
)

async function waitFor<A>(read: () => Promise<A>, done: (value: A) => boolean) {
  for (const _ of Array.from({ length: 100 })) {
    const value = await read()
    if (done(value)) return value
    await Bun.sleep(100)
  }
  return read()
}
