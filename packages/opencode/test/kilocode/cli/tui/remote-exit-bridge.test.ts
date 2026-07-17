import { describe, expect, test } from "bun:test"
import { createExit } from "../../../../src/cli/cmd/tui/context/exit"
import { RemoteExitRpc } from "../../../../src/kilocode/cli/cmd/tui/remote-exit-rpc"
import { createParentRemoteExitBridge } from "../../../../src/kilocode/cli/cmd/tui/remote-exit-bridge"
import { Rpc } from "../../../../src/util/rpc"

describe("parent remote exit RPC bridge", () => {
  test("subscribes before readiness and invokes the idempotent local Exit", async () => {
    const order: string[] = []
    let handler: (() => void) | undefined
    const client = {
      on(event: string, next: () => void) {
        expect(event).toBe(RemoteExitRpc.Event)
        order.push("subscribe")
        handler = next
        return () => {
          order.push("unsubscribe")
          handler = undefined
        }
      },
      async call(method: string) {
        order.push(method)
      },
    }
    let exits = 0
    const exit = createExit(async () => {
      exits += 1
    })

    const bridge = createParentRemoteExitBridge(client, exit)
    await bridge.ready()
    expect(order).toEqual(["subscribe", "tuiReady"])

    handler?.()
    handler?.()
    await Promise.resolve()
    expect(exits).toBe(1)

    await bridge.dispose()
    expect(order).toEqual(["subscribe", "tuiReady", "tuiGone", "unsubscribe"])
    expect(handler).toBeUndefined()
  })

  test("cleanup unregisters the worker even when readiness fails", async () => {
    const calls: string[] = []
    const bridge = createParentRemoteExitBridge(
      {
        on() {
          calls.push("subscribe")
          return () => calls.push("unsubscribe")
        },
        async call(method: string) {
          calls.push(method)
          if (method === "tuiReady") throw new Error("worker unavailable")
        },
      },
      createExit(async () => {}),
    )

    await expect(bridge.ready()).rejects.toThrow("worker unavailable")
    await bridge.dispose()
    expect(calls).toEqual(["subscribe", "tuiReady", "tuiGone", "unsubscribe"])
  })

  test("unsubscribes in finally when tuiGone fails", async () => {
    const calls: string[] = []
    let subscribed = true
    const bridge = createParentRemoteExitBridge(
      {
        on() {
          calls.push("subscribe")
          return () => {
            calls.push("unsubscribe")
            subscribed = false
          }
        },
        async call(method: string) {
          calls.push(method)
          if (method === "tuiGone") throw new Error("worker gone failed")
        },
      },
      createExit(async () => {}),
    )

    await bridge.ready()
    await expect(bridge.dispose()).rejects.toThrow("worker gone failed")
    expect(calls).toEqual(["subscribe", "tuiReady", "tuiGone", "unsubscribe"])
    expect(subscribed).toBe(false)
  })

  test("bounds unresolved tuiGone and still unsubscribes", async () => {
    let subscribed = true
    const bridge = createParentRemoteExitBridge(
      {
        on() {
          return () => {
            subscribed = false
          }
        },
        async call(method: string) {
          if (method === "tuiGone") await new Promise(() => {})
        },
      },
      createExit(async () => {}),
    )

    await bridge.ready()
    const disposing = bridge.dispose(5).catch((error: unknown) => error)
    await Bun.sleep(20)

    expect(subscribed).toBe(false)
    expect(await disposing).toBeInstanceOf(Error)
  })

  test("consumes a serialized worker RPC event without shared backend state", async () => {
    let exits = 0
    const target = {
      postMessage() {},
      onmessage: null as ((this: Worker, event: MessageEvent) => unknown) | null,
    }
    const client = Rpc.client<{ tuiReady: () => void; tuiGone: () => void }>(target)
    const bridge = createParentRemoteExitBridge(
      client,
      createExit(async () => void (exits += 1)),
    )

    target.onmessage?.call(
      target as unknown as Worker,
      new MessageEvent("message", {
        data: JSON.stringify({ type: "rpc.event", event: RemoteExitRpc.Event, data: undefined }),
      }),
    )
    await Promise.resolve()

    expect(exits).toBe(1)
    void bridge
  })
})
