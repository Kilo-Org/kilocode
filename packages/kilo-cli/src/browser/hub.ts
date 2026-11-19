// The hub multiplexer: one extension connection, many CLI connections, one
// controllerId per CLI socket so no CLI ever sees another CLI's frames.
import { randomUUID } from "node:crypto"
import * as proto from "./protocol"

export type Link = {
  // False when the frame could not be handed to the transport at all.
  send(frame: proto.HubToExtension): boolean
  close(reason: string): void
}

// One connected CLI socket.
export type Controller = {
  readonly id: string
  frame(frame: proto.CliToHub): void
  drop(): void
}

// One connected browser extension, before and after ext.hello.
export type Extension = {
  hello(info: proto.ExtensionInfo): void
  frame(frame: Extract<proto.ExtensionToHub, { type: "rpc" }>): void
  drop(): void
}

export type Options = {
  mode: "native" | "loopback"
  version: string
  onChange?(info: proto.ExtensionInfo | null): void
  // Answers a request on the hub itself instead of forwarding it to the extension.
  // Returning undefined forwards it; a value is sent back to that controller only.
  local?(method: string, params: unknown): unknown | undefined
  // How often a loopback hub sends `hub.keepalive` while a CLI is attached (default `Keepalive`); tests shorten it.
  keepalive?: number
}

// Chrome stops an extension service worker after 30 s without events, and a WebSocket message counts as one
// (Chrome 116+), so one keepalive every 20 s keeps the worker, and the CLI's session in it, alive.
// https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#chrome_116
const Keepalive = 20_000

export type Hub = {
  readonly id: string
  readonly mode: Options["mode"]
  readonly version: string
  extension(): proto.ExtensionInfo | undefined
  // True while a transport is attached, including while it is still handshaking.
  attached(): boolean
  join(send: (frame: proto.HubToCli) => void, close: (reason: string) => void): Controller
  attach(send: (frame: proto.HubToExtension) => boolean, close: (reason: string) => void): Extension | undefined
  count(): number
  close(reason: string): void
}

type Slot =
  | { kind: "empty" }
  | { kind: "pending"; link: Link }
  | { kind: "ready"; info: proto.ExtensionInfo; link: Link }

export function create(input: Options): Hub {
  const id = randomUUID()
  const controllers = new Map<string, { send: (frame: proto.HubToCli) => void; close: (reason: string) => void }>()
  let slot: Slot = { kind: "empty" }
  let shut = false
  let keepalive: NodeJS.Timeout | undefined

  function broadcast() {
    const frame: proto.HubToCli =
      slot.kind === "ready" ? { type: "hub.ready", extension: slot.info } : { type: "hub.waiting" }
    for (const controller of controllers.values()) controller.send(frame)
  }

  function vacate(reason: string) {
    if (slot.kind === "empty") return
    clearInterval(keepalive)
    const link = slot.link
    slot = { kind: "empty" }
    broadcast()
    input.onChange?.(null)
    link.close(reason)
  }

  function join(send: (frame: proto.HubToCli) => void, close: (reason: string) => void): Controller {
    // Never add a controller to a closed hub: nothing would remove it again.
    if (shut) {
      close("hub is shutting down")
      return { id: randomUUID(), frame() {}, drop() {} }
    }
    const controllerId = randomUUID()
    controllers.set(controllerId, { send, close })
    // A CLI that joins mid-session learns the current state immediately.
    send(slot.kind === "ready" ? { type: "hub.ready", extension: slot.info } : { type: "hub.waiting" })
    if (slot.kind === "ready") slot.link.send({ type: "controller.connected", controllerId })
    return {
      id: controllerId,
      frame(frame) {
        if (!controllers.has(controllerId)) return
        // A hub-local request (the pairing URL) never reaches the extension: the hub
        // answers it even while no browser is attached.
        if (proto.isRequest(frame.message)) {
          const answer = input.local?.(frame.message.method, frame.message.params)
          if (answer !== undefined) {
            send({ type: "rpc", message: { jsonrpc: "2.0", id: frame.message.id, result: answer } })
            return
          }
        }
        if (slot.kind !== "ready") {
          // Fail requests fast instead of letting the caller wait for a timeout.
          if (proto.isRequest(frame.message)) {
            send({
              type: "rpc",
              message: proto.failure(
                frame.message.id,
                "browser_unavailable",
                "The browser is not available right now.",
              ),
            })
          }
          return
        }
        if (!slot.link.send({ type: "rpc", controllerId, message: frame.message })) {
          // The transport refused the frame (oversized or dead). Answer the caller
          // instead of leaving it to time out with no explanation.
          if (proto.isRequest(frame.message)) {
            send({
              type: "rpc",
              message: proto.failure(
                frame.message.id,
                "browser_unavailable",
                "The browser connection could not carry this request.",
              ),
            })
          }
        }
      },
      drop() {
        // The admission guard: only the first drop for a controller notifies the extension.
        if (!controllers.delete(controllerId)) return
        if (slot.kind === "ready") slot.link.send({ type: "controller.disconnected", controllerId })
      },
    }
  }

  function attach(
    send: (frame: proto.HubToExtension) => boolean,
    close: (reason: string) => void,
  ): Extension | undefined {
    if (shut) {
      close("hub is shutting down")
      return undefined
    }
    // One browser per hub: a second transport is refused instead of stealing the
    // sessions of the first.
    if (slot.kind !== "empty") {
      close("another extension is already attached")
      return undefined
    }
    const link: Link = { send, close }
    slot = { kind: "pending", link }
    return {
      hello(info) {
        if (slot.kind !== "pending") return
        // D14: the CLI speaks this protocol or the one before it. A version with no
        // overlap cannot be routed, so the transport is refused and the CLIs are told
        // the browser is unavailable rather than being served a foreign contract.
        if (!info.protocol.includes(proto.Protocol)) {
          vacate("the extension speaks an unsupported protocol")
          return
        }
        slot = { kind: "ready", info, link }
        // A native port keeps the worker alive by itself (Chrome 105+); a WebSocket only while messages cross it.
        if (input.mode === "loopback") {
          keepalive = setInterval(() => {
            if (slot.kind === "ready" && controllers.size > 0) slot.link.send({ type: "hub.keepalive" })
          }, input.keepalive ?? Keepalive)
          keepalive.unref()
        }
        // Controllers that joined while the transport was still handshaking never
        // saw controller.connected, so announce them before the ready broadcast.
        for (const controllerId of controllers.keys()) link.send({ type: "controller.connected", controllerId })
        broadcast()
        input.onChange?.(info)
      },
      frame(frame) {
        if (slot.kind !== "ready") {
          vacate("received a frame before ext.hello")
          return
        }
        const controller = controllers.get(frame.controllerId)
        // A late frame for a CLI that already left is dropped, never delivered elsewhere.
        if (!controller) return
        controller.send({ type: "rpc", message: frame.message })
      },
      drop() {
        if (slot.kind === "empty" || slot.link !== link) return
        vacate("the extension disconnected")
      },
    }
  }

  return {
    id,
    mode: input.mode,
    version: input.version,
    extension() {
      return slot.kind === "ready" ? slot.info : undefined
    },
    attached() {
      return slot.kind !== "empty"
    },
    join,
    attach,
    count() {
      return controllers.size
    },
    close(reason) {
      if (shut) return
      shut = true
      vacate(reason)
      for (const controller of controllers.values()) controller.close(reason)
      controllers.clear()
    },
  }
}
