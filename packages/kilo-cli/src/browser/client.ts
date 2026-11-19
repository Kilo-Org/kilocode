// CLI side of the browser bridge: discover a hub, dial its socket, and speak JSON-RPC
// 2.0 through it. One connection state, one live socket, no replays after a drop.
import net from "node:net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { Log } from "./log"
import * as proto from "./protocol"
import { PeerLimit, decoder, encode, type Decoder } from "./frame"
import { Registry } from "./registry"
import { bin } from "./bin"
import * as pair from "./pair"

const log = Log.create({ service: "browser.client" })

const Backoff = { base: 250, max: 30_000 }
const RequestTimeout = 60_000
const DialTimeout = 5_000
const StartTimeout = 8_000
// The pairing page `pair()` reopens at most this often: long enough that a browser
// without the extension does not collect a tab per call, short enough that a user who
// just turned "Allow local agents" on is paired by the next call.
const PairAgain = 15_000

/**
 * Whether an extension may serve a client that selected `profile`. No selection accepts any profile; a selection
 * accepts only the profile it names, so a browser that reconnects as another one is refused instead of adopted.
 */
export function accepts(profile: string | undefined, extension: { profileLabel: string }) {
  return profile === undefined || extension.profileLabel === profile
}

export class HubError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(input: { code: number; message: string; data?: unknown }) {
    super(input.message)
    this.name = "HubError"
    this.code = input.code
    this.data = input.data
  }

  get kind() {
    return proto.errorName(this.code) ?? "rpc_error"
  }

  // The caller may retry these without asking anything new.
  get retryable() {
    return proto.retryable(this.code)
  }

  // The call may have reached the browser before the connection dropped.
  get uncertain() {
    const data = this.data
    return typeof data === "object" && data !== null && "effectsUncertain" in data && data.effectsUncertain === true
  }
}

export type State =
  | { kind: "idle" }
  | { kind: "connecting"; attempt: number }
  | { kind: "waiting"; hub: Registry.Entry }
  | { kind: "ready"; hub: Registry.Entry; extension: proto.ExtensionInfo }
  | { kind: "reconnecting"; attempt: number; reason: string }
  | { kind: "closed"; reason: string }

export type Client = {
  state(): State
  subscribe(listener: (state: State) => void): () => void
  ready(timeout?: number): Promise<proto.ExtensionInfo>
  call<M extends proto.Method>(
    method: M,
    params: proto.Params<M>,
    options?: { timeout?: number; signal?: AbortSignal },
  ): Promise<proto.Result<M>>
  notify(method: proto.Method, params?: unknown): void
  on<M extends proto.NotificationMethod>(method: M, listener: (params: proto.NotificationParams<M>) => void): () => void
  /**
   * Open the pairing page again for the unpaired loopback hub this client waits on, when the last one is older than
   * `PairAgain`: a page the extension ignored (its switch was off, or it was installed later) cannot pair the hub
   * any more. Resolves true once a page was opened; false when none was due, one is still being opened, or opening it
   * failed (no opener on the host), so a caller never waits for a page that does not exist.
   */
  pair(): Promise<boolean>
  session: {
    open(params: proto.Params<"session.open">): Promise<proto.Result<"session.open">>
    close(params: proto.Params<"session.close">): Promise<proto.Result<"session.close">>
    adopt(params: proto.Params<"session.adopt">): Promise<proto.Result<"session.adopt">>
    shareActiveTab(params: proto.Params<"session.shareActiveTab">): Promise<proto.Result<"session.shareActiveTab">>
  }
  tools: {
    list(): Promise<proto.Result<"tools.list">>
    call(
      params: proto.Params<"tools.call">,
      options?: { timeout?: number; signal?: AbortSignal },
    ): Promise<proto.Result<"tools.call">>
  }
  upload: {
    begin(params: proto.Params<"upload.begin">): Promise<proto.Result<"upload.begin">>
    chunk(params: proto.Params<"upload.chunk">): Promise<proto.Result<"upload.chunk">>
    end(params: proto.Params<"upload.end">): Promise<proto.Result<"upload.end">>
  }
  close(reason?: string): void
}

export type Input = {
  // Port for the pairing URL and for a detached hub this client starts.
  port?: number
  timeout?: number
  // Run directory override (sockets and the registry live under it); tests point
  // it at a temp dir.
  dir?: string
  // Only dial a hub whose connected extension reports this profile label. A profile
  // the user selected is never replaced by whichever extension connects first, so a
  // client with a profile does not start a hub of its own.
  profile?: string
  // Replaces the detached-hub spawn in tests or in hosts that manage processes.
  start?: () => void
  // Replaces the command `bin()` builds for the detached hub (tests spawn a script
  // that exits immediately to exercise the early-exit path).
  command?: string[]
  // Replaces the system opener for the pairing page (VS Code passes openExternal).
  opener?: pair.Opener
  // How long a pairing page stays current before `pair()` opens another
  // (default `PairAgain`); tests shorten it.
  pairAgain?: number
}

type Waiter = {
  settle(extension: proto.ExtensionInfo): void
  fail(error: Error): void
}

type Pending = {
  settle(error: HubError | undefined, value?: unknown): void
}

type Link = {
  socket: net.Socket
  hub: Registry.Entry
  frames: Decoder
  pending: Map<string, Pending>
  next: number
}

export function create(input: Input = {}): Client {
  const listeners = new Set<(state: State) => void>()
  const handlers = new Map<string, Set<(params: unknown) => void>>()
  const waiters = new Set<Waiter>()
  const backoff = { level: 0 }
  const lifecycle = {
    closed: false,
    retry: undefined as NodeJS.Timeout | undefined,
    tried: false,
    // Bumped by close() so a connect() that resumes after an await cannot install a
    // socket into a closed client.
    generation: 0,
    // True while a connect() attempt is awaiting the registry, so a retry scheduled
    // from inside that attempt (the asynchronous spawn error) cannot start a second
    // one and dial the same hub twice.
    active: false,
    // Set by the spawn error handler; the attempt that spawned the hub consumes it
    // and schedules the retry itself instead of waiting out StartTimeout.
    failed: false,
    // The child this attempt spawned, cleared when the attempt (or the child) ends.
    child: undefined as ChildProcess | undefined,
  }
  // Hubs whose pairing page this client has already opened, and when, so a hub that
  // keeps reporting hub.waiting is surfaced once per start; `pair()` reopens a stale one.
  const pairing = new Map<string, number>()
  // Hubs whose pairing page is being asked for or opened right now, so two callers never open two tabs.
  const opening = new Set<string>()

  let state: State = { kind: "idle" }
  let link: Link | undefined

  function set(next: State) {
    state = next
    for (const listener of listeners) listener(next)
  }

  function abort(active: Link, reason: string) {
    for (const pending of active.pending.values()) {
      pending.settle(
        new HubError({
          code: proto.ErrorCodes.browser_unavailable,
          message: `The browser connection dropped: ${reason}`,
          data: { effectsUncertain: true },
        }),
      )
    }
    active.pending.clear()
  }

  function detach(reason: string) {
    const active = link
    if (!active) return
    link = undefined
    abort(active, reason)
    active.socket.destroy()
    schedule(reason)
  }

  function schedule(reason: string) {
    if (lifecycle.closed) return
    clearTimeout(lifecycle.retry)
    backoff.level = Math.min(backoff.level + 1, 10)
    const delay = Math.min(Backoff.max, Backoff.base * 2 ** (backoff.level - 1))
    set({ kind: "reconnecting", attempt: backoff.level, reason })
    const generation = lifecycle.generation
    lifecycle.retry = setTimeout(() => {
      if (generation !== lifecycle.generation) return
      void connect()
    }, delay)
    lifecycle.retry.unref()
  }

  function dispatch(method: string, params: unknown) {
    const registered = handlers.get(method)
    if (!registered) return
    for (const handler of registered) handler(params)
  }

  function receive(active: Link, value: unknown) {
    // Frames that arrive after this socket was replaced belong to an older attempt.
    if (active !== link) return
    const envelope = proto.HubToCli.safeParse(value)
    if (!envelope.success) {
      log.warn("closing the hub connection after an invalid frame", { issues: envelope.error.issues })
      detach("invalid frame from the hub")
      return
    }
    if (envelope.data.type === "hub.waiting") {
      // A live hub that is waiting is reachable, so a later outage may need its own
      // start attempt again.
      lifecycle.tried = false
      backoff.level = 0
      // The extension transport is gone, so a request already routed to it can only be
      // answered by the instance that received it. Fail those now with effectsUncertain
      // rather than leave every caller waiting out RequestTimeout; on the first attach
      // the map is empty, so this is a no-op.
      abort(active, "the extension went away")
      set({ kind: "waiting", hub: active.hub })
      void maybePair(active.hub, active)
      return
    }
    if (envelope.data.type === "hub.ready") {
      // A selected profile is a constraint on the browser, not only on the hub it was dialled through: an extension
      // that reconnects with another profile must not serve this client's session tabs.
      if (!accepts(input.profile, envelope.data.extension)) {
        log.warn("the extension reports another profile than the one selected", {
          profile: input.profile,
          reported: envelope.data.extension.profileLabel,
        })
        detach("the extension reported another browser profile")
        return
      }
      backoff.level = 0
      lifecycle.tried = false
      set({ kind: "ready", hub: active.hub, extension: envelope.data.extension })
      for (const waiter of waiters) waiter.settle(envelope.data.extension)
      waiters.clear()
      return
    }
    const message = envelope.data.message
    if (proto.isNotification(message)) {
      // `Notifications` is a plain object literal, so a method the extension invents
      // (`constructor`, `toString`, `__proto__`) would resolve to an inherited
      // Object.prototype member instead of undefined and throw out of this reader.
      const known = Object.hasOwn(proto.Notifications, message.method)
        ? proto.Notifications[message.method as proto.NotificationMethod]
        : undefined
      const parsed = known === undefined ? undefined : known.safeParse(message.params)
      dispatch(message.method, parsed?.success ? parsed.data : message.params)
      return
    }
    if (!proto.isResponse(message)) return
    if (!proto.valid(message)) {
      log.warn("closing the hub connection after an empty response")
      detach("the hub sent an empty response")
      return
    }
    const pending = active.pending.get(String(message.id))
    // A response to a request from an earlier socket is dropped, never applied.
    if (!pending) return
    active.pending.delete(String(message.id))
    if (message.error) {
      pending.settle(
        new HubError({ code: message.error.code, message: message.error.message, data: message.error.data }),
      )
      return
    }
    pending.settle(undefined, message.result)
  }

  async function dial(entry: Registry.Entry): Promise<Link | undefined> {
    const socket = net.createConnection(entry.socket)
    socket.setNoDelay(true)
    const opened = Promise.withResolvers<void>()
    const timer = setTimeout(() => opened.reject(new Error("timed out dialing the hub")), DialTimeout)
    socket.once("connect", opened.resolve)
    socket.once("error", opened.reject)
    const reachable = await opened.promise
      .then(() => true)
      .catch((error) => {
        log.info("cannot reach a hub", { socket: entry.socket, error })
        return false
      })
    clearTimeout(timer)
    if (!reachable) {
      socket.destroy()
      return undefined
    }
    // The decoder closes over the link it belongs to, so it is built first and the
    // link is filled in before any data can arrive.
    const ref: { link?: Link } = {}
    const frames = decoder({
      limit: PeerLimit,
      onFrame: (value) => {
        if (ref.link) receive(ref.link, value)
      },
      onError: (error) => {
        log.warn("hub framing error", { error })
        socket.destroy()
      },
    })
    const active: Link = { socket, hub: entry, frames, pending: new Map(), next: 1 }
    ref.link = active
    socket.on("data", (chunk) => active.frames.push(chunk))
    socket.on("error", (error) => log.warn("hub socket error", { error }))
    socket.on("close", () => {
      if (active !== link) return
      detach("the hub closed the connection")
    })
    return active
  }

  // The registry lives one level below the run dir, next to the sockets.
  const hubs = () => (input.dir === undefined ? undefined : path.join(input.dir, "hubs"))

  async function discover() {
    for (const entry of await Registry.list({ dir: hubs() })) {
      // A selected profile is a constraint: a hub whose extension reports another one is not a fallback for it.
      if (input.profile !== undefined && entry.profileLabel !== input.profile) continue
      const active = await dial(entry)
      if (active) return active
    }
    return undefined
  }

  // A loopback hub that has never completed a handshake cannot be paired on its own:
  // the CLI asks the hub for a pairing URL over this socket, and the URL carries a
  // single-use token instead of the durable key, because the opener's argv is visible
  // to every local process. Open that page once per hub process, and again only when `pair()` asks.
  async function maybePair(entry: Registry.Entry, active: Link): Promise<boolean> {
    if (entry.mode !== "loopback" || entry.paired) return false
    if (pairing.has(entry.hubId) || opening.has(entry.hubId)) return false
    pairing.set(entry.hubId, Date.now())
    opening.add(entry.hubId)
    try {
      const answer = proto.HubRequests["pairing.url"].result.parse(await rpc(active, "pairing.url", {}))
      const port = entry.port ?? input.port ?? proto.DefaultPort
      await pair.open(answer.url, { opener: input.opener })
      log.info("opened the browser pairing page", { hubId: entry.hubId, port })
      return true
    } catch (error) {
      log.warn("cannot open the browser pairing page", { error, hubId: entry.hubId })
      return false
    } finally {
      opening.delete(entry.hubId)
    }
  }

  function start() {
    // One detached start per outage: retries poll the registry instead of spawning
    // a process every backoff step.
    if (lifecycle.tried) return
    lifecycle.tried = true
    if (input.start) {
      // A host-provided starter can throw synchronously (a missing executable, a
      // host that refuses to spawn). Keep it retryable: the flag goes back, and the
      // connect() that called this schedules the next attempt, which runs the hook
      // again instead of polling an empty registry forever.
      try {
        input.start()
      } catch (error) {
        lifecycle.tried = false
        throw error
      }
      return
    }
    // Same shape as the daemon: a detached process with no inherited stdio, and
    // windowsHide so no console window flashes.
    const cmd = input.command ?? bin()
    const child = spawn(
      cmd[0],
      [...cmd.slice(1), "browser", "hub", "--loopback", "--port", String(input.port ?? proto.DefaultPort)],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, ...(input.dir === undefined ? {} : { KILO_BROWSER_RUN_DIR: input.dir }) },
      },
    )
    lifecycle.child = child
    // spawn reports a missing or non-executable command asynchronously, while the
    // connect() that spawned it is still polling the registry. A child that starts
    // and then dies before a hub registers (bad arguments, port taken, crash) is the
    // same outage. The child stays tracked until it registers or exits, so an exit
    // after the attempt ended still resets the self-start guard; whichever attempt
    // runs next consumes the flag.
    const restart = (detail: { error?: unknown; code?: number | null; signal?: string | null }) => {
      if (lifecycle.child !== child) return
      lifecycle.child = undefined
      log.warn("a detached loopback hub did not start", detail)
      lifecycle.tried = false
      lifecycle.failed = true
    }
    child.on("error", (error) => restart({ error }))
    child.on("exit", (code, signal) => restart({ code, signal }))
    child.unref()
  }

  async function waitForHub(deadline: number) {
    while (Date.now() < deadline) {
      // The detached start already failed; there is nothing to wait for.
      if (lifecycle.failed) return undefined
      const found = (await Registry.list({ dir: hubs() })).find((entry) => entry.mode === "loopback")
      if (found) return found
      await Bun.sleep(100)
    }
    log.warn("a detached loopback hub did not register in time")
    return undefined
  }

  async function connect() {
    // Single-flight: the retry timer can fire while this attempt is still polling
    // the registry, and that attempt schedules its own retry when it ends.
    if (lifecycle.closed || lifecycle.active) return
    lifecycle.active = true
    const generation = lifecycle.generation
    const current = () => !lifecycle.closed && generation === lifecycle.generation
    try {
      set({ kind: "connecting", attempt: backoff.level + 1 })
      const found = await discover()
      if (!current()) {
        found?.socket.destroy()
        return
      }
      if (found) {
        lifecycle.tried = false
        lifecycle.failed = false
        lifecycle.child = undefined
        link = found
        return
      }
      // A selected profile only exists on a hub its extension already paired with; a hub this CLI starts would serve
      // whichever extension connects to it, which is exactly what the profile excludes.
      if (input.profile !== undefined) {
        schedule(`no browser profile labelled ${input.profile} is connected`)
        return
      }
      lifecycle.failed = false
      start()
      const entry = await waitForHub(Date.now() + StartTimeout)
      if (!current()) return
      if (lifecycle.failed) {
        lifecycle.failed = false
        schedule("cannot start the browser hub")
        return
      }
      const started = entry === undefined ? undefined : await dial(entry)
      if (!current()) {
        started?.socket.destroy()
        return
      }
      if (started) {
        lifecycle.tried = false
        lifecycle.failed = false
        lifecycle.child = undefined
        link = started
        return
      }
      schedule("no hub is reachable")
    } catch (error) {
      log.warn("cannot connect to a browser hub", { error })
      if (current()) schedule("cannot connect to the browser hub")
    } finally {
      lifecycle.active = false
      // The child stays tracked past the attempt: a hub that registers and exits a
      // moment later still has to reset the self-start guard, otherwise every later
      // attempt skips start() and polls an empty registry.
    }
  }

  // `active` is passed rather than read from `link`: the pairing ask runs from the
  // frame reader, and a socket that was replaced meanwhile must not receive it.
  function rpc(
    active: Link | undefined,
    method: string,
    params: unknown,
    options?: { timeout?: number; signal?: AbortSignal },
  ) {
    if (!active) {
      return Promise.reject(
        new HubError({
          code: proto.ErrorCodes.browser_unavailable,
          message: "The browser is not available right now.",
        }),
      )
    }
    // A cancelled turn stops waiting for the answer; the browser may already have
    // acted on the request, so the caller is told the effects are uncertain.
    if (options?.signal?.aborted) {
      return Promise.reject(
        new HubError({
          code: proto.ErrorCodes.browser_unavailable,
          message: `The browser call was cancelled before it was sent.`,
        }),
      )
    }
    const id = active.next++
    const timeout = options?.timeout ?? input.timeout ?? RequestTimeout
    const deferred = Promise.withResolvers<unknown>()
    let timer: NodeJS.Timeout | undefined
    const signal = options?.signal
    const cancel = () => {
      if (!active.pending.delete(String(id))) return
      pending.settle(
        new HubError({
          code: proto.ErrorCodes.browser_unavailable,
          message: `The browser call was cancelled while it was running.`,
          data: { effectsUncertain: true },
        }),
      )
    }
    const pending: Pending = {
      settle(error, value) {
        clearTimeout(timer)
        signal?.removeEventListener("abort", cancel)
        if (error) deferred.reject(error)
        else deferred.resolve(value)
      },
    }
    timer = setTimeout(() => {
      if (!active.pending.delete(String(id))) return
      // Silence is not proof that the browser did nothing, so the caller must look
      // at the page before retrying.
      pending.settle(
        new HubError({
          code: proto.ErrorCodes.browser_unavailable,
          message: `The browser did not answer ${method} within ${timeout}ms.`,
          data: { effectsUncertain: true },
        }),
      )
    }, timeout)
    signal?.addEventListener("abort", cancel, { once: true })
    active.pending.set(String(id), pending)
    active.socket.write(encode({ type: "rpc", message: { jsonrpc: "2.0", id, method, params } }))
    return deferred.promise
  }

  const client: Client = {
    state() {
      return state
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ready(timeout = 10_000) {
      if (state.kind === "ready") return Promise.resolve(state.extension)
      if (state.kind === "closed") return Promise.reject(new Error(state.reason))
      const deferred = Promise.withResolvers<proto.ExtensionInfo>()
      const waiter: Waiter = { settle: deferred.resolve, fail: deferred.reject }
      waiters.add(waiter)
      const timer = setTimeout(() => {
        waiters.delete(waiter)
        deferred.reject(
          new HubError({ code: proto.ErrorCodes.browser_unavailable, message: "The browser is not connected." }),
        )
      }, timeout)
      deferred.promise.finally(() => clearTimeout(timer)).catch(() => undefined)
      return deferred.promise
    },
    async call(method, params, options) {
      const value = await rpc(link, method, params, options)
      // The schema above validated this exact value, so the boundary cast is sound.
      return proto.Requests[method].result.parse(value) as proto.Result<typeof method>
    },
    notify(method, params) {
      if (!link) return
      link.socket.write(encode({ type: "rpc", message: { jsonrpc: "2.0", method, params } }))
    },
    on(method, listener) {
      const registered = handlers.get(method) ?? new Set<(params: unknown) => void>()
      // Notification payloads are validated on arrival; only the handler's declared
      // method narrows the shape further.
      const entry = listener as (params: unknown) => void
      registered.add(entry)
      handlers.set(method, registered)
      return () => registered.delete(entry)
    },
    async pair() {
      const active = link
      if (state.kind !== "waiting" || !active) return false
      const entry = active.hub
      if (entry.mode !== "loopback" || entry.paired || opening.has(entry.hubId)) return false
      const opened = pairing.get(entry.hubId)
      if (opened !== undefined && Date.now() - opened < (input.pairAgain ?? PairAgain)) return false
      pairing.delete(entry.hubId)
      return maybePair(entry, active)
    },
    session: {
      open: (params) => client.call("session.open", params),
      close: (params) => client.call("session.close", params),
      adopt: (params) => client.call("session.adopt", params),
      shareActiveTab: (params) => client.call("session.shareActiveTab", params),
    },
    tools: {
      list: () => client.call("tools.list", {}),
      call: (params, options) => client.call("tools.call", params, options),
    },
    upload: {
      begin: (params) => client.call("upload.begin", params),
      chunk: (params) => client.call("upload.chunk", params),
      end: (params) => client.call("upload.end", params),
    },
    close(reason = "The caller closed the connection.") {
      if (lifecycle.closed) return
      lifecycle.closed = true
      // Any connect() still awaiting sees a different generation and stops without
      // installing its socket.
      lifecycle.generation += 1
      clearTimeout(lifecycle.retry)
      const active = link
      link = undefined
      if (active) {
        for (const pending of active.pending.values()) {
          pending.settle(new HubError({ code: proto.ErrorCodes.browser_unavailable, message: reason }))
        }
        active.pending.clear()
        active.socket.destroy()
      }
      for (const waiter of waiters) waiter.fail(new Error(reason))
      waiters.clear()
      set({ kind: "closed", reason })
    },
  }

  void connect()
  return client
}
