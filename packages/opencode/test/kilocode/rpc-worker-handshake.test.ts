// kilocode_change - new file
import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Rpc } from "@/util/rpc"
import { KiloRpcHandshake } from "@/kilocode/util/rpc-handshake"

test("a request that arrives before the worker listens is still answered", async () => {
  const entry = fileURLToPath(new URL("./fixture/rpc/slow-worker.ts", import.meta.url))
  const worker = new Worker(entry)
  try {
    const client = Rpc.client<typeof import("./fixture/rpc/slow-worker").rpc>(worker as never)

    const answered = await Promise.race([
      client.call("ping", { value: "hello" }),
      new Promise((resolve) => setTimeout(() => resolve("TIMED_OUT"), 5000)),
    ])

    expect(answered).toEqual({ echo: "hello" })
  } finally {
    worker.terminate()
  }
}, 15_000)

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

test("held requests are bounded, and the overflow is reported to its caller", () => {
  const posted: string[] = []
  const gate = KiloRpcHandshake.gate({ postMessage: (data: string) => void posted.push(data) })

  const failures: Error[] = []
  for (let i = 0; i < 300; i++) gate.send(`message-${i}`, (error) => failures.push(error))

  expect(posted).toEqual([])
  expect(failures).toHaveLength(300 - 256)
  expect(failures[0]?.message).toBe("rpc target has not installed its handler after 256 held requests")

  // Held requests are delivered in order once the target announces.
  gate.accept({ type: "rpc.ready" })
  expect(posted).toHaveLength(256)
  expect(posted[0]).toBe("message-0")
  expect(posted[255]).toBe("message-255")
})
