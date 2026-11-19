import type { OpenCodeClient } from "@opencode/client"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import type { TerminalTransport } from "../terminal/socket"

function output(frame: { binary: boolean; data: string }) {
  if (frame.binary) {
    const bytes = Uint8Array.from(atob(frame.data), (v) => v.charCodeAt(0))
    return bytes[0] === 0 ? undefined : bytes.buffer
  }
  if (frame.data.startsWith("\0")) return
  if (frame.data.startsWith("{")) {
    try {
      const value = JSON.parse(frame.data)
      if (value && Object.keys(value).length === 1 && ["string", "number"].includes(typeof value.cursor)) return
    } catch {
      // Shell output starting with a brace is still ordinary terminal text.
    }
  }
  return frame.data
}

export function cloudTerminal(
  api: OpenCodeClient,
  directory: string,
  target: KiloHostedRpc.Target,
  onError: (error: unknown, stopped: boolean, opened?: boolean) => void,
  onReady?: () => void,
) {
  const rpc = api.rpc(KiloHostedRpc.Definition)
  const options = { location: { directory } }
  let dimensions = { cols: 80, rows: 24 }
  let fit: (() => void) | undefined
  return {
    resize(cols: number, rows: number) {
      const width = Math.max(2, Math.min(cols, 500))
      const height = Math.max(2, Math.min(rows, 200))
      if (width === dimensions.cols && height === dimensions.rows) return
      dimensions = { cols: width, rows: height }
      fit?.()
    },
    connect(): TerminalTransport {
      const life = new AbortController()
      let handle: string | undefined
      const warn = (error: unknown) => {
        if (!life.signal.aborted) onError(error, false)
      }
      let writes = Promise.resolve()
      const socket: TerminalTransport = {
        readyState: 0,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send(data) {
          if (typeof data !== "string" || !handle) return
          const id = handle
          writes = writes
            .then(async () => {
              if (!life.signal.aborted)
                await rpc.terminalWrite({ target, handle: id, data }, { ...options, signal: life.signal })
            })
            .catch(warn)
        },
        close() {
          if (life.signal.aborted) return
          life.abort()
          fit = undefined
          socket.readyState = 3
          const id = handle
          handle = undefined
          if (id) void rpc.terminalClose({ target, handle: id }, options).catch(() => {})
        },
      }
      void (async () => {
        const initial = dimensions
        const result = await rpc.terminalOpen({ target, ...initial }, options)
        if (life.signal.aborted) {
          await rpc.terminalClose({ target, handle: result.handle }, options)
          return
        }
        handle = result.handle
        fit = () =>
          void rpc
            .terminalResize({ target, handle: result.handle, ...dimensions }, { ...options, signal: life.signal })
            .catch(warn)
        if (initial !== dimensions) fit()
        while (!life.signal.aborted) {
          const page = await rpc.terminalRead({ target, handle: result.handle }, { ...options, signal: life.signal })
          if (life.signal.aborted) return
          if (page.state === "open" && socket.readyState === 0) {
            socket.readyState = 1
            socket.onopen?.()
            onReady?.()
          }
          for (const frame of page.frames) {
            const data = output(frame)
            if (data !== undefined) socket.onmessage?.({ data })
          }
          if (page.state === "closed") {
            onError(undefined, true, socket.readyState === 1)
            socket.close()
            socket.onclose?.({ code: 1000, reason: "" })
            return
          }
        }
      })().catch((error) => {
        if (life.signal.aborted) return
        onError(error, true, socket.readyState === 1)
        socket.close()
        socket.onerror?.()
        socket.onclose?.({ code: 1006, reason: "" })
      })
      return socket
    },
  }
}
