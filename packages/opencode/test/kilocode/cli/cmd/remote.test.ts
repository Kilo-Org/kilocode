// kilocode_change - new file
// K1 W1: verify `buildInstanceAdvertisement`'s payload shape as real behavior.
//
// The command handler's enablement path is covered in kilo-sessions.test.ts.
// These tests exercise the shared builder without the CLI lifecycle.

import { describe, expect, test } from "bun:test"
// Shared helper lives in kilo-sessions; remote.ts re-exports for the CLI path.
import { buildInstanceAdvertisement } from "../../../../src/kilo-sessions/instance-advertisement"

describe("RemoteCommand instance advertisement (K1 W1)", () => {
  test("buildInstanceAdvertisement resolves name/projectName/version from the directory and installation version", () => {
    const advertisement = buildInstanceAdvertisement("/Users/igor/projects/my-app")
    expect(advertisement.projectName).toBe("my-app")
    expect(typeof advertisement.name).toBe("string")
    expect(advertisement.name.length).toBeGreaterThan(0)
    expect(typeof advertisement.version).toBe("string")
  })

  test("keeps process identity across builder calls, directories, and kinds", async () => {
    const first = buildInstanceAdvertisement("/projects/first")
    // Advance past the timestamp resolution, not an asynchronous readiness boundary.
    await Bun.sleep(2)
    const second = buildInstanceAdvertisement("/projects/second", "remote")
    expect(first.kind).toBe("cli")
    expect(first.projectName).toBe("first")
    expect(second.kind).toBe("remote")
    expect(second.projectName).toBe("second")
    expect(second.startedAt).toBe(first.startedAt)
    expect(second.name).toBe(first.name)
    expect(first.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const start = Date.now() - process.uptime() * 1000
    expect(Date.parse(first.startedAt!)).toBeGreaterThanOrEqual(start - 100)
    expect(Date.parse(first.startedAt!)).toBeLessThanOrEqual(start + 100)
  })

  test("buildInstanceAdvertisement truncates an overlong project directory name to 64 chars", () => {
    const longName = "a".repeat(100)
    const advertisement = buildInstanceAdvertisement(`/Users/igor/projects/${longName}`)
    expect(advertisement.projectName.length).toBeLessThanOrEqual(64)
  })

  test("buildInstanceAdvertisement falls back to the full directory when basename is empty (root path)", () => {
    const advertisement = buildInstanceAdvertisement("/")
    expect(advertisement.projectName).toBe("/")
  })
})
