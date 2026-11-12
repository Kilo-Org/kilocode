import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { PagesAuth } from "@kilocode/kilo-plugin/pages/auth"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

async function eventually<A>(read: () => Promise<A>, ready: (value: A) => boolean) {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(20)
  }
  throw new Error("MCP server did not settle")
}

test("the host puts the Pages bearer on a remote server that carries a registered handle", async () => {
  const requests: Headers[] = []
  using remote = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      requests.push(request.headers)
      return new Response(null, { status: 403 })
    },
  })
  const handle = crypto.randomUUID()
  const unregister = PagesAuth.register(handle, {
    origin: new URL(remote.url).origin,
    client: "kilo/test",
    token: async () => "minted-token",
  })
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-pages-host-")))
  await Bun.write(
    path.join(directory, "kilo2.json"),
    JSON.stringify({
      mcp: {
        servers: {
          pages: {
            type: "remote",
            url: new URL("/mcp", remote.url).toString(),
            oauth: false,
            headers: { [PagesAuth.HANDLE_HEADER]: handle },
          },
        },
      },
    }),
  )
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "fixture",
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
            headers: { authorization: `Basic ${btoa("opencode:fixture")}` },
            fetch: Object.assign(
              async (input: string | URL | Request, init?: RequestInit) =>
                handler(input instanceof Request ? input : new Request(input, init)),
              { preconnect: fetch.preconnect },
            ),
          })
          yield* Effect.promise(async () => {
            await eventually(
              () => client.mcp.list({ location: { directory } }),
              (value) => value.data.length === 1 && value.data[0]!.status.status !== "pending",
            )
            const headers = requests[0]!
            expect(headers.get("authorization")).toBe("Bearer minted-token")
            expect(headers.get("x-pages-client")).toBe("kilo/test")
            expect(headers.get("x-pages-driver")).toBe("Kilo")
            expect(headers.has(PagesAuth.HANDLE_HEADER)).toBe(false)
          })
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
    )
  } finally {
    unregister()
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
