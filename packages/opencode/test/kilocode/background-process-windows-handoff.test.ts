import { expect, test } from "bun:test"
import { Process } from "@/util/process"
import path from "path"
import { tmpdir } from "../fixture/fixture"

async function live(mode: string) {
  await using tmp = await tmpdir()
  const file = path.join(import.meta.dirname, "fixtures/background-process-job.ts")
  const result = await Process.text([process.execPath, file, tmp.path, mode], {
    nothrow: true,
    abort: AbortSignal.timeout(40_000),
  })
  expect(result.code).toBe(0)
  expect(result.stderr.toString()).toBe("")
  return JSON.parse(result.text)
}

test.skipIf(process.platform !== "win32")(
  "an assigned job retains a detached grandchild through query and kill failures",
  async () => {
    const result = await live("detached")
    expect(result.active).toBe(0)
    expect(result.guarded).toBe(true)
    expect(result.unsafe).toBe(true)
    expect(result.state.walks).toBe(0)
    expect(result.state.kills).toBeGreaterThan(1)
    expect(result.elapsed).toBeGreaterThanOrEqual(5_000)
    for (const action of ["query", "kill"]) {
      expect(result.notes.filter((note: string) => note.includes(`job ${action} failed`))).toHaveLength(1)
      expect(result.notes.filter((note: string) => note.includes(`job ${action} recovered`))).toHaveLength(1)
    }
    expect(result.code).toBe(17)
    expect(result.after).toEqual([])
  },
  45_000,
)

test.skipIf(process.platform !== "win32")(
  "stop-file check and removal errors do not leave the job or block confirmed completion",
  async () => {
    const result = await live("files")
    expect(result.checks).toBeGreaterThanOrEqual(1)
    expect(result.notes.some((note: string) => note.includes("ERR_INVALID_ARG_VALUE"))).toBe(true)
    expect(result.notes.some((note: string) => note.includes("EBUSY"))).toBe(true)
    expect(result.state.walks).toBe(0)
    expect(result.check.error).toBeUndefined()
    expect(result.remove.error).toBeUndefined()
    expect(result.after).toEqual([])
  },
  45_000,
)
