import { afterEach, describe, expect, test } from "bun:test"
import { WorkerReady } from "../../../../src/kilocode/cli/cmd/tui/worker-ready"
import { Rpc } from "../../../../src/util/rpc"
import { withTimeout } from "../../../../src/util/timeout"

const file = new URL("./fixture/slow-worker.ts", import.meta.url)
const workers: Worker[] = []

function spawn(env?: Record<string, string>) {
  const worker = new Worker(file, { env })
  workers.push(worker)
  return Rpc.client<{ ping: () => string }>(worker)
}

afterEach(() => {
  for (const worker of workers.splice(0)) worker.terminate()
})

describe("TUI worker ready handshake", () => {
  test("calls made after the ready signal reach a slow-starting worker", async () => {
    const client = spawn()
    const ready = WorkerReady.wait(client)

    expect(await ready).toBe(true)
    expect(await withTimeout(client.call("ping", undefined), 2_000)).toBe("pong")
  })

  test("resolves false when the worker never signals ready", async () => {
    const client = spawn({ KILO_TEST_WORKER_SILENT: "1", KILO_TEST_WORKER_DELAY: "0" })

    expect(await WorkerReady.wait(client, 300)).toBe(false)
  })
})
