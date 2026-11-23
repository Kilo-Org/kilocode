import { Auth } from "@/auth"
import * as Attachments from "@/kilocode/server/hosted-attachments"
import { provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import * as HttpApiServer from "@/server/routes/instance/httpapi/server"
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { hosted } from "./hosted-fixture"

const SESSION = "ses_00000000000000000000000001"
const OTHER = "ses_00000000000000000000000002"
const TOKEN = "kilo-test-bearer-value"

function app() {
  const handler = HttpRouter.toWebHandler(
    HttpApiServer.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER ?? "true",
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler

  return {
    request(input: string, init?: RequestInit) {
      return handler(new Request(new URL(input, "http://localhost"), init), HttpApiServer.context)
    },
  }
}

function cloud(name: string) {
  const calls: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/cloud-agent-next/token") {
        return Response.json({ token: `${name}-control`, expiresAt: new Date(Date.now() + 600_000).toISOString() })
      }
      calls.push(`${request.method} ${url.pathname}`)
      return Response.json({ provider: name })
    },
  })
  const info = new Auth.Api({ type: "api", key: TOKEN })
  const auth = {
    get: (id: string) => Effect.succeed(id === "kilo" ? info : undefined),
    all: () => Effect.succeed<Record<string, Auth.Info>>({ kilo: info }),
    set: () => Effect.void,
    remove: () => Effect.void,
  } satisfies Auth.Interface
  return {
    provider: kiloCloud({
      auth,
      env: {
        CLOUD_AGENT_NEXT_BASE_URL: `http://127.0.0.1:${server.port}`,
        KILO_WEB_APP_URL: `http://127.0.0.1:${server.port}`,
      },
    }),
    calls,
    stop: () => server.stop(true),
  }
}

const first = cloud("first")
const second = cloud("second")
const api = app()

beforeEach(() => Attachments.store.clear())
afterEach(() => Attachments.store.clear())
afterAll(() => {
  void first.stop()
  void second.stop()
})

describe("hosted attachment identity isolation", () => {
  test("colliding provider and native session ids stay bound to their own attachment", async () => {
    // Both providers report the same provider id and the same native session id,
    // so only the opaque attachment can tell them apart.
    const a = Attachments.store.mint({
      provider: first.provider,
      session: hosted("kilo-cloud", SESSION),
      expiresAt: Date.now() + 60_000,
    })
    const b = Attachments.store.mint({
      provider: second.provider,
      session: hosted("kilo-cloud", SESSION),
      expiresAt: Date.now() + 60_000,
    })
    expect(a.id).not.toBe(b.id)

    const viaA = await api.request(`/session/${SESSION}/message?workspace=${a.id}`)
    expect(await viaA.json()).toEqual({ provider: "first" })
    expect(second.calls).toHaveLength(0)

    const viaB = await api.request(`/session/${SESSION}/message?workspace=${b.id}`)
    expect(await viaB.json()).toEqual({ provider: "second" })
    expect(first.calls).toHaveLength(1)

    const crossed = await api.request(`/session/${OTHER}/message?workspace=${a.id}`)
    expect(crossed.status).toBe(400)
    expect(first.calls).toHaveLength(1)
    expect(second.calls).toHaveLength(1)
  })
})
