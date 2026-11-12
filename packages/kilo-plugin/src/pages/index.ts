import type { KiloAccount } from "@kilocode/gateway-core"
import { Config } from "@opencode/core/config"
import { KiloConfigWriter } from "@opencode/core/kilocode/config/write"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloPagesRpc } from "@opencode/schema/kilocode/pages"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Context, Duration, Effect, Fiber, Layer, Option, Redacted, Semaphore, Stream, type Scope } from "effect"
import { KiloGatewayAccounts } from "../gateway/accounts"
import { PagesAuth } from "./auth"
import { PagesConfig } from "./config"
import { PagesToken } from "./token"

// The Pages plugin. It registers a remote `pages` MCP server while Pages is on, allowed and a Kilo token has been
// minted; the Authorization header is added per request by `PagesAuth.wrap`, which the host puts on the MCP transport.
// A connect refused with 401 or 403 is final and a plugin cannot reconnect a server, so the entry is removed in every
// state that is not ready and registered again when the state recovers.
const FAILURE_DELAYS_SECONDS = [30, 60, 120, 240, 300]
const FLAG_RETRY = Duration.minutes(10)
const SIGN_IN = { integrationID: "kilo", methodID: "device" } as const

type Snapshot = Pick<KiloPagesRpc.Status, "state" | "reason" | "retryAt">

export const KiloPagesPlugin = define<Global.Service | FSUtil.Service | Scope.Scope>({
  id: "kilocode.pages",
  effect: Effect.fn("KiloPagesPlugin")(function* (ctx) {
    const config = yield* Effect.serviceOption(Config.Service)
    if (Option.isNone(config)) return yield* Effect.die(new Error("Kilo Pages requires location config"))
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const writer = Context.get(
      yield* Layer.build(KiloConfigWriter.layer({ reload: config.value.reload?.() ?? Effect.void })),
      KiloConfigWriter.Service,
    )
    const directory = ctx.location.directory
    const deployment = PagesToken.DEFAULT
    const globalDirectory = yield* fs.resolve(global.config)

    const lock = Semaphore.makeUnsafe(1)
    const scope = yield* Effect.scope
    const handle = crypto.randomUUID()
    let closed = false
    let setting = false
    let current: Snapshot = { state: "starting" }
    // The entry is in the MCP config while the state is connecting or connected.
    let registered = false
    // The account the held token belongs to, so a state change can drop it.
    let held: Pick<KiloAccount.Info, "server" | "token"> | undefined
    // The key of the account the registered entry connected with.
    let connectedKey: string | undefined
    let failures = 0
    let timer: Fiber.Fiber<unknown, unknown> | undefined
    let emit: ((status: KiloPagesRpc.Status) => Effect.Effect<void, unknown>) | undefined
    let published = ""

    const view = (snapshot: Snapshot = current): KiloPagesRpc.Status => ({
      enabled: setting,
      ...snapshot,
      origin: deployment.origin,
      server: PagesConfig.SERVER,
      ...(snapshot.state === "signed_out" || snapshot.state === "needs_login" ? { signIn: SIGN_IN } : {}),
    })

    const latest = () => KiloGatewayAccounts.get(directory)

    // What the plugin knows without the network: the setting, policy and the user's own entry.
    const gate = Effect.gen(function* () {
      const entries = yield* config.value.entries()
      setting = PagesConfig.enabled(entries)
      if (PagesConfig.denied(entries)) return { state: "disabled", reason: "policy" } satisfies Snapshot
      if (!setting) return { state: "disabled", reason: "user" } satisfies Snapshot
      if (PagesConfig.manual(entries)) return { state: "manual" } satisfies Snapshot
    })

    const evaluate = (force: boolean) =>
      Effect.gen(function* () {
        const closedBy = yield* gate
        if (closedBy) return closedBy
        const account = latest()
        if (!account) return { state: KiloGatewayAccounts.registered(directory) ? "signed_out" : "starting" } satisfies Snapshot
        const same = held !== undefined && PagesToken.key(held, deployment) === PagesToken.key(account, deployment)
        // A different credential is a different account: forget the previous one's token, refusal and backoff now.
        if (held && !same) {
          PagesToken.drop(held, deployment)
          held = undefined
        }
        const cached = PagesToken.peek(account, deployment).kind
        // A token that is valid or simply expired does not need a mint now: the transport mints on demand.
        if (!force && same && registered && (cached === "valid" || cached === "none")) return current
        if (!force && same && current.state === "retrying" && (current.retryAt ?? 0) > Date.now()) return current
        const failure = yield* PagesToken.get({ account, deployment, version: ctx.app.version }).pipe(
          Effect.match({ onSuccess: () => undefined, onFailure: (failure) => failure }),
        )
        if (!failure) {
          held = account
          // A forced refresh of a live connection changes nothing: no reconnect follows, so no MCP event would move a
          // reported `connecting` back to `connected`.
          if (same && registered) return current
          return { state: "connecting" } satisfies Snapshot
        }
        if (failure.kind === "transient") {
          const entry = PagesToken.peek(account, deployment)
          return {
            state: "retrying",
            retryAt: entry.kind === "backoff" ? entry.retryAt : Date.now() + 30_000,
          } satisfies Snapshot
        }
        return refusal(failure.reason)
      })

    const apply = (next: Snapshot): Effect.Effect<void> =>
      Effect.gen(function* () {
        const ready = next.state === "connecting" || next.state === "connected"
        const key = ready && held ? PagesToken.key(held, deployment) : undefined
        // The connection belongs to the previous account: remove and add the entry so Pages starts a new session.
        const rekey = ready && registered && connectedKey !== undefined && connectedKey !== key
        if (!ready && held) {
          PagesToken.drop(held, deployment)
          held = undefined
        }
        current = next
        connectedKey = key
        if (rekey) {
          registered = false
          yield* ctx.mcp.reload()
        }
        const was = registered
        registered = ready
        if (was !== ready) yield* ctx.mcp.reload()
        yield* publish()
        yield* schedule(next)
      })

    const publish = () =>
      Effect.suspend(() => {
        const status = view()
        const key = JSON.stringify(status)
        if (!emit || key === published) return Effect.void
        published = key
        return emit(status).pipe(Effect.catch(() => Effect.void))
      })

    const schedule = (snapshot: Snapshot): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (timer) yield* Fiber.interrupt(timer)
        timer = undefined
        const delay =
          snapshot.state === "retrying"
            ? Duration.millis(Math.max(0, (snapshot.retryAt ?? Date.now()) - Date.now()))
            : snapshot.reason === "kilo_disabled"
              ? FLAG_RETRY
              : undefined
        if (!delay) return
        // The handle is cleared before the refresh: the refresh ends in `schedule`, which would otherwise interrupt
        // this very fiber and end the retry chain after one fire.
        timer = yield* Effect.sleep(delay).pipe(
          Effect.andThen(Effect.sync(() => void (timer = undefined))),
          Effect.andThen(refresh(false)),
          Effect.forkIn(scope),
        )
      })

    const refresh = (force: boolean): Effect.Effect<void> =>
      // A refresh that was queued or started before the finalizer must not mint or reload once the plugin is closed.
      lock
        .withPermit(Effect.suspend(() => (closed ? Effect.void : evaluate(force).pipe(Effect.flatMap(apply)))))
        .pipe(Effect.orDie)

    const settle = () => {
      if (!closed) Effect.runFork(refresh(false))
    }

    yield* ctx.mcp.transform((editor) => {
      if (!registered || editor.get(PagesConfig.SERVER)) return
      editor.set(PagesConfig.SERVER, {
        type: "remote",
        url: `${deployment.origin}/mcp`,
        oauth: false,
        headers: { [PagesAuth.HANDLE_HEADER]: handle },
      })
    })

    const unregister = PagesAuth.register(handle, {
      origin: deployment.origin,
      client: `kilo/${ctx.app.version}`,
      token: (rejected) => {
        const account = latest()
        if (!account || !registered) return Promise.resolve(undefined)
        return Effect.runPromise(
          PagesToken.get({ account, deployment, version: ctx.app.version, rejected }).pipe(
            Effect.match({
              onSuccess: (token) => token,
              onFailure: () => {
                // The wrapper gets no token; the state follows from what the cache now holds.
                settle()
                return undefined
              },
            }),
            Effect.map((token) => (token === undefined ? undefined : Redacted.value(token))),
          ),
        )
      },
    })

    const unsubscribe = KiloGatewayAccounts.subscribe(directory, settle)
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closed = true
        unregister()
        unsubscribe()
        if (held) PagesToken.drop(held, deployment)
        if (timer) yield* Fiber.interrupt(timer)
      }),
    )

    const globalTarget = { directory: globalDirectory, global: true } as const
    const write = (enabled: boolean) =>
      writer.write({ target: globalTarget, path: ["pages", "enabled"], value: enabled })

    const registration = yield* ctx.rpc
      .register(KiloPagesRpc.Definition, {
        status: () => Effect.sync(() => view()),
        enable: (_, context) =>
          config.value.entries().pipe(
            // Policy denial is refused before anything is persisted, so lifting it later cannot activate Pages unasked.
            Effect.flatMap((entries) => (PagesConfig.denied(entries) ? Effect.void : write(true))),
            Effect.andThen(refresh(true)),
            Effect.map(() => view()),
            Effect.catchTag("KiloConfigWriterError", (error) =>
              Effect.fail(context.error("failed", error.message, { message: error.message })),
            ),
          ),
        disable: (_, context) =>
          write(false).pipe(
            Effect.andThen(refresh(true)),
            Effect.map(() => view()),
            Effect.catchTag("KiloConfigWriterError", (error) =>
              Effect.fail(context.error("failed", error.message, { message: error.message })),
            ),
          ),
        ensureConnected: () =>
          Effect.suspend(() => {
            const account = latest()
            if (account) PagesToken.retry(account, deployment)
            return refresh(true).pipe(Effect.map(() => view()))
          }),
      })
      .pipe(Effect.orDie)
    emit = (status) => registration.events.emit("changed", status)

    // The MCP service reports when the server's connection settles; a failed connect removes the entry for a while.
    yield* ctx.event.subscribe({ types: ["config.updated"] }).pipe(
      Stream.runForEach(() => refresh(false)),
      Effect.ignore,
      Effect.forkScoped,
    )
    yield* ctx.event.subscribe({ types: ["mcp.status.changed"] }).pipe(
      Stream.filter((event) => event.data.server === PagesConfig.SERVER),
      Stream.runForEach(() =>
        lock.withPermit(
          Effect.gen(function* () {
            if (!registered) return
            const servers = yield* ctx.mcp.list()
            const status = servers.data.find((server) => server.name === PagesConfig.SERVER)?.status.status
            if (status === "connected") {
              failures = 0
              return yield* apply({ state: "connected" })
            }
            if (status !== "failed" && status !== "needs_auth") return
            const seconds = FAILURE_DELAYS_SECONDS[Math.min(failures++, FAILURE_DELAYS_SECONDS.length - 1)]!
            yield* apply({ state: "retrying", reason: "pages_rejected", retryAt: Date.now() + seconds * 1000 })
          }),
        ),
      ),
      Effect.ignore,
      Effect.forkScoped,
    )

    yield* refresh(false).pipe(Effect.forkScoped)
  }),
})

function refusal(reason: "needs_login" | "organization_credential" | "credential_type" | "blocked" | "kilo_disabled" | "server") {
  if (reason === "needs_login") return { state: "needs_login" } satisfies Snapshot
  if (reason === "blocked") return { state: "blocked" } satisfies Snapshot
  return { state: "unsupported", reason } satisfies Snapshot
}
