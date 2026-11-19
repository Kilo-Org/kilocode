import { Auth } from "@/auth"
import { PROVIDER, provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import { isNativePath, publicDirectory } from "@/kilocode/session-hosting/native-routes"
import type { HostedSessionID, NativeRequest } from "@/kilocode/session-hosting/types"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

const SESSION = "ses_00000000000000000000000001"
const TOKEN = "kilo-test-bearer-value"
const CONTROL = "kilo-test-control-value"

function auth() {
  const info = new Auth.Api({ type: "api", key: TOKEN })
  return {
    get: (id: string) => Effect.succeed(id === "kilo" ? info : undefined),
    all: () => Effect.succeed<Record<string, Auth.Info>>({ kilo: info }),
    set: () => Effect.void,
    remove: () => Effect.void,
  } satisfies Auth.Interface
}

const hosted: HostedSessionID = { providerID: PROVIDER, sessionID: SESSION }

function native(path: string, query = ""): NativeRequest {
  const url = new URL(path + (query ? `?${query}` : ""), "http://localhost")
  return {
    session: hosted,
    method: "GET",
    path: url.pathname,
    query: url.searchParams,
    headers: new Headers({ accept: "text/event-stream" }),
  }
}

it.effect("recognizes the system feed as a routed native path", () =>
  Effect.sync(() => {
    expect(isNativePath("GET", "/cloud-agent/event")).toBe(true)
    expect(isNativePath("POST", "/cloud-agent/event")).toBe(false)
  }),
)

it.effect("maps the system feed onto Cloud and keeps both event streams unbounded", () => {
  const seen: Array<{ url: string; auth: string | null; signal: AbortSignal | null }> = []
  const fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url
      seen.push({ url, auth: new Headers(init?.headers).get("authorization"), signal: init?.signal ?? null })
      if (new URL(url).pathname === "/api/cloud-agent-next/token") {
        return Response.json({ token: CONTROL, expiresAt: new Date(Date.now() + 600_000).toISOString() })
      }
      return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })
    },
    { preconnect: () => undefined },
  )
  const cloud = kiloCloud({
    auth: auth(),
    env: { CLOUD_AGENT_NEXT_BASE_URL: "http://127.0.0.1:9", KILO_WEB_APP_URL: "http://127.0.0.1:9" },
    fetch,
  })
  const directory = encodeURIComponent(publicDirectory(SESSION))
  return Effect.gen(function* () {
    const route = cloud.route
    if (!route) throw new Error("kilo-cloud must implement native routing")

    yield* route(
      native(
        "/cloud-agent/event",
        "workspace=wrk_att_x&location%5Bworkspace%5D=wrk_att_y&directory=%2Ftmp%2Fnot-target",
      ),
    )
    yield* route(native("/event"))
    yield* route(native(`/session/${SESSION}`))

    // The source credential is presented only to the issuer.
    expect(seen[0].url).toBe("http://127.0.0.1:9/api/cloud-agent-next/token")
    expect(seen[0].auth).toBe(`Bearer ${TOKEN}`)
    // The Worker sees only the exchanged control token.
    expect(seen.slice(1).map((call) => call.auth)).toEqual(seen.slice(1).map(() => `Bearer ${CONTROL}`))

    // The attachment selector never reaches Cloud; the directory is derived from
    // the attached root session.
    expect(seen[1].url).toBe(`http://127.0.0.1:9/kilo/cloud-agent/event?directory=${directory}`)
    expect(seen[1].url).not.toContain("wrk_att")
    // Both event streams are long-lived; every other route keeps the default bound.
    expect(seen[1].signal).toBeNull()
    expect(seen[2].url).toBe(`http://127.0.0.1:9/kilo/event?directory=${directory}`)
    expect(seen[2].signal).toBeNull()
    expect(seen[3].url).toBe(`http://127.0.0.1:9/kilo/session/${SESSION}`)
    expect(seen[3].signal).not.toBeNull()

    // One exchange serves every Worker call for the same source, org, and origins.
    expect(seen.filter((call) => call.url.endsWith("/api/cloud-agent-next/token"))).toHaveLength(1)
  })
})
