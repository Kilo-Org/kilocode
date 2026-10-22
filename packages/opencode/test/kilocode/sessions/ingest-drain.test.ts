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

  test("underlying run() rejection resolves, logs once, and does not retry", async () => {
    let calls = 0
    const errors: unknown[] = []
    const drain = IngestDrain.create(
      async () => {
        calls += 1
        throw new Error("boom")
      },
      (err) => {
        errors.push(err)
      },
    )

    await expect(drain()).resolves.toBeUndefined()
    await expect(drain()).resolves.toBeUndefined()
    expect(calls).toBe(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    expect((errors[0] as Error).message).toBe("boom")
  })
})
