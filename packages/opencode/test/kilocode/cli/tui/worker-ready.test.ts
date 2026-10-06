import { describe, expect, test } from "bun:test"
import { WorkerReady } from "../../../../src/kilocode/cli/cmd/tui/worker-ready"
import { Rpc } from "../../../../src/util/rpc"
import { withTimeout } from "../../../../src/util/timeout"

const file = new URL("./fixture/gated-worker.ts", import.meta.url)

describe("TUI worker readiness", () => {
  test("waits for delayed initialization before sending RPC requests", async () => {
    const worker = new Worker(file)
    try {
      const boot = Promise.withResolvers<Int32Array>()
      worker.onmessage = (event) => boot.resolve(event.data)
      const gate = await withTimeout(boot.promise, 2_000)
      const client = Rpc.client<{ ping: () => string }>(worker)
      let settled = false
      const ready = WorkerReady.wait(client).then((value) => {
        settled = true
        return value
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      Atomics.store(gate, 0, 1)
      Atomics.notify(gate, 0)
      expect(await withTimeout(ready, 2_000, "worker never signaled readiness")).toBe(true)
      expect(await withTimeout(client.call("ping", undefined), 2_000, "worker never replied to RPC")).toBe("pong")
    } finally {
      worker.terminate()
    }
  })

  test("resolves false when the worker never signals readiness", async () => {
    const worker = new Worker(file)
    try {
      const boot = Promise.withResolvers<Int32Array>()
      worker.onmessage = (event) => boot.resolve(event.data)
      await withTimeout(boot.promise, 2_000)
      const client = Rpc.client(worker)
      expect(await WorkerReady.wait(client, 20)).toBe(false)
    } finally {
      worker.terminate()
    }
  })
})
