import { expect, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"
import { reportInstall } from "../src/marketplace/handlers/install"

async function eventually<A>(read: () => Promise<A>, ready: (value: A) => boolean) {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(20)
  }
  throw new Error("Native OAuth/MCP state did not become ready")
}

test("marketplace remote install completes native OAuth and reconnects using the persisted credential", async () => {
  const tokenRequests: URLSearchParams[] = []
  const authenticated: string[] = []
  using backend = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/marketplace/mcps")
        return new Response(
          [
            "items:",
            "  - id: fixture/oauth",
            "    name: Fixture OAuth",
            "    description: Local OAuth fixture",
            "    content:",
            "      - name: HTTP",
            "        content: |",
            `          ${JSON.stringify({ type: "remote", url: `${url.origin}/mcp`, oauth: { client_id: "fixture", auth_server_metadata_url: `${url.origin}/metadata` } })}`,
          ].join("\n"),
        )
      if (url.pathname === "/metadata")
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        })
      if (url.pathname === "/token") {
        tokenRequests.push(new URLSearchParams(await request.text()))
        return Response.json({
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        })
      }
      if (url.pathname !== "/mcp") return new Response(null, { status: 404 })
      if (request.headers.get("authorization") !== "Bearer fixture-access") return new Response(null, { status: 401 })
      if (request.method !== "POST") return new Response(null, { status: 405 })
      const message: { id?: number; method: string } = await request.json()
      authenticated.push(message.method)
      if (message.id === undefined) return new Response(null, { status: 202 })
      return Response.json({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          serverInfo: { name: "fixture", version: "1" },
        },
      })
    },
  })
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-oauth-")))
  const previous = process.env.KILO_API_URL
  process.env.KILO_API_URL = backend.url.origin
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
            const location = { directory }
            const options = { location }
            const rpc = client.rpc(KiloMarketplaceRpc.Definition)
            const installed = await rpc.install(
              { registry: "kilo", kind: "mcp", id: "fixture/oauth", scope: "global" },
              options,
            )
            expect(installed.server).toBe("fixture-oauth")
            expect(installed.config).toBe(path.join(directory, "kilo2.json"))
            // Deterministic public reload, not file-watcher coverage.
            await client.location.reload()
            const server = await eventually(
              () => client.mcp.list(options),
              (value) =>
                value.data.some((server) => server.name === installed.server && server.status.status === "needs_auth"),
            )
            const integrationID = server.data.find((server) => server.name === installed.server)?.integrationID
            if (!integrationID) throw new Error("Installed server did not expose native integration identity")
            const output: string[] = []
            const stdout = spyOn(process.stdout, "write").mockImplementation((chunk) => {
              output.push(String(chunk))
              return true
            })
            try {
              await Effect.runPromise(reportInstall({ client, rpc, options, location }, installed))
            } finally {
              stdout.mockRestore()
            }
            expect(output.join("")).toContain("Run: kilo mcp auth 'fixture-oauth'")
            expect(tokenRequests).toHaveLength(0)
            const integration = await client.integration.get({ ...options, integrationID })
            const method = integration.data.methods.find((method) => method.type === "oauth")
            if (!method || method.type !== "oauth") throw new Error("Native OAuth method missing")
            const attempt = await client.integration.oauth.connect({ ...options, integrationID, methodID: method.id })
            const attemptInput = { ...options, integrationID, attemptID: attempt.data.attemptID }
            expect((await client.integration.oauth.status(attemptInput)).data.status).toBe("pending")
            const authorization = new URL(attempt.data.url)
            const callback = new URL(authorization.searchParams.get("redirect_uri")!)
            callback.searchParams.set("state", authorization.searchParams.get("state")!)
            callback.searchParams.set("code", "accepted")
            expect((await fetch(callback)).status).toBe(200)
            await eventually(
              () => client.integration.oauth.status(attemptInput),
              (value) => value.data.status === "complete",
            )
            expect(tokenRequests).toHaveLength(1)
            expect(tokenRequests[0]?.get("grant_type")).toBe("authorization_code")
            expect(tokenRequests[0]?.get("code")).toBe("accepted")
            expect(tokenRequests[0]?.get("code_verifier")).toBeTruthy()
            expect(await client.credential.list()).toContainEqual(
              expect.objectContaining({
                integrationID,
                value: expect.objectContaining({ type: "oauth", access: "fixture-access", refresh: "fixture-refresh" }),
              }),
            )
            // No explicit mcp.connect: credential changes must trigger the native reconnect.
            await eventually(
              () => client.mcp.list(options),
              (value) =>
                value.data.some((server) => server.name === installed.server && server.status.status === "connected"),
            )
            expect(authenticated).toContain("initialize")
            expect(await rpc.installed({}, options)).toContainEqual(
              expect.objectContaining({ server: "fixture-oauth" }),
            )
            const config = await Bun.file(installed.config!).text()
            expect(config).not.toContain("fixture-access")
            expect(config).not.toContain("fixture-refresh")
          })
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
    )
  } finally {
    if (previous === undefined) delete process.env.KILO_API_URL
    else process.env.KILO_API_URL = previous
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
