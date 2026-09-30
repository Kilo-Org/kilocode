import { request, type IncomingMessage, type Server } from "http"

const host = "127.0.0.1"

// The callback port is a machine-wide singleton: a second `kilo mcp auth` for the same
// server cannot bind it while the first attempt waits for its browser tab. The newer
// attempt asks the process that holds the listener to stand down, takes the port, and the
// replaced flow is reported by name instead of waiting for a callback that cannot arrive.
const TAKEOVER_QUERY = "kilo_callback_takeover"
export const TAKEOVER_HEADER = "x-kilo-oauth-callback"
export const TAKEOVER_VALUE = "released"
const TAKEOVER_TIMEOUT_MS = 2_000
const TAKEOVER_RETRY_MS = 100
const TAKEOVER_ATTEMPTS = 20
const REPLACED = "this request was replaced by another authorization attempt"

type State = {
  server: Server | undefined
  port: number
  path: string
}

type Deps = {
  redirectUri?: string
  parse: (uri?: string) => { port: number; path: string }
  state: () => State
  set: (state: State) => void
  create: () => Server
  stop: () => Promise<void>
  info: (msg: string, data?: Record<string, unknown>) => void
  error: (msg: string, data?: Record<string, unknown>) => void
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"])

let active = host
let start: Promise<void> | null = null

function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.startsWith("[") ? value.slice(1, value.indexOf("]")) : value.split(":")[0]
}

export function parseHost(uri?: string): string {
  if (!uri) return host
  try {
    return new URL(uri).hostname || host
  } catch {
    return host
  }
}

/** The reason a flow reports when a newer attempt took its callback listener over. */
export function replaced(): Error {
  const err = new Error(REPLACED)
  err.name = "AuthorizationReplacedError"
  return err
}

export function isReplaced(error: unknown): boolean {
  return error instanceof Error && error.name === "AuthorizationReplacedError"
}

/**
 * True when a request proves it asks this process to hand its callback listener over. The
 * takeover header makes it a non-simple request: a browser must clear a CORS preflight first,
 * and this listener never answers one, so a cross-origin GET from a web page cannot release an
 * authorization that is in flight. A DNS-rebinding page is same-origin with the listener as the
 * browser sees it, so the header alone does not prove the caller is a Kilo process: the request
 * must also address this listener's own host (or a loopback name), never the rebound name.
 */
export function isTakeoverRequest(req: IncomingMessage, url: URL): boolean {
  if (url.searchParams.get(TAKEOVER_QUERY) !== "1") return false
  const name = hostOf(req.headers.host)
  if (!name || (name !== hostOf(active) && !LOOPBACK.has(name))) return false
  const header = req.headers[TAKEOVER_HEADER]
  return (Array.isArray(header) ? header[0] : header) === TAKEOVER_VALUE
}

/** The URL a newer attempt sends to ask the holder of the listener to release it. */
export function takeoverUrl(host: string, port: number, path: string): string {
  return `http://${host}:${port}${path}?${TAKEOVER_QUERY}=1`
}

/**
 * Ask the process that holds the callback listener to release it. A listener that does not
 * answer with the takeover header (an older Kilo build, or an unrelated program on the
 * port) is left alone, so the caller keeps reporting the port as occupied.
 */
export function takeover(host: string, port: number, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      {
        host,
        port,
        path: `${path}?${TAKEOVER_QUERY}=1`,
        method: "GET",
        timeout: TAKEOVER_TIMEOUT_MS,
        headers: { connection: "close", [TAKEOVER_HEADER]: TAKEOVER_VALUE },
      },
      (res) => {
        const released = res.headers[TAKEOVER_HEADER] === TAKEOVER_VALUE
        res.resume()
        res.once("end", () => resolve(released))
        res.once("error", () => resolve(false))
      },
    )
    req.once("error", () => resolve(false))
    req.once("timeout", () => req.destroy(new Error("oauth callback takeover timed out")))
    req.end()
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function occupied(error: unknown): boolean {
  return error instanceof Error && error.message.includes("already in use")
}

async function bind(deps: Deps, host: string, cfg: { port: number; path: string }): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const srv = deps.create()
    try {
      await listen(srv, host, cfg.port)
    } catch (err) {
      if (!occupied(err) || attempt >= TAKEOVER_ATTEMPTS) throw err
      if (attempt === 0) {
        if (!(await takeover(host, cfg.port, cfg.path))) throw err
        deps.info("took over the oauth callback listener from another Kilo attempt", {
          host,
          port: cfg.port,
          path: cfg.path,
        })
      }
      await delay(TAKEOVER_RETRY_MS)
      continue
    }
    deps.set({ server: srv, port: cfg.port, path: cfg.path })
    deps.info("oauth callback server started", { host, port: cfg.port, path: cfg.path })
    return
  }
}

export function listen(srv: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (err: Error & { code?: string }) => {
      srv.off("error", fail)
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `OAuth callback port ${port} is already in use. Close the other Kilo process or configure a different MCP OAuth redirect URI, then retry.`,
          ),
        )
        return
      }
      reject(err)
    }

    srv.once("error", fail)
    srv.listen(port, host, () => {
      srv.off("error", fail)
      resolve()
    })
  })
}

export async function ensureRunning(deps: Deps): Promise<void> {
  const cfg = deps.parse(deps.redirectUri)
  const nextHost = parseHost(deps.redirectUri)

  if (start) await start

  const state = deps.state()
  if (state.server && (active !== nextHost || state.port !== cfg.port || state.path !== cfg.path)) {
    deps.info("stopping oauth callback server to reconfigure", {
      oldHost: active,
      oldPort: state.port,
      newHost: nextHost,
      newPort: cfg.port,
    })
    await deps.stop()
  }

  if (deps.state().server) return

  active = nextHost
  start = bind(deps, active, cfg).finally(() => {
    start = null
  })

  try {
    await start
  } catch (err) {
    if (occupied(err)) {
      deps.error("oauth callback bind failed: port already in use", { host: active, port: cfg.port, path: cfg.path })
    }
    throw err
  }
}
