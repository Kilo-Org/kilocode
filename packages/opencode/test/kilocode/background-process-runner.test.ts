import { describe, expect, test } from "bun:test"
import { BackgroundProcessRunner } from "@/kilocode/background-process/runner"

const start = Date.parse("2026-10-03T20:00:00.000Z")

function birth(offset: number) {
  return `/Date(${start + offset})/`
}

describe("BackgroundProcessRunner.walk", () => {
  test("adopts the leader's children and their descendants", () => {
    const rows = [
      { pid: 100, parent: 4, birth: birth(0) },
      { pid: 200, parent: 100, birth: birth(10) },
      { pid: 300, parent: 200, birth: birth(20) },
    ]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start })
    expect([...result.keys()].toSorted((a, b) => a - b)).toEqual([200, 300])
  })

  test("does not adopt a process created before its claimed parent", () => {
    // 900 was started by an earlier process that also had PID 200; that process is gone
    // and Windows reused the PID for the leader's child.
    const rows = [
      { pid: 100, parent: 4, birth: birth(0) },
      { pid: 200, parent: 100, birth: birth(10) },
      { pid: 900, parent: 200, birth: birth(-3_600_000) },
    ]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start })
    expect(result.has(200)).toBe(true)
    expect(result.has(900)).toBe(false)
  })

  test("does not adopt a process created before the leader", () => {
    const rows = [{ pid: 900, parent: 100, birth: birth(-60_000) }]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start })
    expect(result.size).toBe(0)
  })

  test("keeps a detached child whose leader already exited", () => {
    const rows = [{ pid: 200, parent: 100, birth: birth(30) }]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start, end: start + 40 })
    expect([...result.keys()]).toEqual([200])
  })

  test("ignores children of an unrelated process that reused the leader pid", () => {
    const rows = [
      { pid: 100, parent: 4, birth: birth(5_000) },
      { pid: 600, parent: 100, birth: birth(5_010) },
    ]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start, end: start + 40 })
    expect(result.size).toBe(0)
  })

  test("drops tracked processes whose pid now belongs to another process", () => {
    const rows = [{ pid: 200, parent: 4, birth: birth(9_000) }]
    const result = BackgroundProcessRunner.walk(rows, new Map([[200, birth(10)]]))
    expect(result.size).toBe(0)
  })

  test("reads ISO creation dates as well", () => {
    const rows = [
      { pid: 200, parent: 100, birth: new Date(start + 10).toISOString() },
      { pid: 900, parent: 200, birth: new Date(start - 60_000).toISOString() },
    ]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start })
    expect([...result.keys()]).toEqual([200])
  })
})
