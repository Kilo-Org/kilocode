import { describe, expect, test } from "bun:test"
import * as proto from "../../src/browser/protocol"
import { create } from "../../src/browser/hub"

function link() {
  const frames: proto.HubToExtension[] = []
  const closed: string[] = []
  return {
    frames,
    closed,
    link: {
      send: (frame: proto.HubToExtension) => {
        frames.push(frame)
        return true
      },
      close: (reason: string) => closed.push(reason),
    },
  }
}

function controller() {
  const frames: proto.HubToCli[] = []
  const closed: string[] = []
  return {
    frames,
    closed,
    send: (frame: proto.HubToCli) => frames.push(frame),
    close: (reason: string) => closed.push(reason),
  }
}

const info: proto.ExtensionInfo = {
  protocol: [1],
  extensionVersion: "1.0.0",
  browser: { name: "Chrome", version: "140" },
  profileLabel: "Default",
  contractSha: "abc",
  capabilities: {
    trustedInput: true,
    console: true,
    network: true,
    dialogs: true,
    fileUpload: true,
    tabGroups: true,
  },
}

function call(id: number) {
  return { type: "rpc" as const, message: { jsonrpc: "2.0" as const, id, method: "tools.list", params: {} } }
}

describe("hub multiplexing", () => {
  test("routes each controller's calls with its own controller id", () => {
    const hub = create({ mode: "native", version: "test" })
    const ext = link()
    const sink = hub.attach(ext.link.send, ext.link.close)!
    sink.hello(info)
    const a = controller()
    const b = controller()
    const first = hub.join(a.send, a.close)
    const second = hub.join(b.send, b.close)

    first.frame(call(1))
    second.frame(call(2))

    const routed = ext.frames.filter((frame): frame is proto.Routed => frame.type === "rpc")
    expect(routed.map((frame) => frame.controllerId)).toStrictEqual([first.id, second.id])
    expect(routed.map((frame) => (proto.isRequest(frame.message) ? frame.message.id : undefined))).toStrictEqual([1, 2])
  })

  test("never delivers one controller's answer to another", () => {
    const hub = create({ mode: "native", version: "test" })
    const ext = link()
    const sink = hub.attach(ext.link.send, ext.link.close)!
    sink.hello(info)
    const a = controller()
    const b = controller()
    const first = hub.join(a.send, a.close)
    const second = hub.join(b.send, b.close)

    sink.frame({ type: "rpc", controllerId: first.id, message: { jsonrpc: "2.0", id: 7, result: { ok: true } } })
    sink.frame({ type: "rpc", controllerId: second.id, message: { jsonrpc: "2.0", method: "tab.closed", params: {} } })

    expect(a.frames.at(-1)).toStrictEqual({ type: "rpc", message: { jsonrpc: "2.0", id: 7, result: { ok: true } } })
    expect(b.frames.at(-1)).toStrictEqual({
      type: "rpc",
      message: { jsonrpc: "2.0", method: "tab.closed", params: {} },
    })
  })

  test("drops frames for a controller that already left", () => {
    const hub = create({ mode: "native", version: "test" })
    const ext = link()
    const sink = hub.attach(ext.link.send, ext.link.close)!
    sink.hello(info)
    const a = controller()
    const first = hub.join(a.send, a.close)
    first.drop()
    const before = a.frames.length

    sink.frame({ type: "rpc", controllerId: first.id, message: { jsonrpc: "2.0", id: 9, result: {} } })
    expect(a.frames).toHaveLength(before)
  })

  test("announces a controller once, even when it drops twice", () => {
    const hub = create({ mode: "native", version: "test" })
    const ext = link()
    const sink = hub.attach(ext.link.send, ext.link.close)!
    sink.hello(info)
    const a = controller()
    const first = hub.join(a.send, a.close)
    first.drop()
    first.drop()

    const announces = ext.frames.filter(
      (frame) => frame.type === "controller.connected" || frame.type === "controller.disconnected",
    )
    expect(announces).toStrictEqual([
      { type: "controller.connected", controllerId: first.id },
      { type: "controller.disconnected", controllerId: first.id },
    ])
  })

  test("answers calls with browser_unavailable while no extension is attached", async () => {
    const hub = create({ mode: "native", version: "test" })
    const a = controller()
    const first = hub.join(a.send, a.close)
    expect(a.frames).toStrictEqual([{ type: "hub.waiting" }])

    first.frame(call(3))

    const answer = proto.HubToCli.parse(a.frames.at(-1))
    if (answer.type !== "rpc") throw new Error("expected an rpc frame")
    if (!proto.isResponse(answer.message)) throw new Error("expected a response")
    expect(answer.message.id).toBe(3)
    expect(answer.message.error?.code).toBe(proto.ErrorCodes.browser_unavailable)
  })

  test("refuses a second extension instead of stealing the first one's sessions", () => {
    const hub = create({ mode: "loopback", version: "test" })
    const first = link()
    const second = link()
    expect(hub.attach(first.link.send, first.link.close)).toBeDefined()
    expect(hub.attach(second.link.send, second.link.close)).toBeUndefined()
    expect(second.closed).toStrictEqual(["another extension is already attached"])
  })

  test("broadcasts hub.ready and hub.waiting to every controller", () => {
    const changes: (proto.ExtensionInfo | null)[] = []
    const hub = create({ mode: "native", version: "test", onChange: (value) => changes.push(value) })
    const a = controller()
    const b = controller()
    hub.join(a.send, a.close)
    hub.join(b.send, b.close)

    const ext = link()
    const sink = hub.attach(ext.link.send, ext.link.close)!
    sink.hello(info)
    expect(a.frames.at(-1)).toStrictEqual({ type: "hub.ready", extension: info })
    expect(b.frames.at(-1)).toStrictEqual({ type: "hub.ready", extension: info })

    sink.drop()
    expect(a.frames.at(-1)).toStrictEqual({ type: "hub.waiting" })
    expect(b.frames.at(-1)).toStrictEqual({ type: "hub.waiting" })
    expect(changes).toStrictEqual([info, null])
  })

  test("closes a transport that sends a frame before ext.hello", () => {
    const hub = create({ mode: "native", version: "test" })
    const ext = link()
    const sink = hub.attach(ext.link.send, ext.link.close)!
    const a = controller()
    hub.join(a.send, a.close)

    sink.frame({
      type: "rpc",
      controllerId: "00000000-0000-4000-8000-000000000000",
      message: { jsonrpc: "2.0", id: 1, result: {} },
    })

    expect(ext.closed).toStrictEqual(["received a frame before ext.hello"])
    expect(hub.count()).toBe(1)
  })

  test("treats a transport that is still handshaking as attached", () => {
    const hub = create({ mode: "loopback", version: "test" })
    expect(hub.attached()).toBe(false)
    const ext = link()
    const sink = hub.attach(ext.link.send, ext.link.close)!
    expect(hub.attached()).toBe(true)
    expect(hub.extension()).toBeUndefined()
    sink.hello(info)
    expect(hub.attached()).toBe(true)
    sink.drop()
    expect(hub.attached()).toBe(false)
  })

  test("answers the controller when the extension transport refuses a frame", () => {
    const hub = create({ mode: "native", version: "test" })
    const refused = {
      send: () => false,
      close: () => undefined,
    }
    const sink = hub.attach(refused.send, refused.close)!
    sink.hello(info)
    const caller = controller()
    const controller$ = hub.join(caller.send, caller.close)
    controller$.frame(call(11))

    const answer = proto.HubToCli.parse(caller.frames.at(-1))
    if (answer.type !== "rpc") throw new Error("expected an rpc frame")
    if (!proto.isResponse(answer.message)) throw new Error("expected a response")
    expect(answer.message.id).toBe(11)
    expect(answer.message.error?.code).toBe(proto.ErrorCodes.browser_unavailable)
  })

  test("close() closes every controller and the extension, then refuses new work", () => {
    const hub = create({ mode: "native", version: "test" })
    const ext = link()
    const sink = hub.attach(ext.link.send, ext.link.close)!
    sink.hello(info)
    const a = controller()
    const b = controller()
    hub.join(a.send, a.close)
    hub.join(b.send, b.close)

    hub.close("the hub is shutting down")

    expect(ext.closed).toStrictEqual(["the hub is shutting down"])
    expect(a.closed).toStrictEqual(["the hub is shutting down"])
    expect(b.closed).toStrictEqual(["the hub is shutting down"])
    expect(hub.count()).toBe(0)
    expect(hub.extension()).toBeUndefined()
    expect(hub.attached()).toBe(false)

    const late = controller()
    const after = hub.join(late.send, late.close)
    expect(late.closed).toStrictEqual(["hub is shutting down"])
    expect(hub.count()).toBe(0)
    after.drop()
    expect(late.closed).toHaveLength(1)

    const second = link()
    expect(hub.attach(second.link.send, second.link.close)).toBeUndefined()
    expect(second.closed).toStrictEqual(["hub is shutting down"])
  })
})
