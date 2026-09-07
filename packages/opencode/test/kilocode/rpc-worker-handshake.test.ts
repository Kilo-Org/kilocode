// kilocode_change - new file
import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Rpc } from "@/util/rpc"

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
