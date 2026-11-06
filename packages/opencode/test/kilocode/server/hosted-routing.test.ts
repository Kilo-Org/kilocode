import * as Attachments from "@/kilocode/server/hosted-attachments"
import { MAX_BODY_BYTES } from "@/kilocode/server/routes/hosted-routing"
import { HostedFailure, type NativeRequest } from "@/kilocode/session-hosting/types"
import * as HttpApiServer from "@/server/routes/instance/httpapi/server"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"
import { hosted, provider } from "./hosted-fixture"

const SESSION = "ses_00000000000000000000000001"
const OTHER = "ses_00000000000000000000000002"

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

function attach(fake: ReturnType<typeof provider>, sessionID = SESSION, expiresAt = Date.now() + 60_000) {
  return Attachments.store.mint({
    provider: fake.value,
    session: hosted(fake.value.id, sessionID),
    expiresAt,
  })
}

beforeEach(() => Attachments.store.clear())

afterEach(async () => {
  Attachments.store.clear()
  await disposeAllInstances()
  await resetDatabase()
})

describe("hosted attachment routing", () => {
  test("routes the registered system feed through the hosted provider", async () => {
    const calls: NativeRequest[] = []
    const fake = provider("alpha", {
      route: (request) => {
        calls.push(request)
        return Effect.succeed(
          new Response('data: {"type":"preparing","properties":{}}\n\n', {
            headers: { "content-type": "text/event-stream" },
          }),
        )
      },
    })
    const entry = attach(fake)
    const response = await app().request(`/cloud-agent/event?workspace=${entry.id}`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(await response.text()).toContain('"type":"preparing"')
    expect(calls[0]?.path).toBe("/cloud-agent/event")
    expect(calls[0]?.session.sessionID).toBe(SESSION)
  })

  test("rejects system feeds without a live hosted attachment", async () => {
    const api = app()
    const local = await api.request("/cloud-agent/event")
    expect(local.status).toBe(400)
    expect(await local.json()).toMatchObject({ message: "A hosted attachment is required for Cloud Agent events" })
    const unknown = await api.request(`/cloud-agent/event?workspace=${Attachments.createID()}`)
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ code: "unknown" })
  })

  test("routes a native read to the provider and strips local credentials and selectors", async () => {
    const api = app()
    const fake = provider("alpha")
    const entry = attach(fake)

    const response = await api.request(`/session/${SESSION}/message?workspace=${entry.id}`, {
      headers: {
        authorization: "Basic dXNlcjpwYXNz",
        cookie: "session=local",
        "x-kilo-directory": "/tmp/not-the-target",
        "x-kilo-workspace": entry.id,
        "x-kilo-ticket": "local-ticket",
        accept: "application/json",
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, path: `/session/${SESSION}/message` })
    expect(fake.calls).toHaveLength(1)
    const call = fake.calls[0]
    expect(call.session.sessionID).toBe(SESSION)
    expect(call.headers.get("accept")).toBe("application/json")
    for (const stripped of [
      "authorization",
      "cookie",
      "x-kilo-directory",
      "x-kilo-workspace",
      "x-kilo-ticket",
      "host",
    ]) {
      expect(call.headers.get(stripped)).toBeNull()
    }
  })

  test("forwards a native mutation body to the provider", async () => {
    const api = app()
    const fake = provider("alpha")
    const entry = attach(fake)

    const response = await api.request(`/session/${SESSION}/prompt_async?workspace=${entry.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kilo-workspace": entry.id },
      body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
    })

    expect(response.status).toBe(200)
    expect(new TextDecoder().decode(fake.calls[0]?.body)).toBe(
      JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
    )
    expect(fake.calls[0]?.headers.get("content-type")).toBe("application/json")
  })

  test("stops reading a chunked request as soon as it exceeds the body budget", async () => {
    const api = app()
    const fake = provider("alpha")
    const entry = attach(fake)
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(128 * 1024))
        if (pulls >= 4) controller.close()
      },
    })

    const response = await api.request(`/session/${SESSION}/prompt_async?workspace=${entry.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })

    expect(response.status).toBe(413)
    expect(pulls).toBeGreaterThanOrEqual(3)
    expect(fake.calls).toHaveLength(0)
  })

  test("rejects attached session subroutes outside the provider allowlist instead of running them locally", async () => {
    const api = app()
    const fake = provider("alpha", {
      route: () =>
        Effect.fail(
          new HostedFailure({ code: "invalid_request", message: "unsupported native route", retryable: false }),
        ),
    })
    const entry = attach(fake)

    const message = await api.request(`/session/${SESSION}/message/msg_1?workspace=${entry.id}`)
    expect(message.status).toBe(400)
    const rules = await api.request(`/permission/per_1/always-rules?workspace=${entry.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    expect(rules.status).toBe(400)
  })

  test("fails explicitly without local fallback for every unresolvable attachment", async () => {
    const api = app()
    const fake = provider("alpha")
    const missing = Attachments.createID()
    const unknown = await api.request(`/session/${SESSION}/message?workspace=${missing}`)
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ code: "unknown" })

    const disposed = attach(fake)
    Attachments.store.dispose(disposed.id)
    const gone = await api.request(`/session/${SESSION}/message?workspace=${disposed.id}`)
    expect(gone.status).toBe(410)
    expect(await gone.json()).toMatchObject({ code: "disposed" })

    const expired = attach(fake, OTHER)
    const found = Attachments.store.lookup(expired.id)
    if (found.kind !== "found") throw new Error("expected a live attachment")
    found.entry.leaseExpiresAt = 0
    const stale = await api.request(`/session/${OTHER}/message?workspace=${expired.id}`)
    expect(stale.status).toBe(410)
    expect(await stale.json()).toMatchObject({ code: "expired" })

    const unroutable = Attachments.store.mint({
      provider: { ...fake.value, route: undefined },
      session: hosted(fake.value.id, SESSION),
      expiresAt: Date.now() + 60_000,
    })
    const unavailable = await api.request(`/session/${SESSION}/message?workspace=${unroutable.id}`)
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({ code: "unavailable" })
    expect(fake.calls).toHaveLength(0)
  })

  test("keeps normal local routes local while an attachment selector is configured", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const api = app()
    const fake = provider("alpha")
    const entry = attach(fake)

    const response = await api.request(`/session?workspace=${entry.id}`, {
      headers: { "x-kilo-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    expect(fake.calls).toHaveLength(0)
  })

  test("keeps viewed and experimental workspace routes local with an attachment selector", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const api = app()
    const fake = provider("alpha")
    const entry = attach(fake)
    const viewed = await api.request(`/session/viewed?workspace=${entry.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kilo-directory": tmp.path },
      body: JSON.stringify({
        viewer: { id: "11111111-1111-4111-8111-111111111111", active: true },
        attached: [],
        visible: [],
      }),
    })
    const status = await api.request(`/experimental/workspace/status?workspace=${entry.id}`, {
      headers: { "x-kilo-directory": tmp.path },
    })

    expect(viewed.status).toBe(200)
    expect(status.status).toBe(200)
    expect(fake.calls).toHaveLength(0)
  })

  test("keeps hosting routes local even when the client carries an attachment selector", async () => {
    const api = app()
    const fake = provider("alpha")
    const entry = attach(fake)

    const response = await api.request(`/kilocode/session-host/provider?workspace=${entry.id}`, {
      headers: { "x-kilo-workspace": entry.id },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      providers: [
        {
          id: "kilo-cloud",
          default: true,
          availability: { state: "unavailable", reason: "signed_out", message: expect.any(String) },
          transport: { state: "unknown" },
        },
      ],
    })
    expect(fake.calls).toHaveLength(0)
  })

  test("renews a lapsed provider descriptor before routing without resolving membership again", async () => {
    const api = app()
    let attaches = 0
    let scans = 0
    const fake = provider("alpha", {
      attach: (input) => {
        attaches += 1
        return Effect.succeed({ session: input.id, expiresAt: Date.now() + 60_000 })
      },
      membership: () => {
        scans += 1
        return Effect.succeed(undefined)
      },
    })
    const entry = attach(fake, SESSION, 1)

    const response = await api.request(`/session/${SESSION}/todo?workspace=${entry.id}`)

    expect(response.status).toBe(200)
    expect(attaches).toBe(1)
    expect(scans).toBe(0)
    expect(fake.calls).toHaveLength(1)
  })

  test.each([
    { error: "KILO_SESSION_NOT_FOUND" },
    { code: "KILO_SESSION_NOT_FOUND" },
    { error: { code: "KILO_SESSION_NOT_FOUND", message: "not found" } },
    { error: { message: "not found", data: { code: "KILO_SESSION_NOT_FOUND" } } },
    { error: { json: { message: "not found", data: { code: "KILO_SESSION_NOT_FOUND" } } } },
  ])("disposes matching session attachments for deleted-session response %j", async (body) => {
    const api = app()
    const calls: NativeRequest[] = []
    const fake = provider("alpha", {
      route: (request) => {
        calls.push(request)
        return Effect.succeed(Response.json(body, { status: 404 }))
      },
    })
    const entry = Attachments.store.mint({
      provider: fake.value,
      session: hosted(fake.value.id, SESSION),
      expiresAt: Date.now() + 60_000,
    })
    const sibling = Attachments.store.mint({
      provider: fake.value,
      session: entry.session,
      expiresAt: Date.now() + 60_000,
    })
    const other = Attachments.store.mint({
      provider: fake.value,
      session: hosted(fake.value.id, OTHER),
      expiresAt: Date.now() + 60_000,
    })
    const beta = provider("beta")
    const foreign = Attachments.store.mint({
      provider: beta.value,
      session: hosted(beta.value.id, SESSION),
      expiresAt: Date.now() + 60_000,
    })

    const missing = await api.request(`/session/${SESSION}/message?workspace=${entry.id}`)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual(body)
    expect(Attachments.store.lookup(entry.id).kind).toBe("disposed")
    expect(Attachments.store.lookup(sibling.id).kind).toBe("disposed")
    expect(Attachments.store.lookup(other.id).kind).toBe("found")
    expect(Attachments.store.lookup(foreign.id).kind).toBe("found")

    const stale = await api.request(`/session/${SESSION}/message?workspace=${entry.id}`)
    expect(stale.status).toBe(410)
    expect(await stale.json()).toMatchObject({ code: "disposed" })
    const closed = await api.request(`/session/${SESSION}/message?workspace=${sibling.id}`)
    expect(closed.status).toBe(410)
    expect(calls).toHaveLength(1)
  })

  test.each(["route", "attach"] as const)(
    "disposes matching session attachments on provider %s not_found",
    async (mode) => {
      const api = app()
      const missing = () =>
        Effect.fail(new HostedFailure({ code: "not_found", message: "session deleted", retryable: false }))
      const fake = provider("alpha", mode === "route" ? { route: missing } : { attach: missing })
      const entry = Attachments.store.mint({
        provider: fake.value,
        session: hosted(fake.value.id, SESSION),
        expiresAt: mode === "attach" ? 1 : Date.now() + 60_000,
      })
      const sibling = Attachments.store.mint({
        provider: fake.value,
        session: entry.session,
        expiresAt: Date.now() + 60_000,
      })

      const response = await api.request(`/session/${SESSION}/message?workspace=${entry.id}`)
      expect(response.status).toBe(mode === "attach" ? 503 : 404)
      expect(Attachments.store.lookup(entry.id).kind).toBe("disposed")
      expect(Attachments.store.lookup(sibling.id).kind).toBe("disposed")

      const stale = await api.request(`/session/${SESSION}/message?workspace=${sibling.id}`)
      expect(stale.status).toBe(410)
    },
  )

  test("keeps matching attachments when a 404 is not a deleted-session response", async () => {
    const api = app()
    const fake = provider("alpha", {
      route: () => Effect.succeed(Response.json({ error: "MESSAGE_NOT_FOUND" }, { status: 404 })),
    })
    const entry = attach(fake)

    const response = await api.request(`/session/${SESSION}/message?workspace=${entry.id}`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "MESSAGE_NOT_FOUND" })
    expect(Attachments.store.lookup(entry.id).kind).toBe("found")
  })

  test("keeps matching attachments when a 404 body is not JSON and forwards it unchanged", async () => {
    const api = app()
    const body = "message not found"
    const fake = provider("alpha", {
      route: () => Effect.succeed(new Response(body, { status: 404, headers: { "content-type": "text/plain" } })),
    })
    const entry = attach(fake)

    const response = await api.request(`/session/${SESSION}/message?workspace=${entry.id}`)

    expect(response.status).toBe(404)
    expect(await response.text()).toBe(body)
    expect(Attachments.store.lookup(entry.id).kind).toBe("found")
  })

  test("keeps matching attachments when a deleted-session 404 body exceeds the inspection bound", async () => {
    const api = app()
    const body = { error: "KILO_SESSION_NOT_FOUND", padding: "x".repeat(MAX_BODY_BYTES) }
    const fake = provider("alpha", {
      route: () => Effect.succeed(Response.json(body, { status: 404 })),
    })
    const entry = attach(fake)

    const response = await api.request(`/session/${SESSION}/message?workspace=${entry.id}`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual(body)
    expect(Attachments.store.lookup(entry.id).kind).toBe("found")
  })

  test("streams the session-scoped event source without rewriting fence or resnapshot frames", async () => {
    const api = app()
    const encoder = new TextEncoder()
    const seen: NativeRequest[] = []
    const frames = [
      'data: {"payload":{"type":"kilo.native.fence","properties":{"generation":2,"fence":7}}}\n\n',
      ": keep-alive\n\n",
      'data: {"payload":{"type":"kilo.native.resnapshot","properties":{"reason":"overflow"}}}\n\n',
    ]
    const fake = provider("alpha", {
      route: (input) => {
        seen.push(input)
        return Effect.succeed(
          new Response(
            new ReadableStream({
              start(controller) {
                for (const frame of frames) controller.enqueue(encoder.encode(frame))
                controller.close()
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        )
      },
    })
    const entry = attach(fake)

    const response = await api.request(`/event?workspace=${entry.id}`, {
      headers: { accept: "text/event-stream", "last-event-id": "5" },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    expect(await response.text()).toBe(frames.join(""))
    expect(seen[0]?.path).toBe("/event")
    expect(seen[0]?.headers.get("last-event-id")).toBe("5")
  })
})
