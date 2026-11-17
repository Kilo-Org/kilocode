// CLI side of the browser bridge: discover a hub, dial its socket, and speak JSON-RPC
// 2.0 through it. One connection state, one live socket, no replays after a drop.
import net from "node:net"
import path from "path"
import { spawn } from "child_process"
import { Log } from "@opencode-ai/core/util/log"
import * as proto from "./protocol"
import { PeerLimit, decoder, encode, type Decoder } from "./frame"
import { Registry } from "./registry"
import { bin } from "./bin"

const log = Log.create({ service: "browser.client" })

const Backoff = { base: 250, max: 30_000 }
const RequestTimeout = 60_000
const DialTimeout = 5_000
const StartTimeout = 8_000

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
  call<M extends proto.Method>(method: M, params: proto.Params<M>, options?: { timeout?: number }): Promise<proto.Result<M>>
  notify(method: proto.Method, params?: unknown): void
  on<M extends proto.NotificationMethod>(method: M, listener: (params: proto.NotificationParams<M>) => void): () => void
  session: {
    open(params: proto.Params<"session.open">): Promise<proto.Result<"session.open">>
    close(params: proto.Params<"session.close">): Promise<proto.Result<"session.close">>
    adopt(params: proto.Params<"session.adopt">): Promise<proto.Result<"session.adopt">>
    shareActiveTab(params: proto.Params<"session.shareActiveTab">): Promise<proto.Result<"session.shareActiveTab">>
  }
  tools: {
    list(): Promise<proto.Result<"tools.list">>
    call(params: proto.Params<"tools.call">): Promise<proto.Result<"tools.call">>
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
  // Replaces the detached-hub spawn in tests or in hosts that manage processes.
  start?: () => void
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
  const lifecycle = { closed: false, retry: undefined as NodeJS.Timeout | undefined, tried: false }

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
    backoff.level = Math.min(backoff.level + 1, 10)
    const delay = Math.min(Backoff.max, Backoff.base * 2 ** (backoff.level - 1))
    set({ kind: "reconnecting", attempt: backoff.level, reason })
    lifecycle.retry = setTimeout(() => void connect(), delay)
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
      set({ kind: "waiting", hub: active.hub })
      return
    }
    if (envelope.data.type === "hub.ready") {
      backoff.level = 0
      lifecycle.tried = false
      set({ kind: "ready", hub: active.hub, extension: envelope.data.extension })
      for (const waiter of waiters) waiter.settle(envelope.data.extension)
      waiters.clear()
      return
    }
    const message = envelope.data.message
    if (proto.isNotification(message)) {
      const known = proto.Notifications[message.method as proto.NotificationMethod]
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
      pending.settle(new HubError({ code: message.error.code, message: message.error.message, data: message.error.data }))
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
      const active = await dial(entry)
      if (active) return active
    }
    return undefined
  }

  function start() {
    // One detached start per outage: retries poll the registry instead of spawning
    // a process every backoff step.
    if (lifecycle.tried) return
    lifecycle.tried = true
    if (input.start) {
      input.start()
      return
    }
    // Same shape as the daemon: a detached process with no inherited stdio, and
    // windowsHide so no console window flashes.
    const cmd = bin()
    const child = spawn(cmd[0], [...cmd.slice(1), "browser-hub", "--loopback", "--port", String(input.port ?? proto.DefaultPort)], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, ...(input.dir === undefined ? {} : { KILO_BROWSER_RUN_DIR: input.dir }) },
    })
    child.unref()
  }

  async function waitForHub(deadline: number) {
    while (Date.now() < deadline) {
      const found = (await Registry.list({ dir: hubs() })).find((entry) => entry.mode === "loopback")
      if (found) return found
      await Bun.sleep(100)
    }
    log.warn("a detached loopback hub did not register in time")
    return undefined
  }

  async function connect() {
    if (lifecycle.closed) return
    set({ kind: "connecting", attempt: backoff.level + 1 })
    const found = await discover()
    if (found) {
      link = found
      return
    }
    start()
    const entry = await waitForHub(Date.now() + StartTimeout)
    const started = entry === undefined ? undefined : await dial(entry)
    if (started) {
      link = started
      return
    }
    schedule("no hub is reachable")
  }

  function rpc(method: string, params: unknown, options?: { timeout?: number }) {
    const active = link
    if (!active) {
      return Promise.reject(
        new HubError({ code: proto.ErrorCodes.browser_unavailable, message: "The browser is not available right now." }),
      )
    }
    const id = active.next++
    const timeout = options?.timeout ?? input.timeout ?? RequestTimeout
    const deferred = Promise.withResolvers<unknown>()
    let timer: NodeJS.Timeout | undefined
    const pending: Pending = {
      settle(error, value) {
        clearTimeout(timer)
        if (error) deferred.reject(error)
        else deferred.resolve(value)
      },
    }
    timer = setTimeout(() => {
      if (!active.pending.delete(String(id))) return
      // Silence is not proof that the browser did nothing, so the caller must look
      // at the page before retrying.
      deferred.reject(
        new HubError({
          code: proto.ErrorCodes.browser_unavailable,
          message: `The browser did not answer ${method} within ${timeout}ms.`,
          data: { effectsUncertain: true },
        }),
      )
    }, timeout)
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
      deferred.promise
        .finally(() => clearTimeout(timer))
        .catch(() => undefined)
      return deferred.promise
    },
    async call(method, params, options) {
      const value = await rpc(method, params, options)
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
    session: {
      open: (params) => client.call("session.open", params),
      close: (params) => client.call("session.close", params),
      adopt: (params) => client.call("session.adopt", params),
      shareActiveTab: (params) => client.call("session.shareActiveTab", params),
    },
    tools: {
      list: () => client.call("tools.list", {}),
      call: (params) => client.call("tools.call", params),
    },
    upload: {
      begin: (params) => client.call("upload.begin", params),
      chunk: (params) => client.call("upload.chunk", params),
      end: (params) => client.call("upload.end", params),
    },
    close(reason = "The caller closed the connection.") {
      if (lifecycle.closed) return
      lifecycle.closed = true
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
