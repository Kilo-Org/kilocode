import { expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloDefaults } from "../src/index.js"

const failures: { name: string; body?: string; status?: number; offline?: boolean }[] = [
  { name: "missing", body: "{}" },
  { name: "empty", body: '{"defaultModel":"","defaultFreeModel":""}' },
  { name: "unauthorized", status: 401 },
  { name: "server error", status: 500 },
  { name: "invalid JSON", body: "invalid" },
  { name: "network error", offline: true },
]

test("keeps the organization endpoint without a token and selects the anonymous field like v1", async () => {
  const requests: { path: string; authorization: string | null }[] = []
  const backend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") })
      return Response.json({ defaultModel: "team/paid", defaultFreeModel: "team/free" })
    },
  })
  try {
    expect(await Effect.runPromise(KiloDefaults.get({ server: backend.url.origin, organizationID: "team" })))
      .toBe("team/free")
    expect(requests).toEqual([{ path: "/api/organizations/team/defaults", authorization: null }])
  } finally {
    backend.stop(true)
  }
})

for (const failure of failures) {
  test(`preserves signed-in, anonymous and team defaults on ${failure.name}`, async () => {
    const requests: { path: string; authorization: string | null }[] = []
    const backend = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") })
        return new Response(failure.body ?? "", { status: failure.status ?? 200 })
      },
    })
    const server = backend.url.origin
    if (failure.offline) backend.stop(true)
    try {
      expect(await Effect.runPromise(KiloDefaults.get({ server }))).toBe(KiloDefaults.DEFAULT_FREE_MODEL)
      expect(await Effect.runPromise(KiloDefaults.get({ server, token: "token" }))).toBe(KiloDefaults.DEFAULT_MODEL)
      expect(await Effect.runPromise(KiloDefaults.get({ server, token: "token", organizationID: "team" })))
        .toBeUndefined()
      if (!failure.offline) expect(requests).toEqual([
        { path: "/api/defaults", authorization: null },
        { path: "/api/defaults", authorization: "Bearer token" },
        { path: "/api/organizations/team/defaults", authorization: "Bearer token" },
      ])
    } finally {
      backend.stop(true)
    }
  })
}
