import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// The organization's MCP allow list end to end: the Gateway and guardrails plugins of packages/kilo-plugin, registered
// by the host, against a local stand-in for the Kilo API, observed through the generated client's MCP routes.
const allowed = "https://localhost:1/mcp"
const denied = "https://localhost:2/mcp"

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

async function eventually<A>(read: () => Promise<A> | A, ready: (value: A) => boolean) {
  const deadline = performance.now() + 15_000
  while (performance.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(20)
  }
  throw new Error("The expected MCP guardrails state did not arrive")
}

test(
  "blocks a server the allow list does not name, refuses to connect it, and audits both",
  async () => {
    using backend = fixture()
    backend.state.guardrails = {
      mcp: {
        enforcement: "enforce",
        allowedServers: [
          { identityKey: `remote:${allowed}`, name: "Allowed", description: null, config: { kind: "remote", url: allowed } },
        ],
      },
    }
    const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-mcp-guardrails-"))
    const variables = { ...signedOut, KILO_API_URL: backend.url, KILO_API_KEY: "fixture-token", KILO_ORG_ID: "selected" }
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
            yield* Effect.promise(async () => {
              const options = { location: { directory } }
              const status = async (server: string) =>
                (await client.mcp.list(options)).data.find((entry) => entry.name === server)?.status

              // The location starts the plugins; servers are added once the policy has been fetched and applied.
              await client.mcp.list(options)
              await eventually(
                () => backend.requests.some((request) => request.path === "/api/organizations/selected/guardrails"),
                Boolean,
              )
              await Bun.sleep(200)

              const remote = (url: string) => ({ type: "remote" as const, url, oauth: false as const })
              await client.mcp.add({ server: "allowed", ...options, config: remote(allowed) })
              await client.mcp.add({ server: "denied", ...options, config: remote(denied) })

              expect(await status("denied")).toEqual({
                status: "blocked",
                reason: "Not on your organization's MCP allowlist",
              })
              // The allowed server is tried (and fails to reach a port nobody listens on) instead of being blocked.
              expect((await eventually(() => status("allowed"), (value) => value?.status === "failed"))?.status).toBe(
                "failed",
              )

              await client.mcp.connect({ server: "denied", ...options })
              await client.mcp.disconnect({ server: "denied", ...options })
              expect((await status("denied"))?.status).toBe("blocked")

              // The two servers are added a moment apart, so they can arrive in separate reports.
              const reports = () =>
                (
                  backend.state.connectionBodies as { connections: { serverName: string; target: { url: string } }[] }[]
                )
                  .flatMap((body) => body.connections)
                  .map((connection) => [connection.serverName, connection.target.url])
                  .toSorted()
              expect(await eventually(reports, (value) => value.length >= 2)).toEqual([
                ["allowed", allowed],
                ["denied", denied],
              ])
            })
          }),
        ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
      )
    } finally {
      apply(previous)
      await rm(directory, { recursive: true, force: true })
    }
  },
  60_000,
)
