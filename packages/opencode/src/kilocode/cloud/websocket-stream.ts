import { CloudError } from "./errors"

const COMPLETE_GRACE_PERIOD_MS = 3000
const DEFAULT_STREAM_TIMEOUT_MS = 30_000
const CLOSE_TIMEOUT_MS = 1000
const DRAIN_TIMEOUT_MS = 1000
// Measured via text.length (UTF-16 units), so queued string memory can reach
// roughly twice this for non-Latin-1 payloads; the goal is boundedness, not precision.
const MAX_QUEUED_BYTES = 8 * 1024 * 1024

export interface StreamAgentEventsOptions {
  readonly streamUrl: string
  readonly origin: string
  readonly writeLine: (line: string) => void | Promise<void>
  readonly WebSocket?: typeof WebSocket | undefined
  readonly timeoutMs?: number
}

export function streamAgentEvents(options: StreamAgentEventsOptions): Promise<void> {
  const resolved = (() => {
    try {
      return { url: resolveWebSocketUrl(options.streamUrl, options.origin) }
    } catch (error) {
      return { error }
    }
  })()
  if ("error" in resolved) return Promise.reject(resolved.error)
  const url = resolved.url
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket

  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url)
    let settled = false
    let completeTimer: ReturnType<typeof setTimeout> | undefined
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let pending: Promise<void> = Promise.resolve()
    let queued = 0
    let writeError = false
    let aborted = false

    function clear() {
      if (completeTimer !== undefined) {
        clearTimeout(completeTimer)
        completeTimer = undefined
      }
      if (closeTimer !== undefined) {
        clearTimeout(closeTimer)
        closeTimer = undefined
      }
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer)
        idleTimer = undefined
      }
    }

    function finish() {
      clear()
      if (settled) return
      settled = true
      void pending.then(() => {
        if (writeError) {
          reject(new CloudError("WebSocket stream output failed"))
          return
        }
        resolve()
      })
    }

    function fail(message: string) {
      clear()
      if (settled) return
      settled = true
      socket.close()
      const timeout = Math.min(options.timeoutMs ?? DRAIN_TIMEOUT_MS, DRAIN_TIMEOUT_MS)
      const timer = setTimeout(() => {
        aborted = true
        reject(new CloudError(writeError ? "WebSocket stream output failed" : message))
      }, timeout)
      void pending.then(() => {
        clearTimeout(timer)
        reject(new CloudError(writeError ? "WebSocket stream output failed" : message))
      })
    }

    function abort(message: string) {
      aborted = true
      clear()
      if (settled) return
      settled = true
      socket.close()
      reject(new CloudError(message))
    }

    function arm() {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => fail("WebSocket stream timed out"), options.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS)
    }

    function initiateClose() {
      if (settled) return
      try {
        socket.close(1000)
      } catch {
        finish()
        return
      }
      closeTimer = setTimeout(finish, CLOSE_TIMEOUT_MS)
    }

    arm()

    socket.onmessage = (event: MessageEvent) => {
      arm()
      if (settled) return
      const text = normalizeMessageData(event.data)
      if (queued >= MAX_QUEUED_BYTES) {
        abort("WebSocket stream output consumer is too slow")
        return
      }
      queued += text.length
      pending = pending
        .then(() => {
          if (aborted) return
          return options.writeLine(text)
        })
        .catch(() => {
          writeError = true
          abort("WebSocket stream output failed")
        })
        .finally(() => {
          queued -= text.length
        })
      if (isCompleteEvent(text) && completeTimer === undefined) {
        completeTimer = setTimeout(initiateClose, COMPLETE_GRACE_PERIOD_MS)
      }
    }

    socket.onerror = () => {
      fail("WebSocket stream connection failed")
    }

    socket.onclose = (event) => {
      if (event.code === 1000) return finish()
      fail(`WebSocket stream closed unexpectedly (${event.code})`)
    }
  })
}

function resolveWebSocketUrl(streamUrl: string, origin: string): string {
  let url: URL
  try {
    url = /^(?:wss?|https?):\/\//i.test(streamUrl) ? new URL(streamUrl) : new URL(streamUrl, origin)
  } catch {
    throw new CloudError("Invalid stream URL")
  }

  if (url.protocol === "http:") {
    url.protocol = "ws:"
  } else if (url.protocol === "https:") {
    url.protocol = "wss:"
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new CloudError("Invalid stream URL protocol")
  }

  const expected = new URL(origin)
  if (expected.protocol === "http:") {
    expected.protocol = "ws:"
  } else if (expected.protocol === "https:") {
    expected.protocol = "wss:"
  }
  if (url.origin !== expected.origin) {
    throw new CloudError("Invalid stream URL origin")
  }

  return url.toString()
}

function isCompleteEvent(text: string): boolean {
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null && parsed.streamEventType === "complete"
  } catch {
    return false
  }
}

function normalizeMessageData(data: unknown): string {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return new TextDecoder().decode(data)
  return String(data)
}
