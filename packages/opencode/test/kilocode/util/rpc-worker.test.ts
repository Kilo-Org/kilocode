import { describe, expect, test } from "bun:test"
import { KiloRpc } from "../../../src/kilocode/util/rpc"
import { withTimeout } from "../../../src/util/timeout"

/**
 * Exercises the transport against a real `Worker`, which the in-process channel tests in
 * rpc.test.ts cannot do: the bug was Bun discarding messages posted while a worker was still
 * initialising, so only a real worker held in that window reproduces it.
 */
const file = new URL("./fixture/gated-worker.ts", import.meta.url)

/** Start the fixture and return its gate once it is parked in the no-handler window. */
async function gated() {
  const worker = new Worker(file)
  const boot = Promise.withResolvers<Int32Array>()
  worker.onmessage = (event) => boot.resolve(event.data)
  const gate = await withTimeout(boot.promise, 5_000, "fixture never posted its gate")
  const release = () => Atomics.store(gate, 0, 1)
  return {
    worker,
    release,
    [Symbol.dispose]() {
      // Release before terminating so the fixture's poll loop can exit, rather than leaving a
      // live worker holding the test process open.
      release()
      worker.terminate()
    },
  }
}

describe("worker rpc against a real worker", () => {
  test("delivers a request posted while the worker is still initialising", async () => {
    using fixture = await gated()
    const client = KiloRpc.client<{ ping: (input: string) => string }>(fixture.worker)

    // Posted into the window that used to swallow requests outright.
    const inflight = client.call("ping", "early")
    fixture.release()

    expect(await withTimeout(inflight, 5_000, "request lost during worker startup")).toBe("pong early")
    expect(await withTimeout(client.ready, 5_000, "worker never announced readiness")).toBe(true)
  }, 20_000)

  test("serves requests issued after the worker is ready", async () => {
    using fixture = await gated()
    const client = KiloRpc.client<{ ping: (input: string) => string }>(fixture.worker)
    fixture.release()
    await withTimeout(client.ready, 5_000, "worker never announced readiness")

    expect(await withTimeout(client.call("ping", "late"), 5_000, "request never answered")).toBe("pong late")
  }, 20_000)

  test("reports a throwing worker handler instead of hanging", async () => {
    using fixture = await gated()
    const client = KiloRpc.client<{ boom: (input: undefined) => never }>(fixture.worker)
    fixture.release()
    await withTimeout(client.ready, 5_000, "worker never announced readiness")

    // Upstream replied only on success, so this call never settled. Settle the promise into a
    // value rather than awaiting `expect().rejects` directly: under bun test that bare await
    // does not pump the worker message that carries the rejection.
    const outcome = await withTimeout(
      client.call("boom", undefined).then(
        () => "resolved",
        (err) => (err instanceof Error ? err.message : String(err)),
      ),
      5_000,
      "throwing handler never reported back",
    )

    expect(outcome).toMatch(/worker rpc failed: handler exploded/)
  }, 20_000)

  test("reports readiness as false when the worker stays blocked", async () => {
    using fixture = await gated()
    const previous = process.env["KILO_RPC_HANDSHAKE_TIMEOUT"]
    process.env["KILO_RPC_HANDSHAKE_TIMEOUT"] = "200"
    try {
      // Gate is never released, so the worker never installs its handler.
      const client = KiloRpc.client<{ ping: (input: string) => string }>(fixture.worker)
      expect(await withTimeout(client.ready, 5_000, "readiness never settled")).toBe(false)

      const outcome = await withTimeout(
        client.call("ping", "lost").then(
          () => "resolved",
          (err) => (err instanceof Error ? err.message : String(err)),
        ),
        5_000,
        "call never settled after the bound elapsed",
      )

      expect(outcome).toMatch(/never became ready/)
    } finally {
      if (previous === undefined) delete process.env["KILO_RPC_HANDSHAKE_TIMEOUT"]
      if (previous !== undefined) process.env["KILO_RPC_HANDSHAKE_TIMEOUT"] = previous
    }
  }, 20_000)
})
