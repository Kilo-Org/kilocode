/**
 * Relays the Agent Manager terminals' PTY sockets through the extension host.
 *
 * The webview cannot open the server's PTY WebSocket itself: the server rejects
 * a browser `Origin` on the connect route, while a Node client sends none. The
 * host opens one socket per webview socket id and forwards frames over the
 * panel message channel: strings stay strings, binary frames travel as
 * `Uint8Array` so the bytes survive postMessage unchanged.
 *
 * Each open mints its own single-use connect ticket, so a re-open is simply a
 * new socket id. Terminal bytes are never logged.
 */

import WebSocket from "ws"
import type { RawData } from "ws"
import type { AgentManagerConnection } from "./connection"
import { getErrorMessage } from "./errors"
import { ptySocketUrl } from "./terminal-manager"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "./types"

/** The server PTY a webview terminal currently streams. */
export interface PtyTarget {
  ptyID: string
  directory: string
}

export interface PtyRelayDeps {
  connection: AgentManagerConnection
  /** The PTY behind a webview tab terminal, or undefined when it is gone. */
  terminal(terminalId: string): PtyTarget | undefined
  post(message: AgentManagerOutMessage): void
  log(...args: unknown[]): void
}

interface Entry {
  terminalId: string
  socket: WebSocket
}

const NOT_FOUND = 4404
const UNAVAILABLE = 4500

function reason(value: Buffer | undefined): string {
  return value ? value.toString("utf8") : ""
}

/** A socket frame as one buffer: ws may deliver fragments as an array. */
function bytes(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return data
}

/** Only the codes a client may send are forwarded; anything else uses the default close. */
function closeCode(code: number | undefined): number | undefined {
  if (code === undefined || code === 1000) return code
  if (code >= 3000 && code <= 4999) return code
  return undefined
}

export class PtyRelay {
  private readonly sockets = new Map<string, Entry>()
  /** Open requests awaiting a ticket; a close or dispose removes the token. */
  private readonly tokens = new Map<string, symbol>()
  private disposed = false

  constructor(private readonly deps: PtyRelayDeps) {}

  /** True for the socket messages this relay owns. */
  handle(m: AgentManagerInMessage): boolean {
    if (m.type === "agentManager.terminal.socket.open") {
      void this.open(m.socketId, m.terminalId)
      return true
    }
    if (m.type === "agentManager.terminal.socket.send") {
      this.send(m.socketId, m.data)
      return true
    }
    if (m.type === "agentManager.terminal.socket.close") {
      this.close(m.socketId, m.code, m.reason)
      return true
    }
    return false
  }

  /** Close every socket of one webview terminal, for example when it closes. */
  closeTerminal(terminalId: string): void {
    for (const [socketId, entry] of this.sockets) {
      if (entry.terminalId === terminalId) this.close(socketId)
    }
    for (const [socketId] of this.tokens) {
      const entry = this.sockets.get(socketId)
      if (!entry || entry.terminalId === terminalId) this.tokens.delete(socketId)
    }
  }

  dispose(): void {
    this.disposed = true
    this.tokens.clear()
    const entries = [...this.sockets.values()]
    this.sockets.clear()
    for (const entry of entries) entry.socket.close()
  }

  private async open(socketId: string, terminalId: string): Promise<void> {
    if (this.disposed) return
    // A duplicate id replaces the previous socket instead of leaking it.
    this.close(socketId)
    const target = this.deps.terminal(terminalId)
    if (!target) return this.closed(socketId, NOT_FOUND, "Terminal is not available")
    const token = Symbol(socketId)
    this.tokens.set(socketId, token)
    const url = await ptySocketUrl(this.deps.connection, target.directory, target.ptyID).catch((error: unknown) => {
      this.deps.log(`PTY socket ${socketId} could not get a ticket: ${getErrorMessage(error)}`)
      return undefined
    })
    if (this.tokens.get(socketId) !== token) return
    this.tokens.delete(socketId)
    if (this.disposed || !url) return this.closed(socketId, UNAVAILABLE, "Terminal socket could not start")
    this.connect(socketId, terminalId, url)
  }

  private connect(socketId: string, terminalId: string, url: string): void {
    const socket = new WebSocket(url)
    const entry: Entry = { terminalId, socket }
    this.sockets.set(socketId, entry)
    socket.on("open", () => this.deps.post({ type: "agentManager.terminal.socket.opened", socketId }))
    socket.on("message", (data, binary) => {
      if (this.sockets.get(socketId) !== entry) return
      const body = bytes(data)
      this.deps.post({
        type: "agentManager.terminal.socket.message",
        socketId,
        data: binary ? new Uint8Array(body) : body.toString(),
      })
    })
    socket.on("error", (error) => {
      this.deps.log(`PTY socket ${socketId} failed: ${getErrorMessage(error)}`)
    })
    socket.on("close", (code, value) => {
      if (this.sockets.get(socketId) !== entry) return
      this.sockets.delete(socketId)
      this.deps.post({
        type: "agentManager.terminal.socket.closed",
        socketId,
        code,
        reason: reason(value),
      })
    })
  }

  private send(socketId: string, data: string | Uint8Array): void {
    const entry = this.sockets.get(socketId)
    if (!entry || entry.socket.readyState !== WebSocket.OPEN) return
    entry.socket.send(data)
  }

  private close(socketId: string, code?: number, text?: string): void {
    this.tokens.delete(socketId)
    const entry = this.sockets.get(socketId)
    if (!entry) return
    // The socket stays mapped until its close event, which reports the final
    // code to the webview and drops the entry.
    entry.socket.close(closeCode(code), text)
  }

  private closed(socketId: string, code: number, text: string): void {
    this.deps.post({ type: "agentManager.terminal.socket.closed", socketId, code, reason: text })
  }
}