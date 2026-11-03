/**
 * WebSocket-like terminal transport over the Agent Manager message channel.
 *
 * The extension host owns the real PTY socket and relays its frames, so the
 * webview never opens a network connection and needs no ticket URL. This
 * adapter mirrors the small `WebSocket` surface `TerminalTab` uses:
 * `binaryType`, `readyState`, `send`, `close` and the `on*` handlers.
 */

import type { InMessage, VSCodeContext } from "../v2/bridge"

/** The Agent Manager channel of `useBridge`, narrowed to what the socket needs. */
export type TerminalSocketChannel = Pick<VSCodeContext, "postMessage" | "onMessage">

export interface TerminalSocketMessageEvent {
  data: string | ArrayBuffer
}

export interface TerminalSocketCloseEvent {
  code: number
  reason: string
}

export class TerminalSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  binaryType: "blob" | "arraybuffer" = "blob"
  readyState = TerminalSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: TerminalSocketMessageEvent) => void) | null = null
  onclose: ((event: TerminalSocketCloseEvent) => void) | null = null
  onerror: (() => void) | null = null

  private readonly socketId = `socket:${crypto.randomUUID()}`
  private unsubscribe: (() => void) | undefined

  constructor(
    private readonly channel: TerminalSocketChannel,
    terminalId: string,
  ) {
    this.unsubscribe = channel.onMessage((message) => this.receive(message))
    channel.postMessage({ type: "agentManager.terminal.socket.open", socketId: this.socketId, terminalId })
  }

  send(data: string | Uint8Array): void {
    if (this.readyState !== TerminalSocket.OPEN) return
    this.channel.postMessage({ type: "agentManager.terminal.socket.send", socketId: this.socketId, data })
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === TerminalSocket.CLOSED || this.readyState === TerminalSocket.CLOSING) return
    this.readyState = TerminalSocket.CLOSING
    this.channel.postMessage({ type: "agentManager.terminal.socket.close", socketId: this.socketId, code, reason })
  }

  private receive(message: InMessage) {
    if (message.type === "agentManager.terminal.socket.opened") {
      if (message.socketId !== this.socketId) return
      this.readyState = TerminalSocket.OPEN
      this.onopen?.()
      return
    }
    if (message.type === "agentManager.terminal.socket.message") {
      if (message.socketId !== this.socketId) return
      this.onmessage?.({ data: raw(message.data) })
      return
    }
    if (message.type === "agentManager.terminal.socket.closed") {
      if (message.socketId !== this.socketId) return
      this.finish(message.code, message.reason)
    }
  }

  private finish(code: number, reason: string) {
    if (this.readyState === TerminalSocket.CLOSED) return
    this.readyState = TerminalSocket.CLOSED
    this.unsubscribe?.()
    this.unsubscribe = undefined
    // An abnormal close is a failed connection, matching the browser's
    // error-then-close order. A normal close just ends the stream.
    if (code !== 1000 && code !== 1005) this.onerror?.()
    this.onclose?.({ code, reason })
  }
}

/** Binary frames stay raw bytes so the caller can feed them to the parser. */
function raw(data: string | Uint8Array): string | ArrayBuffer {
  if (typeof data === "string") return data
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}