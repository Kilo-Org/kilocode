import { describe, expect, test } from "bun:test"
import path from "path"
import { TestProfile } from "../../script/kilocode/test-profile"

const root = path.resolve(import.meta.dir, "..")
const glob = new Bun.Glob("**/*.test.{ts,tsx}")
const all = (await Array.fromAsync(glob.scan({ cwd: root }))).map((file) => file.replaceAll("\\", "/")).sort()

describe("test profiles", () => {
  test("darwin profile contains valid test files", () => {
    const result = TestProfile.resolve("darwin", all)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files.length).toBeGreaterThan(50)
    expect(result.files).toContain("pty/pty-shell.test.ts")
    expect(result.files).toContain("kilocode/cli/install-artifact.test.ts")
    expect(result.files).toContain("kilocode/sandbox/macos-confinement.test.ts")
    expect(result.files).toContain("filesystem/filesystem.test.ts")
    expect(result.files).toContain("kilocode/interactive-terminal.test.ts")
    const sandbox = all.filter((file) => file.startsWith("kilocode/sandbox/"))
    expect(result.files.filter((file) => file.startsWith("kilocode/sandbox/"))).toEqual(sandbox)
    expect(result.files).not.toContain("cli/run/footer.view.test.tsx")
    expect(result.files).not.toContain("mcp/lifecycle.test.ts")
    expect(result.files).not.toContain("server/httpapi-pty-websocket.test.ts")
    expect(result.files).not.toContain("shell/shell.test.ts")
    expect(result.files).not.toContain("kilocode/sessions/remote-ws.test.ts")
    expect(result.files).not.toContain("provider/header-timeout.test.ts")
  })

  test("normalizes Windows test paths", () => {
    const result = TestProfile.resolve(
      "darwin",
      all.map((file) => file.replaceAll("/", "\\")),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files).toContain("pty/pty-shell.test.ts")
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
