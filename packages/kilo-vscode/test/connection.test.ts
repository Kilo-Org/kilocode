import { expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { launch } from "../../kilo-cli/src/interactive-server"
import type { Layout } from "../../kilo-cli/src/paths"
import { fixture } from "../../kilo-cli/test/fixture"
import { ConnectV2Error, connectV2 } from "../src/connection"

function interactiveLayout(root: string, home: string): Layout {
  const paths = {
    home,
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}

// Loopback negative controls: v1-shaped, malformed, and not-ready health
// responses plus a never-responding one for the bounded timeout.
function stub(handler: (path: string) => Response | Promise<Response>) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => handler(new URL(request.url).pathname),
  })
}

const jsonStub = (status: number, body: unknown) =>
  stub((path) => (path === "/api/health" ? Response.json(body, { status }) : new Response(null, { status: 404 })))

test("connectV2 verifies an explicit loopback v2 host and exposes a working session client", async () => {
  await using input = await fixture()
  const location = { directory: process.cwd() }
  const layout = interactiveLayout(path.join(input.directory, "ide-handshake"), input.home)
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch(layout, { models: false, recover: false })
        const verified = yield* Effect.promise(() =>
          connectV2({ url: server.url, password: server.auth.password }),
        )
        // The host runs in this test process, so the health pid is ours.
        expect(verified.health).toEqual({ healthy: true, version: expect.any(String), pid: process.pid })
        expect(typeof verified.health.version).toBe("string")
        // The verified client admits sessions through the v2 API only.
        const session = yield* Effect.promise(() =>
          verified.client.session.create({ title: "IDE handshake fixture", location }),
        )
        const listed = yield* Effect.promise(() => verified.client.session.list())
        expect(listed.data.some((item) => item.id === session.id)).toBe(true)
      }),
    ),
  )
}, 30_000)

test("connectV2 refuses a wrong explicit credential before any session admission", async () => {
  await using input = await fixture()
  const layout = interactiveLayout(path.join(input.directory, "ide-handshake-auth"), input.home)
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch(layout, { models: false, recover: false })
        let failure: ConnectV2Error | undefined
        yield* Effect.promise(async () => {
          try {
            await connectV2({ url: server.url, password: "wrong-password" })
            throw new Error("connectV2 unexpectedly succeeded")
          } catch (cause) {
            failure = cause as ConnectV2Error
          }
        })
        expect(failure).toBeInstanceOf(ConnectV2Error)
        expect(failure?.reason).toBe("unauthorized")
        // The refusal attempted no admission: the correctly authenticated view
        // of the same host still sees zero sessions.
        const direct = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
        const listed = yield* Effect.promise(() => direct.client.session.list())
        expect(listed.data).toHaveLength(0)
      }),
    ),
  )
}, 30_000)

test("connectV2 rejects a v1-shaped server: health on /global/health, no v2 route", async () => {
  const v1 = stub((path) =>
    path === "/global/health" ? Response.json({ healthy: true, version: "1.17.11" }) : new Response(null, { status: 404 }),
  )
  try {
    let failure: ConnectV2Error | undefined
    try {
      await connectV2({ url: v1.url.origin, password: "fixture" })
      throw new Error("connectV2 unexpectedly succeeded")
    } catch (cause) {
      failure = cause as ConnectV2Error
    }
    expect(failure).toBeInstanceOf(ConnectV2Error)
    expect(failure?.reason).toBe("incompatible")
  } finally {
    await v1.stop(true)
  }
})

test("connectV2 rejects a v1 health shape that lacks pid even on the v2 route", async () => {
  const legacyShape = jsonStub(200, { healthy: true, version: "1.17.11" })
  try {
    let failure: ConnectV2Error | undefined
    try {
      await connectV2({ url: legacyShape.url.origin, password: "fixture" })
      throw new Error("connectV2 unexpectedly succeeded")
    } catch (cause) {
      failure = cause as ConnectV2Error
    }
    expect(failure).toBeInstanceOf(ConnectV2Error)
    expect(failure?.reason).toBe("malformed")
  } finally {
    await legacyShape.stop(true)
  }
})

test("connectV2 rejects malformed health bodies without exposing a session client", async () => {
  const wrongPid = jsonStub(200, { healthy: true, version: "2.0.0", pid: "424242" })
  try {
    let failure: ConnectV2Error | undefined
    try {
      await connectV2({ url: wrongPid.url.origin, password: "fixture" })
      throw new Error("connectV2 unexpectedly succeeded")
    } catch (cause) {
      failure = cause as ConnectV2Error
    }
    expect(failure?.reason).toBe("malformed")

    const notJson = stub((path) => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }))
    try {
      await connectV2({ url: notJson.url.origin, password: "fixture" })
      throw new Error("connectV2 unexpectedly succeeded")
    } catch (cause) {
      expect((cause as ConnectV2Error).reason).toBe("malformed")
    } finally {
      await notJson.stop(true)
    }
  } finally {
    await wrongPid.stop(true)
  }
})

test("connectV2 classifies a not-ready v2 server as unavailable, not incompatible", async () => {
  const starting = jsonStub(503, { healthy: true, version: "0.0.1", pid: 424242 })
  try {
    let failure: ConnectV2Error | undefined
    try {
      await connectV2({ url: starting.url.origin, password: "fixture" })
      throw new Error("connectV2 unexpectedly succeeded")
    } catch (cause) {
      failure = cause as ConnectV2Error
    }
    expect(failure?.reason).toBe("unavailable")
  } finally {
    await starting.stop(true)
  }
})

test("connectV2 honors the bounded connection timeout", async () => {
  const holding = stub((path) =>
    path === "/api/health" ? new Promise<Response>(() => {}) : new Response(null, { status: 404 }),
  )
  try {
    let failure: ConnectV2Error | undefined
    try {
      await connectV2({ url: holding.url.origin, password: "fixture", timeoutMs: 150 })
      throw new Error("connectV2 unexpectedly succeeded")
    } catch (cause) {
      failure = cause as ConnectV2Error
    }
    expect(failure?.reason).toBe("timeout")
  } finally {
    // The stub holds a request open forever: a force stop is fire-and-forget
    // here, since awaiting it can wait out the abandoned request.
    void holding.stop(true)
  }
})

test("connectV2 refuses non-loopback targets before any request", async () => {
  let failure: ConnectV2Error | undefined
  try {
    await connectV2({ url: "http://example.com:8080", password: "fixture" })
    throw new Error("connectV2 unexpectedly succeeded")
  } catch (cause) {
    failure = cause as ConnectV2Error
  }
  expect(failure).toBeInstanceOf(ConnectV2Error)
  expect(failure?.reason).toBe("loopback")
})

// Board 150: a redirect must never carry the handshake credential to another
// target — the refusal happens without the redirect target ever being hit.
test("connectV2 refuses a health redirect and never touches the redirect target", async () => {
  let targetHits = 0
  const target = stub(() => Response.json({ healthy: true, version: "2.0.0", pid: 1 }))
  const redirector = stub((path) => {
    if (path !== "/api/health") return new Response(null, { status: 404 })
    return new Response(null, { status: 302, headers: { location: new URL("/api/health", target.url).toString() } })
  })
  try {
    let failure: ConnectV2Error | undefined
    try {
      await connectV2({ url: redirector.url.origin, password: "fixture" })
      throw new Error("connectV2 unexpectedly succeeded")
    } catch (cause) {
      failure = cause as ConnectV2Error
    }
    expect(failure).toBeInstanceOf(ConnectV2Error)
    expect(failure?.reason).toBe("incompatible")
  } finally {
    await redirector.stop(true)
    await target.stop(true)
  }
  expect(targetHits).toBe(0)
})

// Board 158: the bound covers headers AND the body read — a server that sends
// health headers and then hangs the body cannot outlive it.
test("connectV2 keeps the bound through the health body read", async () => {
  const hangBody = stub((path) => {
    if (path !== "/api/health") return new Response(null, { status: 404 })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"))
        // Never close: the body hangs after the headers are sent.
      },
    })
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } })
  })
  try {
    let failure: ConnectV2Error | undefined
    try {
      await connectV2({ url: hangBody.url.origin, password: "fixture", timeoutMs: 150 })
      throw new Error("connectV2 unexpectedly succeeded")
    } catch (cause) {
      failure = cause as ConnectV2Error
    }
    expect(failure?.reason).toBe("timeout")
  } finally {
    void hangBody.stop(true)
  }
})

// Board 158: an already-aborted caller signal is honored before any request.
test("connectV2 honors an already-aborted caller signal immediately", async () => {
  const controller = new AbortController()
  controller.abort()
  const started = Date.now()
  let failure: ConnectV2Error | undefined
  try {
    // A closed port: without the immediate honor, the fetch would spend its
    // own connection-refused path instead of refusing instantly.
    await connectV2({ url: "http://127.0.0.1:59999", password: "fixture", signal: controller.signal })
    throw new Error("connectV2 unexpectedly succeeded")
  } catch (cause) {
    failure = cause as ConnectV2Error
  }
  expect(failure).toBeInstanceOf(ConnectV2Error)
  expect(failure?.reason).toBe("timeout")
  expect(Date.now() - started).toBeLessThan(1000)
})
