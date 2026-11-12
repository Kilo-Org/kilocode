import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdirScoped } from "../../../core/test/fixture/tmpdir"
import { it } from "../../../core/test/lib/effect"
import { ServerFetch } from "../../src/fetch"

it.live("lists no pending requests for a Location that is not loaded, without loading it", () =>
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
        return { status: response.status, body: await response.json() }
      })
    const directory = yield* tmpdirScoped()
    const query = `location[directory]=${encodeURIComponent(directory.path)}`

    expect(yield* request(`/api/permission/request?${query}`)).toEqual({
      status: 200,
      body: { location: { directory: directory.path }, data: [] },
    })
    expect(yield* request(`/api/form?${query}`)).toEqual({
      status: 200,
      body: { location: { directory: directory.path }, data: [] },
    })
    expect((yield* request("/api/debug/location")).body).toEqual([])

    // A deleted directory still reports that its Location does not exist.
    const missing = `location[directory]=${encodeURIComponent(`${directory.path}-deleted`)}`
    expect((yield* request(`/api/permission/request?${missing}`)).status).toBe(404)
    expect((yield* request(`/api/form?${missing}`)).status).toBe(404)

    // Once the Location is loaded, the lists read its pending state.
    const session = yield* request("/api/session", { location: { directory: directory.path } })
    const sessionID = (session.body as { data: { id: string } }).data.id
    const created = yield* request(`/api/session/${sessionID}/form`, {
      title: "Pick one",
      fields: [{ key: "answer", type: "string" }],
    })
    expect(created.status).toBe(200)
    const listed = yield* request(`/api/form?${query}`)
    expect(listed.status).toBe(200)
    expect((listed.body as { data: unknown[] }).data).toEqual([(created.body as { data: unknown }).data])
  }).pipe(Effect.scoped),
)
