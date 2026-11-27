import assert from "node:assert/strict"
import { EventEmitter, once } from "node:events"
import { test, type TestContext } from "node:test"
import { Worker } from "node:worker_threads"
import type { Page } from "playwright-core"
import WebSocket, { WebSocketServer } from "ws"
import { BrowserStream } from "../../src/services/browser-automation/browser-stream"
import { decodeStreamFrame, encodeStreamWheel, STREAM_FRAME_JPEG, type BrowserFrame } from "../../src/shared/browser-stream"

const view = { width: 320, height: 200, scale: 2, active: true, revision: 1 }
const target = "A17CD2"

// A controllable Chrome endpoint lets a test withhold the start response or close a live CDP socket.
async function fixture(t: TestContext, start: "ready" | "refuse" | "stall" | "lookup" = "ready") {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1", path: `/devtools/page/${target}` })
  await once(server, "listening")
  const address = server.address()
  assert(address && typeof address !== "string")
  const events = new EventEmitter()
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const command = JSON.parse(data.toString())
      if (command.method === "Page.startScreencast") events.emit("start", socket, command.params)
      if (command.method === "Page.screencastFrameAck") events.emit(`ack:${command.params.sessionId}`)
      if (command.method === "Input.dispatchMouseEvent") events.emit("wheel", command.params)
      if (command.method === "Page.startScreencast" && start === "stall") return
      const refuse = command.method === "Page.startScreencast" && start === "refuse"
      socket.send(JSON.stringify(refuse ? { id: command.id, error: { code: -1 } } : { id: command.id, result: {} }))
    })
  })
  const scope = { browserId: "owned", navigation: 1, committed: 1 }
  const calls: string[] = []
  const session = Object.assign(new EventEmitter(), {
    send: async (method: string) => {
      calls.push(method)
      events.emit(method)
      if (method === "Target.getTargetInfo") {
        if (start === "lookup") await once(events, "unlock")
        return { targetInfo: { targetId: target } }
      }
      return {}
    },
    detach: async () => {},
  })
  const page = Object.assign(new EventEmitter(), {
    context: () => ({ newCDPSession: async () => session }),
    setViewportSize: async () => {},
    evaluate: async () => {},
  })
  const frames: BrowserFrame[] = []
  let streamUrl: string | undefined
  const stream = new BrowserStream(
    page as unknown as Page,
    () => scope,
    (frame) => {
      frames.push(frame)
      events.emit("frame", frame)
    },
    () => {},
    undefined,
    address.port,
    (url) => {
      streamUrl = url
    },
  )
  t.after(async () => {
    await stream.close()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((done) => server.close(() => done()))
  })
  const bind = async (run: () => Promise<void> | void) => {
    const listening = once(events, "start")
    await run()
    const [socket, params] = await listening
    assert.deepEqual(params, { format: "jpeg", quality: 90, maxWidth: 640, maxHeight: 400, everyNthFrame: 1 })
    return socket as WebSocket
  }
  return { port: address.port, events, bind, scope, stream, frames, session, calls, url: () => streamUrl }
}

function frame(id: number, width = 640, height = 400, monotonicTimestamp?: number) {
  const data = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0, 255, 217, id])
  data.writeUInt16BE(height, 7)
  data.writeUInt16BE(width, 9)
  return {
    sessionId: id,
    data: data.toString("base64"),
    metadata: { deviceWidth: view.width, deviceHeight: view.height, monotonicTimestamp },
  }
}

function send(socket: WebSocket, params: ReturnType<typeof frame>) {
  socket.send(JSON.stringify({ method: "Page.screencastFrame", params }))
}

test("ACKs invalid frames, transfers exact JPEGs, and retains only the newest frame behind credit", async (t) => {
  const f = await fixture(t)
  const resolve = require.resolve
  const start = once(f.events, "start")
  const worker = new Worker(resolve("./browser-frame-worker.js"), {
    execArgv: [],
    workerData: { port: f.port, target, view },
  })
  t.after(() => worker.terminate())
  const messages: unknown[] = []
  worker.on("message", (message) => messages.push(message))
  const ready = once(worker, "message")
  const [socket] = await start
  assert.deepEqual(await ready, ["ready"])
  send(socket, frame(1, 638))
  send(socket, { ...frame(2), data: "data:image/png;base64,cG5n" })
  const wrongSize = frame(3)
  send(socket, { ...wrongSize, metadata: { ...wrongSize.metadata, deviceHeight: view.height + 1 } })
  const valid = once(worker, "message")
  const ack = once(f.events, "ack:7")
  send(socket, frame(4, 639, 401))
  send(socket, frame(5))
  send(socket, frame(6, 640, 400, 6))
  send(socket, frame(7, 640, 400, 5))
  const [first] = await valid
  assert.equal(first.width, 639)
  assert.equal(first.height, 401)
  assert(first.data instanceof ArrayBuffer)
  assert.deepEqual(Buffer.from(first.data), Buffer.from(frame(4, 639, 401).data, "base64"))
  await ack
  const latest = once(worker, "message")
  worker.postMessage("credit")
  const [last] = await latest
  assert.equal(Buffer.from(last.data).at(-1), 6)
  assert.equal(messages.length, 3)
  const exit = once(worker, "exit")
  socket.close()
  assert.deepEqual(await exit, [0])
})

test("never promotes old pixels into a new navigation or revision, and detaches when hidden", async (t) => {
  const f = await fixture(t)
  const first = await f.bind(() => f.stream.configure(view))
  const received = once(f.events, "frame")
  send(first, frame(1))
  await received
  send(first, frame(2))
  f.scope.navigation++
  const loading = await f.bind(() => f.stream.configure({ ...view, revision: 2 }))
  const ack = once(f.events, "ack:3")
  send(loading, frame(3))
  await ack
  const committed = await f.bind(() => {
    f.scope.committed++
    f.stream.synchronize()
  })
  f.stream.acknowledge(1)
  const current = once(f.events, "frame")
  send(committed, frame(4))
  await current
  assert.deepEqual(
    f.frames.map((item) => [item.navigation, item.revision, Buffer.from(item.data).at(-1)]),
    [
      [1, 1, 1],
      [2, 2, 4],
    ],
  )
  // A new-document signal from the control session can precede the broker's identity update.
  const nextDocument = await f.bind(() => {
    f.session.emit("Page.frameNavigated", { frame: {} })
  })
  const closed = once(nextDocument, "close")
  await f.stream.configure({ ...view, active: false, revision: 2 })
  await closed
  const resumed = await f.bind(() => f.stream.configure({ ...view, revision: 3 }))
  const ended = once(resumed, "close")
  await f.stream.close()
  await ended
  assert(!f.calls.includes("Page.startScreencast"))
})

for (const when of ["refuse", "after ready"] as const) {
  test(`falls back to the host CDP session on worker failure: ${when}`, async (t) => {
    const f = await fixture(t, when === "refuse" ? "refuse" : "ready")
    const switched = once(f.events, "Page.startScreencast")
    const socket = await f.bind(() => f.stream.configure(view))
    if (when === "after ready") socket.close()
    await switched
    f.session.emit("Page.screencastFrame", frame(1))
    assert.equal(f.frames.length, 1)
    assert.equal(Buffer.from(f.frames[0].data).at(-1), 1)
    await f.stream.close()
    assert.equal(f.calls.filter((method) => method === "Page.stopScreencast").length, 1)
  })
}

test("close cancels a stalled worker startup without starting a fallback", async (t) => {
  const f = await fixture(t, "stall")
  const start = once(f.events, "start")
  const configuring = f.stream.configure(view)
  const [socket] = await start
  const closed = once(socket, "close")
  await Promise.all([f.stream.close(), configuring, closed])
  assert(!f.calls.includes("Page.startScreencast"))
})

test("hiding the view cancels startup even while the host awaits the target ID", async (t) => {
  const f = await fixture(t, "lookup")
  const lookup = once(f.events, "Target.getTargetInfo")
  const configuring = f.stream.configure(view)
  await lookup
  await Promise.all([f.stream.configure({ ...view, active: false }), configuring])
  f.events.emit("unlock")
  assert(!f.calls.includes("Page.startScreencast"))
})

test("direct binary WS enforces origin and token auth, streams frames without host hops, and gates wheel input", async (t) => {
  const f = await fixture(t)
  const targetSocket = await f.bind(() => f.stream.configure(view))
  const url = f.url()
  assert(url && url.startsWith("ws://127.0.0.1:"))

  // Reject untrusted origin and wrong secret token.
  for (const [candidate, origin] of [
    [url, "https://evil.example"],
    [url.slice(0, -1) + (url.endsWith("0") ? "1" : "0"), "vscode-webview://test"],
  ] as const) {
    const bad = new WebSocket(candidate, { headers: { Origin: origin } })
    const [err] = await once(bad, "error")
    assert(err instanceof Error)
  }

  // Authenticated webview receives binary frames directly and forwards validated wheel events.
  const client = new WebSocket(url, { headers: { Origin: "vscode-webview://test-id" } })
  t.after(() => client.close())
  await once(client, "open")
  const incoming = once(client, "message")
  send(targetSocket, frame(11))
  const [raw] = await incoming
  const buf = Buffer.isBuffer(raw) ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) : raw
  const decoded = decodeStreamFrame(buf as ArrayBuffer)
  assert(decoded && decoded.kind === STREAM_FRAME_JPEG && decoded.navigation === 1 && decoded.revision === 1)
  assert.equal(decoded.data.at(-1), 11)
  assert.equal(f.frames.length, 0, "direct WS frames must bypass host postMessage")

  // Stale revision/navigation wheel must be ignored; matching wheel reaches CDP directly.
  const receivedWheel = once(f.events, "wheel")
  client.send(encodeStreamWheel({ navigation: 99, revision: 1, x: 0.5, y: 0.5, deltaX: 0, deltaY: 20, modifiers: 0 }))
  client.send(encodeStreamWheel({ navigation: 1, revision: 99, x: 0.5, y: 0.5, deltaX: 0, deltaY: 30, modifiers: 0 }))
  client.send(encodeStreamWheel({ navigation: 1, revision: 1, x: 0.5, y: 0.25, deltaX: 0, deltaY: 50, modifiers: 2 }))
  const [params] = await receivedWheel
  assert.deepEqual(params, { type: "mouseWheel", x: 160, y: 50, modifiers: 2, buttons: 0, deltaX: 0, deltaY: 50 })
})
