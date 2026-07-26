import { describe, expect, test } from "bun:test"
import { IngestDrain } from "../../../src/kilo-sessions/ingest-drain"

describe("IngestDrain once-guard", () => {
  test("overlapping invocations share a single underlying drain call", async () => {
    let calls = 0
    let resolveDrain!: () => void
    const gate = new Promise<void>((resolve) => {
      resolveDrain = resolve
    })

    const drain = IngestDrain.create(async () => {
      calls += 1
      await gate
    })

    const first = drain()
    const second = drain()
    expect(calls).toBe(1)

    resolveDrain()
    await Promise.all([first, second])
    expect(calls).toBe(1)

    await drain()
    expect(calls).toBe(1)
  })

  test("sequential calls after completion still run only once", async () => {
    let calls = 0
    const drain = IngestDrain.create(async () => {
      calls += 1
    })

    await drain()
    await drain()
    await drain()
    expect(calls).toBe(1)
  })
})
