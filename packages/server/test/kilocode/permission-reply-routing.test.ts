import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdirScoped } from "../../../core/test/fixture/tmpdir"
import { it } from "../../../core/test/lib/effect"
import { ServerFetch } from "../../src/fetch"

// Carries v1 test/kilocode/permission/next.reply-routing.test.ts: a reply to an unknown or already answered request,
// or through a session of another Location (v1: another directory), is not found and leaves the request pending.
it.live("answers a permission reply only once, and only through a session of the request's Location", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const request = (path: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        const json = response.headers.get("content-type")?.includes("json")
        return { status: response.status, body: json ? await response.json() : await response.text() }
      })
    const session = (directory: string) =>
      request("/api/session", {
        location: { directory },
        permissions: [{ action: "kilo-reply-routing", resource: "*", effect: "ask" }],
      }).pipe(Effect.map((response) => (response.body as { data: { id: string } }).data.id))
    const reply = (sessionID: string, requestID: string, decision: "once" | "reject") =>
      request(`/api/session/${sessionID}/permission/${requestID}/reply`, { decision })
    const missing = (requestID: string) => ({
      status: 404,
      body: {
        _tag: "PermissionNotFoundError",
        requestID,
        message: `Permission request not found: ${requestID}`,
      },
    })

    const owner = yield* session((yield* tmpdirScoped()).path)
    const other = yield* session((yield* tmpdirScoped()).path)

    // A request that was never asked is not found, whatever the decision.
    expect(yield* reply(owner, "per_unknown", "once")).toEqual(missing("per_unknown"))
    expect(yield* reply(owner, "per_unknown", "reject")).toEqual(missing("per_unknown"))

    const created = yield* request(`/api/session/${owner}/permission`, {
      action: "kilo-reply-routing",
      resources: ["probe"],
    })
    expect(created.status).toBe(200)
    const asked = (created.body as { data: { id: string; effect: string } }).data
    expect(asked.effect).toBe("ask")

    // A session of another Location (directory) cannot answer it, and the request stays pending.
    expect(yield* reply(other, asked.id, "once")).toEqual(missing(asked.id))
    expect((yield* request(`/api/session/${owner}/permission`)).body).toMatchObject({ data: [{ id: asked.id }] })
    expect((yield* request(`/api/session/${other}/permission`)).body).toEqual({ data: [] })

    // The owner answers it once; a second reply finds nothing pending.
    expect(yield* reply(owner, asked.id, "once")).toEqual({ status: 204, body: "" })
    expect(yield* reply(owner, asked.id, "once")).toEqual(missing(asked.id))
    expect((yield* request(`/api/session/${owner}/permission`)).body).toEqual({ data: [] })
  }).pipe(Effect.scoped),
)
