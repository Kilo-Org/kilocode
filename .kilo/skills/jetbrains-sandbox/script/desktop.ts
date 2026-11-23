import type { Socket } from "bun"
import { realpath, stat } from "node:fs/promises"
import { resolve, sep } from "node:path"

const VIEW = resolve(import.meta.dir, "../view")
const NOVNC = "/usr/share/novnc"
const MAX_SESSIONS = 8
const MAX_CHUNKS = 32 * 1024 * 1024
const MAX_INPUT = 2 * 1024 * 1024
const MAX_BODY = 1024 * 1024
const IDLE = 60_000
const HOLD = 200

type State = {
  id: string
  socket?: Socket<State>
  chunks: Uint8Array[]
  size: number
  output: Uint8Array[]
  bytes: number
  pending?: ReturnType<typeof Promise.withResolvers<void>>
  timer?: ReturnType<typeof setTimeout>
  closed: boolean
  seen: number
}

function reply(body: BodyInit | null, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("Cache-Control", "no-store")
  headers.set("Referrer-Policy", "no-referrer")
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("X-Frame-Options", "DENY")
  return new Response(body, { ...init, headers })
}

function same(req: Request, trusted?: string) {
  const origin = req.headers.get("origin")
  if (origin == null) return true
  if (trusted !== undefined && origin === trusted) return true
  if (origin === "null" || !URL.canParse(origin)) return false
  return new URL(origin).host === req.headers.get("host")
}

async function asset(root: string, path: string, head: boolean) {
  if (path.includes("\0") || path.includes("\\")) return
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return
  const rel = decoded.replace(/^\/+/, "")
  if (!rel || rel.split("/").some((part) => part === "." || part === "..")) return
  const base = resolve(root)
  const target = resolve(base, rel)
  if (!target.startsWith(base + sep)) return
  const [info, real, rootReal] = await Promise.all([
    stat(target).catch(() => undefined),
    realpath(target).catch(() => undefined),
    realpath(base).catch(() => undefined),
  ])
  if (!info?.isFile() || !real || !rootReal) return
  if (real !== rootReal && !real.startsWith(rootReal + sep)) return
  const file = Bun.file(target)
  return reply(head ? null : file, { headers: { "Content-Type": file.type || "application/octet-stream" } })
}

export function desktop(opts: { host: string; port: number; vnc: number; novnc?: string; origin?: string }) {
  const root = resolve(opts.novnc ?? NOVNC)
  const sessions = new Map<string, State>()

  function drop(state: State) {
    if (state.closed) return
    state.closed = true
    if (state.timer !== undefined) clearTimeout(state.timer)
    state.timer = undefined
    const pending = state.pending
    state.pending = undefined
    const socket = state.socket
    state.socket = undefined
    state.chunks = []
    state.size = 0
    state.output = []
    state.bytes = 0
    sessions.delete(state.id)
    pending?.resolve()
    socket?.end()
  }

  function flush(state: State) {
    if (state.closed || !state.socket) return
    while (state.output.length) {
      const chunk = state.output.at(0)
      if (!chunk) return
      const size = state.socket.write(chunk)
      if (size <= 0) return
      state.bytes -= size
      if (size < chunk.length) {
        state.output[0] = chunk.subarray(size)
        return
      }
      state.output.shift()
    }
  }

  const sweep = setInterval(() => {
    const now = Date.now()
    for (const state of sessions.values()) if (now - state.seen > IDLE) drop(state)
  }, 15_000)

  const server = Bun.serve({
    hostname: opts.host,
    port: opts.port,
    maxRequestBodySize: MAX_BODY,
    async fetch(req) {
      if (req.method !== "GET" && req.method !== "HEAD" && !same(req, opts.origin)) {
        return reply("Origin denied", { status: 403 })
      }
      const path = new URL(req.url).pathname
      if (path === "/" || path === "/http.js") {
        if (req.method !== "GET" && req.method !== "HEAD") return reply("Method denied", { status: 405 })
        const found = await asset(VIEW, path === "/" ? "index.html" : "http.js", req.method === "HEAD")
        return found ?? reply("Not found", { status: 404 })
      }
      if (path.startsWith("/core/") || path.startsWith("/vendor/")) {
        if (req.method !== "GET" && req.method !== "HEAD") return reply("Method denied", { status: 405 })
        const found = await asset(root, path, req.method === "HEAD")
        return found ?? reply("Not found", { status: 404 })
      }
      if (path === "/channel") {
        if (req.method !== "POST") return reply("Method denied", { status: 405 })
        if (sessions.size >= MAX_SESSIONS) return reply("Too many viewers", { status: 429 })
        const state: State = {
          id: crypto.randomUUID(),
          chunks: [],
          size: 0,
          output: [],
          bytes: 0,
          closed: false,
          seen: Date.now(),
        }
        sessions.set(state.id, state)
        try {
          const socket = await Bun.connect<State>({
            hostname: "127.0.0.1",
            port: opts.vnc,
            data: state,
            socket: {
              data(socket, chunk) {
                const state = socket.data
                if (state.closed) return
                state.chunks.push(Uint8Array.from(chunk))
                state.size += chunk.byteLength
                if (state.size > MAX_CHUNKS) {
                  drop(state)
                  return
                }
                const pending = state.pending
                if (!pending) return
                state.pending = undefined
                if (state.timer !== undefined) clearTimeout(state.timer)
                state.timer = undefined
                pending.resolve()
              },
              drain(socket) {
                flush(socket.data)
              },
              close(socket) {
                drop(socket.data)
              },
              error(socket, err) {
                console.error("VNC transport socket failed", err)
                drop(socket.data)
              },
            },
          })
          if (state.closed) {
            socket.end()
            return reply("Desktop unavailable", { status: 502 })
          }
          state.socket = socket
        } catch (err) {
          drop(state)
          console.error("VNC connect failed", err)
          return reply("Desktop unavailable", { status: 502 })
        }
        return reply(JSON.stringify({ id: state.id }), {
          headers: { "Content-Type": "application/json" },
        })
      }
      if (!path.startsWith("/channel/")) return reply("Not found", { status: 404 })
      const state = sessions.get(path.slice("/channel/".length))
      if (!state || state.closed) return reply("Session closed", { status: 410 })
      state.seen = Date.now()
      if (req.method === "DELETE") {
        drop(state)
        return reply(null, { status: 204 })
      }
      if (req.method === "POST") {
        const bytes = new Uint8Array(await req.arrayBuffer())
        if (!bytes.byteLength) return reply(null, { status: 204 })
        if (state.bytes + bytes.byteLength > MAX_INPUT) {
          drop(state)
          return reply("Input queue exceeded", { status: 413 })
        }
        state.output.push(bytes)
        state.bytes += bytes.byteLength
        flush(state)
        return reply(null, { status: 204 })
      }
      if (req.method !== "GET") return reply("Method denied", { status: 405 })
      if (state.pending) return reply("Read already pending", { status: 409 })
      if (!state.size) {
        const pending = Promise.withResolvers<void>()
        state.pending = pending
        state.timer = setTimeout(() => {
          if (state.pending !== pending) return
          state.pending = undefined
          state.timer = undefined
          pending.resolve()
        }, HOLD)
        await pending.promise
      }
      if (state.closed) return reply("Session closed", { status: 410 })
      if (!state.size) return reply(null, { status: 204 })
      const bytes = Buffer.concat(state.chunks, state.size)
      state.chunks = []
      state.size = 0
      return reply(bytes, { headers: { "Content-Type": "application/octet-stream" } })
    },
    error(err) {
      console.error("Desktop server error", err)
      return reply("Desktop server error", { status: 500 })
    },
  })

  let stopped = false
  async function stop() {
    if (stopped) return
    stopped = true
    clearInterval(sweep)
    for (const state of sessions.values()) drop(state)
    await server.stop(true)
  }

  return { server, close: stop }
}
