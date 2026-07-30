import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test"
import { createHash } from "node:crypto"

let profileCalls = 0
mock.module("@kilocode/kilo-gateway", () => ({
  fetchProfile: async (token: string) => {
    profileCalls++
    if (token === "bad-token") return null
    return { email: `user-${token}@example.com` }
  },
}))

const { Identity } = await import("../identity.js")

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

let dir: string

beforeEach(() => {
  profileCalls = 0
  dir = mkdtempSync(path.join(tmpdir(), "kilo-telemetry-identity-"))
  Identity.reset()
  Identity.setDataPath(dir)
})

afterEach(() => {
  Identity.setDataPath("")
})

describe("Identity.updateFromKiloAuth profile cache", () => {
  test("fetches profile and writes cache keyed by token hash", async () => {
    await Identity.updateFromKiloAuth("token-a")
    expect(Identity.getUserId()).toBe("user-token-a@example.com")
    expect(profileCalls).toBe(1)

    const file = path.join(dir, "telemetry-profile.json")
    expect(existsSync(file)).toBe(true)
    const cache = JSON.parse(readFileSync(file, "utf8"))
    expect(cache.token).toBe(digest("token-a"))
    expect(cache.email).toBe("user-token-a@example.com")
    expect(cache.token).not.toBe("token-a")
    // The cache stores an email and a token verifier, so it must be owner-only.
    // POSIX only: Windows reports default mode bits and enforces access via ACLs.
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  test("uses cached email without a network request on later invocations", async () => {
    await Identity.updateFromKiloAuth("token-a")
    expect(profileCalls).toBe(1)

    // Simulate a fresh process: identity state resets, cache file persists.
    Identity.reset()
    await Identity.updateFromKiloAuth("token-a")
    expect(Identity.getUserId()).toBe("user-token-a@example.com")
    expect(profileCalls).toBe(1)
  })

  test("refetches when the token changes", async () => {
    await Identity.updateFromKiloAuth("token-a")
    Identity.reset()
    await Identity.updateFromKiloAuth("token-b")
    expect(Identity.getUserId()).toBe("user-token-b@example.com")
    expect(profileCalls).toBe(2)
  })

  test("clears identity when token is null", async () => {
    await Identity.updateFromKiloAuth("token-a")
    Identity.reset()
    await Identity.updateFromKiloAuth(null)
    expect(Identity.getUserId()).toBeNull()
    expect(profileCalls).toBe(1)
  })

  test("ignores a cache file for a different token", async () => {
    await Identity.updateFromKiloAuth("token-a")
    const file = path.join(dir, "telemetry-profile.json")
    const cache = JSON.parse(readFileSync(file, "utf8"))
    expect(cache.token).toBe(digest("token-a"))

    Identity.reset()
    await Identity.updateFromKiloAuth("token-b")
    expect(Identity.getUserId()).toBe("user-token-b@example.com")
  })
})
