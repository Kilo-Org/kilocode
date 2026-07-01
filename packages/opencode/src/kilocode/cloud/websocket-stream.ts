import { CloudError } from "./errors"

const COMPLETE_GRACE_PERIOD_MS = 3000

export interface StreamAgentEventsOptions {
  readonly streamUrl: string
  readonly origin: string
  readonly writeLine: (line: string) => void
  readonly WebSocket?: typeof WebSocket | undefined
}

export function streamAgentEvents(options: StreamAgentEventsOptions): Promise<void> {
  const url = resolveWebSocketUrl(options.streamUrl, options.origin)
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket

  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url)
    let settled = false
    let completeTimer: ReturnType<typeof setTimeout> | undefined
    let closeTimer: ReturnType<typeof setTimeout> | undefined

    function finish() {
      if (completeTimer !== undefined) {
        clearTimeout(completeTimer)
        completeTimer = undefined
      }
      if (closeTimer !== undefined) {
        clearTimeout(closeTimer)
        closeTimer = undefined
      }
      if (!settled) {
        settled = true
        resolve()
      }
    }

    function initiateClose() {
      if (settled) return
      try {
        socket.close()
      } catch {
        finish()
        return
      }
      closeTimer = setTimeout(finish, 1000)
    }

    socket.onmessage = (event: MessageEvent) => {
      const text = normalizeMessageData(event.data)
      options.writeLine(text)
      if (isCompleteEvent(text) && completeTimer === undefined) {
        completeTimer = setTimeout(initiateClose, COMPLETE_GRACE_PERIOD_MS)
      }
    }

    socket.onerror = () => {
      if (!settled) {
        settled = true
        reject(new CloudError("WebSocket stream connection failed"))
      }
    }

    socket.onclose = () => finish()
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
