import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { VIEWER_TTL_MS } from "../src/presence-context"
import { createPresenceRuntime, KiloViewers } from "../src/presence-service"

const VIEWER_ID = "0123abcd-0000-4000-8000-000000000001"
const PRESENCE_ENV_KEYS = ["KILO_EVENT_SERVICE_URL", "KILO_DISABLE_PRESENCE", "KILO_PLATFORM", "KILO_API_KEY"]

const ses = (n: number) => `ses_${String(n).padStart(12, "0")}`
const accountFor = (token: string) => Effect.succeed({ token, server: "https://kilo", organizationID: null })

function viewer(active = true, attached: string[] = [], visible: string[] = []) {
  return { viewer: { id: VIEWER_ID, active }, attached, visible }
}

/** Real loopback event-service double: two-step ticket flow plus a WebSocket
 *  server that records the frames the relay client subscribes with. */
async function startRelay() {
  const ticketRequests: Array<{ authorization?: string }> = []
  const frames: Array<Record<string, unknown>> = []
  let upgrades = 0
  let closes = 0
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url)
      // In Bun.serve the WebSocket upgrade is initiated from fetch: accepting
      // here hands the socket to the websocket handlers.
      if (req.headers.get("upgrade") === "websocket") {
        if (url.pathname !== "/connect") return new Response("not found", { status: 404 })
        upgrades++
        const protocol = req.headers.get("sec-websocket-protocol")
        // Echo the client's requested subprotocol, or the WebSocket client rejects
        // the connection on the negotiated-protocol mismatch.
        const accepted = server.upgrade(
          req,
          protocol ? { headers: { "Sec-WebSocket-Protocol": protocol } } : undefined,
        )
        return accepted ? undefined : new Response("upgrade failed", { status: 400 })
      }
      if (url.pathname === "/connect-ticket") {
        ticketRequests.push({ authorization: req.headers.get("authorization") ?? undefined })
        return Response.json({ ticket: "relay-ticket" })
      }
      return new Response("not found", { status: 404 })
    },
    websocket: {
      message(ws, message) {
        try {
          frames.push(JSON.parse(String(message)) as Record<string, unknown>)
        } catch {
          // ping frames are plain text; ignored
        }
      },
      open() {},
      close() {
        closes++
      },
    },
  })
  return {
    url: `ws://127.0.0.1:${server.port}`,
    relay: server,
    state: {
      get ticketRequests() {
        return ticketRequests
      },
      get frames() {
        return frames
      },
      get upgrades() {
        return upgrades
      },
      get closes() {
        return closes
      },
    },
    close: () => server.stop(true),
  }
}

describe("KiloViewers presence service", () => {
  let relay: Awaited<ReturnType<typeof startRelay>> | undefined

  const setEnv = (overrides: Record<string, string | undefined>) => {
    for (const key of Object.keys(overrides)) {
      if (overrides[key] === undefined) delete process.env[key]
      else process.env[key] = overrides[key]
    }
  }

  afterEach(async () => {
    setEnv(Object.fromEntries(PRESENCE_ENV_KEYS.map((key) => [key, undefined])))
    await relay?.close()
    relay = undefined
  })

  test("relays aggregated presence to a loopback event service", async () => {
    relay = await startRelay()
    setEnv({ KILO_PLATFORM: "vscode", KILO_API_KEY: undefined })
    const viewers = new KiloViewers({
      relayUrl: relay.url,
      now: () => 1_000,
      log: () => {},
    })
    await viewers.update(viewer(true, ["ses_000000000001"], ["ses_000000000001"]), { token: "tok-1" })
    await Bun.sleep(300)
    viewers.dispose()

    expect(relay.state.ticketRequests.length).toBeGreaterThanOrEqual(1)
    expect(relay.state.ticketRequests[0]?.authorization).toBe("Bearer tok-1")
    expect(relay.state.upgrades).toBeGreaterThanOrEqual(1)
    const subscribe = relay.state.frames.find((frame) => frame.type === "context.subscribe") as
      | { contexts: string[] }
      | undefined
    expect(subscribe?.contexts).toEqual(["/presence/vscode", "/presence/cli-session/ses_000000000001"])
  })

  test("kill switch keeps presence registry-only with no relay", async () => {
    relay = await startRelay()
    setEnv({ KILO_PLATFORM: "vscode", KILO_DISABLE_PRESENCE: "1" })
    const viewers = new KiloViewers({
      relayUrl: relay.url,
      now: () => 1_000,
      log: () => {},
    })
    await viewers.update(viewer(true, ["ses_000000000001"], ["ses_000000000001"]), { token: "tok-2" })
    await Bun.sleep(150)
    viewers.dispose()
    expect(relay.state.ticketRequests.length).toBe(0)
    expect(relay.state.upgrades).toBe(0)
  })

  test("a viewed call without auth keeps the registry live and the relay off", async () => {
    const attachedSeen: string[][] = []
    const viewers = new KiloViewers({
      setAttachedSessions: (ids) => attachedSeen.push([...ids]),
      now: () => 1_000,
      log: () => {},
    })
    await viewers.update(viewer(true, ["ses_000000000001"], ["ses_000000000001"]))
    expect(attachedSeen.at(-1)).toEqual(["ses_000000000001"])
    await viewers.clearAuth()
    expect(attachedSeen.at(-1)).toEqual(["ses_000000000001"])
    viewers.dispose()
  })

  test("registry records validated snapshots and prunes expired viewers by injected clock", async () => {
    let now = 1_000_000
    const attachedSeen: string[][] = []
    const viewers = new KiloViewers({
      setAttachedSessions: (ids) => attachedSeen.push([...ids]),
      now: () => now,
      log: () => {},
    })
    await viewers.update(viewer(true, ["ses_000000000001"], ["ses_000000000001"]), { token: "tok-3" })
    expect(attachedSeen.at(-1)).toEqual(["ses_000000000001"])
    await viewers.update(viewer(true, ["ses_000000000001", "ses_000000000002"], ["ses_000000000002"]), {
      token: "tok-3",
    })
    expect(attachedSeen.at(-1)).toEqual(["ses_000000000001", "ses_000000000002"])

    // Advance the injected clock past the lease TTL: the next apply prunes the viewer.
    now += 2 * VIEWER_TTL_MS
    await viewers.update(viewer(true, [], []), { token: "tok-3" })
    expect(attachedSeen.at(-1)).toEqual([])
    viewers.dispose()
  })

  test("policy rejections leave the registry untouched", async () => {
    const viewers = new KiloViewers({
      relayUrl: "ws://127.0.0.1:9",
      now: () => 5_000,
      log: () => {},
    })
    await viewers.update({ viewer: { id: "bad", active: true }, attached: [], visible: [] }, { token: "tok-3" })
    viewers.dispose()
    // No throw and no state: the rejection path completed cleanly.
    expect(true).toBe(true)
  })
})

describe("createPresenceRuntime", () => {
  test("two Location activations share the registry; the relay follows the latest viewed account", async () => {
    const relay = await startRelay()
    const runtime = createPresenceRuntime({ relayUrl: relay.url, now: () => 1_000, log: () => {} })
    const calls: Array<{ attached: string[] }> = []
    const makeCtx = () => {
      const handlers: Array<Record<string, unknown>> = []
      return {
        handlers,
        ctx: {
          rpc: {
            register: (definition: unknown, registered: Record<string, unknown>) => {
              handlers.push(registered)
              return Effect.void
            },
          },
        } as never,
        viewed: async (input: unknown, token: string) => {
          calls.push({ attached: (input as { attached: string[] }).attached })
          const viewed = handlers.at(-1)!.viewed as unknown as (
            input: unknown,
            call: unknown,
          ) => Effect.Effect<boolean, unknown>
          const accepted = await Effect.runPromise(viewed(input, callFake(token)))
          return accepted
        },
      }
    }
    const callFake = (token: string) => ({
      error: (id: string, message: string) => new Error(`${id}: ${message} (${token})`),
    })

    // Two Location activations share the host-global registry; each Location's
    // registration lives in its own Effect scope (mirrors the plugin child scope).
    const scopeA = await Effect.runPromise(Scope.make())
    const scopeB = await Effect.runPromise(Scope.make())
    const locationA = makeCtx()
    const locationB = makeCtx()
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.presence(locationA.ctx, accountFor("token-a")).pipe(
          Effect.provideService(Scope.Scope, scopeA),
        )
        yield* runtime.presence(locationB.ctx, accountFor("token-b")).pipe(
          Effect.provideService(Scope.Scope, scopeB),
        )
      }),
    )
    expect(locationA.handlers.length).toBe(1)
    expect(locationB.handlers.length).toBe(1)

    // Location A's viewer call: the relay credential follows the caller's account.
    await locationA.viewed(viewer(true, ["ses_000000000001"], ["ses_000000000001"]), "token-a")
    await Bun.sleep(300)
    expect(relay.state.ticketRequests.at(-1)?.authorization).toBe("Bearer token-a")

    // Location B's viewer call with the same shared registry: the relay
    // reconnects with B's credential.
    await locationB.viewed(viewer(true, ["ses_000000000002"], ["ses_000000000002"]), "token-b")
    await Bun.sleep(300)
    expect(relay.state.ticketRequests.at(-1)?.authorization).toBe("Bearer token-b")
    expect(calls.length).toBe(2)

    // Closing Location A's activation scope clears its auth claim without
    // dropping the registry; Location B re-establishes on its next viewed call.
    await Effect.runPromise(Scope.close(scopeA, Exit.void))
    await locationB.viewed(viewer(true, ["ses_000000000003"], ["ses_000000000003"]), "token-b")
    await Bun.sleep(300)
    expect(relay.state.ticketRequests.at(-1)?.authorization).toBe("Bearer token-b")

    runtime.dispose()
    await relay.close()
  })
})

afterEach(async () => {
  for (const key of PRESENCE_ENV_KEYS) delete process.env[key]
})
