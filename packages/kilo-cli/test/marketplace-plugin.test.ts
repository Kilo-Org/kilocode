import { expect, test } from "bun:test"
import { $ } from "bun"
import { OpenCode } from "@opencode/client"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"
import { loadPlugins } from "./lib/plugins"

async function eventually<A>(read: () => Promise<A>, ready: (value: A) => boolean) {
  const deadline = performance.now() + 20_000
  while (performance.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(20)
  }
  throw new Error("The marketplace plugin did not activate")
}

// A repository whose package exports a server entry, cloned when the marketplace resolves the catalog spec.
async function repository() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-plugin-repo-")))
  await $`git init -q -b main`.cwd(directory).quiet()
  await $`git config user.email test@example.com`.cwd(directory).quiet()
  await $`git config user.name Test`.cwd(directory).quiet()
  await $`git config commit.gpgsign false`.cwd(directory).quiet()
  await Bun.write(
    path.join(directory, "package.json"),
    JSON.stringify({ name: "marketplace-plugin", exports: { "./server": "./server.ts" } }),
  )
  await Bun.write(path.join(directory, "server.ts"), 'export default { id: "marketplace-plugin", async setup() {} }\n')
  await $`git add -A`.cwd(directory).quiet()
  await $`git commit -q -m plugin`.cwd(directory).quiet()
  return directory
}

test("installs and removes a plugin from the catalog through the RPC client", async () => {
  const repositoryDirectory = await repository()
  const spec = `git:${repositoryDirectory}`
  using backend = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname !== "/api/marketplace/plugins") return new Response(null, { status: 404 })
      return new Response(
        Bun.YAML.stringify({
          items: [{ id: "marketplace-plugin", name: "Marketplace Plugin", description: "Demo", content: spec }],
        }),
      )
    },
  })
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-plugin-project-")))
  const previous = process.env.KILO_API_URL
  process.env.KILO_API_URL = backend.url.origin
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
                config: { directory: path.join(directory, "global"), project: true },
              },
              () => [],
              KiloHost.overrides,
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          yield* loadPlugins(context, directory)
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
          const plugins = async () => {
            const url = new URL("/api/plugin", "http://kilo.local")
            url.searchParams.set("location[directory]", directory)
            const response = await handler(
              new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
            )
            return ((await response.json()) as { data: { id?: string }[] }).data
          }
          yield* Effect.promise(async () => {
            const options = { location: { directory } }
            const rpc = client.rpc(KiloMarketplaceRpc.Definition)
            const request = { registry: "kilo", kind: "plugin", id: "marketplace-plugin", scope: "project" } as const
            const listed = await rpc.list({ kind: "plugin" }, options)
            expect(listed.items).toMatchObject([{ id: "marketplace-plugin", plugin: { spec } }])
            const installed = await rpc.install(request, options)
            const config = path.join(directory, "kilo2.json")
            expect(installed).toMatchObject({
              config,
              status: "ready",
              resources: [{ plugin: expect.stringContaining("git/") }],
            })
            expect(installed.server).toBeUndefined()
            expect(await Bun.file(config).json()).toEqual({ plugins: [spec] })
            expect(await rpc.installed({}, options)).toEqual([installed])
            const active = await eventually(plugins, (data) =>
              data.some((plugin) => plugin.id === "marketplace-plugin"),
            )
            expect(active).toContainEqual(
              expect.objectContaining({ id: "marketplace-plugin", source: { type: "package", target: spec } }),
            )
            await rpc.uninstall(request, options)
            expect(await Bun.file(config).json()).toEqual({ plugins: [] })
            expect(await rpc.installed({}, options)).toEqual([])
            await eventually(plugins, (data) => !data.some((plugin) => plugin.id === "marketplace-plugin"))
          })
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    if (previous === undefined) delete process.env.KILO_API_URL
    else process.env.KILO_API_URL = previous
    await rm(directory, { recursive: true, force: true })
    await rm(repositoryDirectory, { recursive: true, force: true })
  }
}, 60_000)
