import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
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
  throw new Error("MCP authentication classification did not settle")
}

test("the host reports a remote authentication failure as needs_auth", async () => {
  const remote = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null, { status: 403 }),
  })
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-mcp-auth-")))
  const url = new URL("/mcp", remote.url).toString()
  await Bun.write(
    path.join(directory, "kilo2.json"),
    JSON.stringify({
      mcp: { servers: { "plain-403": { type: "remote", url }, "no-auth": { type: "remote", url, oauth: false } } },
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
            const options = { location: { directory } }
            const servers = await eventually(
              () => client.mcp.list(options),
              (value) =>
                value.data.length === 2 && value.data.every((server) => server.status.status !== "pending"),
            )
            expect(servers.data.find((server) => server.name === "plain-403")?.status).toMatchObject({
              status: "needs_auth",
              error: expect.stringContaining("403"),
            })
            expect(servers.data.find((server) => server.name === "no-auth")?.status).toMatchObject({
              status: "failed",
              error: expect.stringContaining("403"),
            })
          })
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
    )
  } finally {
    remote.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
