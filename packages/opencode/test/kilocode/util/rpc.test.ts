import { describe, expect, test } from "bun:test"
import { KiloRpc } from "../../../src/kilocode/util/rpc"

/**
 * Drives the real transport over a pair of ports, so the worker side runs the actual
 * `arm`/`listen` globals the compiled worker uses. `arm` and `listen` assign the worker
 * global `onmessage`, so each test installs its own channel and restores the globals.
 */
function channel() {
  const parent = {
    postMessage: (data: string) => {
      // parent -> worker
      const handler = globalThis.onmessage
      if (handler) handler.call(globalThis as unknown as Window, { data } as MessageEvent<any>)
    },
    onmessage: null as ((this: Worker, ev: MessageEvent<any>) => any) | null,
  }
  const previous = { onmessage: globalThis.onmessage, postMessage: globalThis.postMessage }
  // worker -> parent
  globalThis.postMessage = ((data: string) => {
    parent.onmessage?.call(undefined as unknown as Worker, { data } as MessageEvent<any>)
  }) as typeof globalThis.postMessage
  globalThis.onmessage = null
  return {
    parent,
    [Symbol.dispose]() {
      globalThis.onmessage = previous.onmessage
      globalThis.postMessage = previous.postMessage
    },
  }
}

describe("worker rpc", () => {
  test("replays requests posted before listen installs a handler", async () => {
    using wire = channel()
    KiloRpc.arm()
    const client = KiloRpc.client<{ echo: (input: string) => string }>(wire.parent)

    // Issued while the worker is still "starting": upstream dropped these outright.
    const inflight = client.call("echo", "queued")
    KiloRpc.listen({ echo: (input: string) => `got ${input}` })

    expect(await inflight).toBe("got queued")
  })

  test("resolves requests that arrive after the handler is ready", async () => {
    using wire = channel()
    KiloRpc.arm()
    KiloRpc.listen({ echo: (input: string) => `got ${input}` })
    const client = KiloRpc.client<{ echo: (input: string) => string }>(wire.parent)

    expect(await client.call("echo", "live")).toBe("got live")
  })

  test("rejects when the worker method throws instead of hanging", async () => {
    using wire = channel()
    KiloRpc.arm()
    KiloRpc.listen({
      boom: () => {
        throw new Error("handler exploded")
      },
    })
    const client = KiloRpc.client<{ boom: (input: undefined) => never }>(wire.parent)

    await expect(client.call("boom", undefined)).rejects.toThrow(/worker rpc failed: handler exploded/)
  })

  test("rejects when the worker rejects asynchronously", async () => {
    using wire = channel()
    KiloRpc.arm()
    KiloRpc.listen({ boom: async () => Promise.reject(new Error("async exploded")) })
    const client = KiloRpc.client<{ boom: (input: undefined) => never }>(wire.parent)

    await expect(client.call("boom", undefined)).rejects.toThrow(/worker rpc failed: async exploded/)
  })

  test("rejects an unknown method instead of hanging", async () => {
    using wire = channel()
    KiloRpc.arm()
    KiloRpc.listen({ known: () => "ok" })
    const client = KiloRpc.client<{ missing: (input: undefined) => never }>(wire.parent)

    await expect(client.call("missing", undefined)).rejects.toThrow(/unknown method missing/)
  })

  test("delivers events to subscribers", async () => {
    using wire = channel()
    const client = KiloRpc.client<{ noop: (input: undefined) => void }>(wire.parent)
    const seen: string[] = []
    const off = client.on<string>("tick", (data) => seen.push(data))

    globalThis.postMessage(JSON.stringify({ type: "rpc.event", event: "tick", data: "one" }))
    off()
    globalThis.postMessage(JSON.stringify({ type: "rpc.event", event: "tick", data: "two" }))

    expect(seen).toEqual(["one"])
  })

  test("recovers when the worker was ready before the client attached", async () => {
    using wire = channel()
    KiloRpc.arm()
    // Worker announces itself with nobody listening, so that announcement is lost.
    KiloRpc.listen({ echo: (input: string) => input })
    const client = KiloRpc.client<{ echo: (input: string) => string }>(wire.parent)

    // The client's probe has to recover readiness, otherwise both sides wait forever.
    expect(await client.call("echo", "first")).toBe("first")
    expect(await client.call("echo", "second")).toBe("second")
  })

  test("holds requests until the worker announces itself", async () => {
    using wire = channel()
    const seen: string[] = []
    const parent = {
      postMessage: (data: string) => {
        seen.push(data)
        wire.parent.postMessage(data)
      },
      get onmessage() {
        return wire.parent.onmessage
      },
      set onmessage(handler) {
        wire.parent.onmessage = handler
      },
    }
    const client = KiloRpc.client<{ echo: (input: string) => string }>(parent)
    const requests = () => seen.filter((data) => JSON.parse(data).type === "rpc.request")

    const inflight = client.call("echo", "waiting")
    // No request may reach a worker that has not said it is ready: this is the window where
    // the compiled worker is still evaluating its imports and silently drops messages.
    expect(requests()).toEqual([])

    KiloRpc.arm()
    KiloRpc.listen({ echo: (input: string) => `got ${input}` })

    expect(await inflight).toBe("got waiting")
    expect(requests().length).toBe(1)
  })

  test("rejects queued calls when the worker never becomes ready", async () => {
    using wire = channel()
    const previous = process.env["KILO_RPC_HANDSHAKE_TIMEOUT"]
    process.env["KILO_RPC_HANDSHAKE_TIMEOUT"] = "150"
    try {
      // The worker side never calls listen, so rpc.ready never arrives.
      const client = KiloRpc.client<{ echo: (input: string) => string }>(wire.parent)
      await expect(client.call("echo", "lost")).rejects.toThrow(/never became ready within 150ms/)
    } finally {
      if (previous === undefined) delete process.env["KILO_RPC_HANDSHAKE_TIMEOUT"]
      if (previous !== undefined) process.env["KILO_RPC_HANDSHAKE_TIMEOUT"] = previous
    }
  })
})
