import type { Server } from "http"

const host = "127.0.0.1"

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

let active = host
let start: Promise<void> | null = null

export function parseHost(uri?: string): string {
  if (!uri) return host
  try {
    return new URL(uri).hostname || host
  } catch {
    return host
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
  const srv = deps.create()
  start = listen(srv, active, cfg.port).then(() => {
    deps.set({ server: srv, port: cfg.port, path: cfg.path })
    deps.info("oauth callback server started", { host: active, port: cfg.port, path: cfg.path })
  })

  try {
    await start
  } catch (err) {
    if (err instanceof Error && err.message.includes("already in use")) {
      deps.error("oauth callback bind failed: port already in use", { host: active, port: cfg.port, path: cfg.path })
    }
    throw err
  } finally {
    start = null
  }
}
