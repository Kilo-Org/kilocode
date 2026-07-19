import { describe, expect, it } from "bun:test"
import { checkFile } from "./file-link-validator"

// A fake validateFiles that records its calls and returns the given existing
// set. Paths not in `existing` are reported as missing.
function fake(existing: string[]) {
  const calls: Array<{ sessionID: string; paths: string[] }> = []
  const fn = (sessionID: string, paths: string[]) => {
    calls.push({ sessionID, paths })
    return Promise.resolve(paths.filter((p) => existing.includes(p)))
  }
  return { fn, calls }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("checkFile", () => {
  it("coalesces in-flight requests for the same path into one call", async () => {
    const v = fake(["./a.ts"])
    const [r1, r2] = await Promise.all([checkFile("ses_dedup", "./a.ts", v.fn), checkFile("ses_dedup", "./a.ts", v.fn)])
    expect(r1).toBe(true)
    expect(r2).toBe(true)
    expect(v.calls.length).toBe(1)
  })

  it("batches distinct paths from the same tick into a single call", async () => {
    const v = fake(["./a.ts"])
    const [a, b] = await Promise.all([checkFile("ses_batch", "./a.ts", v.fn), checkFile("ses_batch", "./b.ts", v.fn)])
    expect(a).toBe(true)
    expect(b).toBe(false)
    expect(v.calls.length).toBe(1)
    expect(v.calls[0].paths.sort()).toEqual(["./a.ts", "./b.ts"])
  })

  it("caches a confirmed positive result", async () => {
    const v = fake(["./cached.ts"])
    expect(await checkFile("ses_pos", "./cached.ts", v.fn)).toBe(true)
    expect(await checkFile("ses_pos", "./cached.ts", v.fn)).toBe(true)
    expect(v.calls.length).toBe(1)
  })

  it("re-validates a negative result after its TTL expires", async () => {
    const v = fake([])
    expect(await checkFile("ses_neg", "./missing.ts", v.fn, { negativeTtlMs: 10 })).toBe(false)
    // Within TTL: served from cache, no new call.
    expect(await checkFile("ses_neg", "./missing.ts", v.fn, { negativeTtlMs: 10 })).toBe(false)
    expect(v.calls.length).toBe(1)
    await new Promise((r) => setTimeout(r, 20))
    // After TTL: re-checked.
    expect(await checkFile("ses_neg", "./missing.ts", v.fn, { negativeTtlMs: 10 })).toBe(false)
    expect(v.calls.length).toBe(2)
  })

  it("resolves undefined (never false) when validation keeps failing", async () => {
    const calls: number[] = []
    const rejecting = (_s: string, _p: string[]) => {
      calls.push(1)
      return Promise.reject(new Error("timeout"))
    }
    const result = await checkFile("ses_fail", "./slow.ts", rejecting, { maxAttempts: 2, retryDelayMs: 5 })
    expect(result).toBeUndefined()
    expect(calls.length).toBe(2) // initial + one retry

    // A failure is not cached, so a later success still resolves true.
    const v = fake(["./slow.ts"])
    await tick()
    expect(await checkFile("ses_fail", "./slow.ts", v.fn)).toBe(true)
    expect(v.calls.length).toBe(1)
  })
})
