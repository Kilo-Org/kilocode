// kilocode_change - new file
import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Rpc } from "@/util/rpc"
import { KiloRpcHandshake } from "@/kilocode/util/rpc-handshake"

/**
 * A request sent before the worker installs its handler must still be answered.
 *
 * The TUI's worker imports the whole server, so `Rpc.listen` runs hundreds of modules late. The
 * main process meanwhile races ahead to its first request, and how fast it gets there depends on
 * the terminal: one that answers the renderer's capability queries immediately skips a one-second
 * timeout and wins the race. A dropped message is unrecoverable — `Rpc.client.call` resolves only
 * on a reply and has neither a rejection path nor a timeout — so the TUI waits forever on a worker
 * that is alive and idle, painting one empty frame and accepting no input, with nothing logged.
 */
test("a request that arrives before the worker listens is still answered", async () => {
  const entry = fileURLToPath(new URL("./fixture/rpc/slow-worker.ts", import.meta.url))
  const worker = new Worker(entry)
  try {
    const client = Rpc.client<typeof import("./fixture/rpc/slow-worker").rpc>(worker as never)

    // No delay: the request is posted while the worker is still evaluating its own module body.
    const answered = await Promise.race([
      client.call("ping", { value: "hello" }),
      new Promise((resolve) => setTimeout(() => resolve("TIMED_OUT"), 5000)),
    ])

    expect(answered).toEqual({ echo: "hello" })
  } finally {
    worker.terminate()
  }
}, 15_000)

/**
 * Holding a request is only half an answer: a worker that dies before it announces anything would
 * otherwise turn the dropped-and-hung request into a queued-and-hung one, which is the same bug
 * with a longer name. What the caller must never get is silence.
 */
test("a request held for a worker that dies is rejected rather than held forever", async () => {
  const entry = fileURLToPath(new URL("./fixture/rpc/failing-worker.ts", import.meta.url))
  const worker = new Worker(entry)
  try {
    const client = Rpc.client<{ ping: (input: { value: string }) => { echo: string } }>(worker as never)

    const settled = await Promise.race([
      client.call("ping", { value: "hello" }).then(
        () => "RESOLVED",
        (error: Error) => error.message,
      ),
      new Promise((resolve) => setTimeout(() => resolve("TIMED_OUT"), 5000)),
    ])

    expect(settled).toBe("rpc target failed before it installed its handler")
  } finally {
    worker.terminate()
  }
}, 15_000)

/**
 * And a target that never announces and never errors must not grow the queue for the life of the
 * client: past the bound the caller is told, rather than joining a line that will not move.
 */
test("held requests are bounded, and the overflow is reported to its caller", () => {
  const posted: string[] = []
  const gate = KiloRpcHandshake.gate({ postMessage: (data: string) => void posted.push(data) })

  const failures: Error[] = []
  for (let i = 0; i < 300; i++) gate.send(`message-${i}`, (error) => failures.push(error))

  expect(posted).toEqual([])
  expect(failures).toHaveLength(300 - 256)
  expect(failures[0]?.message).toBe("rpc target has not installed its handler after 256 held requests")

  // What was held is still delivered, in order, once the target does announce.
  gate.accept({ type: "rpc.ready" })
  expect(posted).toHaveLength(256)
  expect(posted[0]).toBe("message-0")
  expect(posted[255]).toBe("message-255")
})
