import { describe, expect, it } from "bun:test"
import type {
  AgentManagerExtensionMessage,
  AgentManagerWebviewMessage,
} from "../webview-ui/src/types/messages/agent-manager"
import type { InMessage, OutMessage } from "../webview-ui/agent-manager/v2/bridge"
import {
  TerminalSocket,
  type TerminalSocketChannel,
  type TerminalSocketCloseEvent,
} from "../webview-ui/agent-manager/terminal/socket"

class Channel implements TerminalSocketChannel {
  readonly posted: AgentManagerWebviewMessage[] = []
  private readonly handlers = new Set<(message: InMessage) => void>()

  postMessage(message: OutMessage): void {
    this.posted.push(message as AgentManagerWebviewMessage)
  }

  onMessage(handler: (message: InMessage) => void): () => void {
    this.handlers.add(handler)
    return () => void this.handlers.delete(handler)
  }

  listeners(): number {
    return this.handlers.size
  }

  receive(message: AgentManagerExtensionMessage): void {
    for (const handler of [...this.handlers]) handler(message)
  }
}

function scene(terminalId = "terminal-1") {
  const channel = new Channel()
  const socket = new TerminalSocket(channel, terminalId)
  const open = channel.posted[0]
  if (open?.type !== "agentManager.terminal.socket.open") throw new Error("missing open request")
  return { channel, socket, socketId: open.socketId, terminalId }
}

describe("TerminalSocket", () => {
  it("opens over the channel and reports the opened socket", () => {
    const test = scene()
    const events: string[] = []
    test.socket.onopen = () => events.push("open")
    expect(test.socket.readyState).toBe(TerminalSocket.CONNECTING)
    expect(test.channel.posted[0]).toEqual({
      type: "agentManager.terminal.socket.open",
      socketId: test.socketId,
      terminalId: "terminal-1",
    })

    test.channel.receive({ type: "agentManager.terminal.socket.opened", socketId: test.socketId })
    expect(test.socket.readyState).toBe(TerminalSocket.OPEN)
    expect(events).toEqual(["open"])
  })

  it("delivers text and binary frames, keeping binary as bytes", () => {
    const test = scene()
    const data: Array<string | ArrayBuffer> = []
    test.channel.receive({ type: "agentManager.terminal.socket.opened", socketId: test.socketId })
    test.socket.onmessage = (event) => data.push(event.data)

    test.channel.receive({
      type: "agentManager.terminal.socket.message",
      socketId: test.socketId,
      data: "prompt $ ",
    })
    test.channel.receive({
      type: "agentManager.terminal.socket.message",
      socketId: test.socketId,
      data: new Uint8Array([0, 4, 255]),
    })

    expect(data[0]).toBe("prompt $ ")
    expect(data[1]).toBeInstanceOf(ArrayBuffer)
    expect([...new Uint8Array(data[1] as ArrayBuffer)]).toEqual([0, 4, 255])
  })

  it("slices a binary view down to its own bytes", () => {
    const test = scene()
    const data: Array<string | ArrayBuffer> = []
    test.channel.receive({ type: "agentManager.terminal.socket.opened", socketId: test.socketId })
    test.socket.onmessage = (event) => data.push(event.data)

    const frame = new Uint8Array([9, 8, 7, 6])
    test.channel.receive({
      type: "agentManager.terminal.socket.message",
      socketId: test.socketId,
      data: frame.subarray(1, 3),
    })
    expect([...new Uint8Array(data[0] as ArrayBuffer)]).toEqual([8, 7])
  })

  it("sends only while open", () => {
    const test = scene()
    test.socket.send("early")
    expect(test.channel.posted).toHaveLength(1)

    test.channel.receive({ type: "agentManager.terminal.socket.opened", socketId: test.socketId })
    test.socket.send("ls\n")
    test.socket.send(new Uint8Array([1, 2]))
    expect(test.channel.posted.slice(1)).toEqual([
      { type: "agentManager.terminal.socket.send", socketId: test.socketId, data: "ls\n" },
      { type: "agentManager.terminal.socket.send", socketId: test.socketId, data: new Uint8Array([1, 2]) },
    ])
  })

  it("closes once, reports the close and unsubscribes", () => {
    const test = scene()
    const events: string[] = []
    const closes: TerminalSocketCloseEvent[] = []
    test.channel.receive({ type: "agentManager.terminal.socket.opened", socketId: test.socketId })
    test.socket.onerror = () => events.push("error")
    test.socket.onclose = (event) => {
      events.push("close")
      closes.push(event)
    }

    test.socket.close(1000, "done")
    test.socket.close(1000, "done again")
    expect(test.socket.readyState).toBe(TerminalSocket.CLOSING)
    expect(test.channel.posted.slice(1)).toEqual([
      { type: "agentManager.terminal.socket.close", socketId: test.socketId, code: 1000, reason: "done" },
    ])

    test.channel.receive({
      type: "agentManager.terminal.socket.closed",
      socketId: test.socketId,
      code: 1000,
      reason: "done",
    })
    expect(test.socket.readyState).toBe(TerminalSocket.CLOSED)
    expect(events).toEqual(["close"])
    expect(closes).toEqual([{ code: 1000, reason: "done" }])
    expect(test.channel.listeners()).toBe(0)
  })

  it("reports an abnormal close as an error before closing", () => {
    const test = scene()
    const events: string[] = []
    test.channel.receive({ type: "agentManager.terminal.socket.opened", socketId: test.socketId })
    test.socket.onerror = () => events.push("error")
    test.socket.onclose = () => events.push("close")

    test.channel.receive({
      type: "agentManager.terminal.socket.closed",
      socketId: test.socketId,
      code: 1006,
      reason: "abnormal closure",
    })
    expect(events).toEqual(["error", "close"])
  })

  it("ends a gone terminal without a connection error", () => {
    const test = scene()
    const events: string[] = []
    test.channel.receive({ type: "agentManager.terminal.socket.opened", socketId: test.socketId })
    test.socket.onerror = () => events.push("error")
    test.socket.onclose = () => events.push("close")

    test.channel.receive({
      type: "agentManager.terminal.socket.closed",
      socketId: test.socketId,
      code: 4404,
      reason: "session exited",
    })
    expect(events).toEqual(["close"])
  })

  it("does not report a close the client requested", () => {
    const test = scene()
    const events: string[] = []
    test.channel.receive({ type: "agentManager.terminal.socket.opened", socketId: test.socketId })
    test.socket.onerror = () => events.push("error")
    test.socket.onclose = () => events.push("close")

    test.socket.close(4009, "terminal replay exceeded limit")
    test.channel.receive({
      type: "agentManager.terminal.socket.closed",
      socketId: test.socketId,
      code: 4009,
      reason: "terminal replay exceeded limit",
    })
    expect(events).toEqual(["close"])
  })

  it("ignores frames of another socket", () => {
    const test = scene()
    const data: Array<string | ArrayBuffer> = []
    test.channel.receive({ type: "agentManager.terminal.socket.opened", socketId: test.socketId })
    test.socket.onmessage = (event) => data.push(event.data)

    test.channel.receive({ type: "agentManager.terminal.socket.message", socketId: "other", data: "nope" })
    test.channel.receive({ type: "agentManager.terminal.socket.opened", socketId: "other" })
    test.channel.receive({ type: "agentManager.terminal.socket.closed", socketId: "other", code: 1000, reason: "" })
    expect(data).toEqual([])
    expect(test.socket.readyState).toBe(TerminalSocket.OPEN)
    expect(test.channel.listeners()).toBe(1)
  })
})