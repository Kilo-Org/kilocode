import { describe, expect, test } from "bun:test"
import path from "path"
import { TestProfile } from "../../script/kilocode/test-profile"

const root = path.resolve(import.meta.dir, "..")
const glob = new Bun.Glob("**/*.test.{ts,tsx}")
const all = (await Array.fromAsync(glob.scan({ cwd: root }))).sort()

describe("test profiles", () => {
  test("darwin profile contains valid test files", () => {
    const result = TestProfile.resolve("darwin", all)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files.length).toBeGreaterThan(50)
    expect(result.files).toContain("pty/pty-session.test.ts")
    expect(result.files).toContain("kilocode/cli/install-artifact.test.ts")
    expect(result.files).toContain("kilocode/sandbox/macos-confinement.test.ts")
    expect(result.files).toContain("kilocode/sessions/remote-ws.test.ts")
    expect(result.files).toContain("kilocode/sessions/remote-sender.test.ts")
  })

  test("normalizes Windows test paths", () => {
    const result = TestProfile.resolve(
      "darwin",
      all.map((file) => file.replaceAll("/", "\\")),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files).toContain("pty/pty-session.test.ts")
    expect(result.files.some((file) => file.includes("\\"))).toBe(false)
  })

  test("unknown profiles fail with available names", () => {
    const result = TestProfile.resolve("unknown", all)
    expect(result).toEqual({
      ok: false,
      error: 'Unknown test profile "unknown". Available profiles: darwin',
    })
  })
})
