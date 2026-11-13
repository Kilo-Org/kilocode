import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Identity } from "../src/identity"

// A local Kilo API stand-in: `/api/profile` answers `user-<token>@example.com` for a bearer token, and 401 for
// `bad-token`.
const calls: string[] = []
const api = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
    calls.push(new URL(request.url).pathname)
    if (token === "bad-token") return new Response(null, { status: 401 })
    return Response.json({ user: { email: `user-${token}@example.com` } })
  },
})
const server = api.url.origin

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

const state = { dir: "" }

beforeEach(() => {
  calls.length = 0
  state.dir = mkdtempSync(path.join(tmpdir(), "kilo-telemetry-identity-"))
  Identity.reset()
  Identity.resetMachine()
  Identity.setDataPath(state.dir)
})

afterEach(() => {
  Identity.setDataPath("")
  Identity.resetMachine()
})

afterAll(() => api.stop(true))

describe("Identity", () => {
  test("getDistinctId returns 'unknown' when no machineId or userId set", () => {
    expect(Identity.getDistinctId()).toBe("unknown")
  })

  test("reset clears userId and organizationId", () => {
    Identity.setOrganizationId("org-123")
    expect(Identity.getOrganizationId()).toBe("org-123")
    Identity.reset()
    expect(Identity.getOrganizationId()).toBeNull()
    expect(Identity.getUserId()).toBeNull()
  })

  test("the machine ID is created once in the data path and reused", async () => {
    const previous = process.env.KILO_MACHINE_ID
    delete process.env.KILO_MACHINE_ID
    try {
      const id = await Identity.getMachineId()
      expect(id).toMatch(/^[0-9a-f-]{36}$/)
      expect(readFileSync(path.join(state.dir, "telemetry-id"), "utf8")).toBe(id!)
      Identity.resetMachine()
      expect(await Identity.getMachineId()).toBe(id)
      expect(Identity.getDistinctId()).toBe(id!)
    } finally {
      if (previous !== undefined) process.env.KILO_MACHINE_ID = previous
    }
  })

  test("KILO_MACHINE_ID overrides the stored machine ID", async () => {
    const previous = process.env.KILO_MACHINE_ID
    process.env.KILO_MACHINE_ID = "editor-machine"
    try {
      expect(await Identity.getMachineId()).toBe("editor-machine")
      expect(existsSync(path.join(state.dir, "telemetry-id"))).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.KILO_MACHINE_ID
      else process.env.KILO_MACHINE_ID = previous
    }
  })
})

describe("Identity.updateFromKiloAuth profile cache", () => {
  test("fetches profile and writes cache keyed by token hash", async () => {
    await Identity.updateFromKiloAuth("token-a", undefined, server)
    expect(Identity.getUserId()).toBe("user-token-a@example.com")
    expect(calls).toEqual(["/api/profile"])

    const file = path.join(state.dir, "telemetry-profile.json")
    const cache = JSON.parse(readFileSync(file, "utf8"))
    expect(cache.token).toBe(digest("token-a"))
    expect(cache.email).toBe("user-token-a@example.com")
    expect(cache.token).not.toBe("token-a")
    // The cache stores an email and a token verifier, so it must be owner-only.
    // POSIX only: Windows reports default mode bits and enforces access via ACLs.
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  test("uses cached email without a network request on later invocations", async () => {
    await Identity.updateFromKiloAuth("token-a", undefined, server)
    // A fresh process: identity state resets, the cache file persists.
    Identity.reset()
    await Identity.updateFromKiloAuth("token-a", undefined, server)
    expect(Identity.getUserId()).toBe("user-token-a@example.com")
    expect(calls).toHaveLength(1)
  })

  test("refetches when the token changes", async () => {
    await Identity.updateFromKiloAuth("token-a", undefined, server)
    Identity.reset()
    await Identity.updateFromKiloAuth("token-b", undefined, server)
    expect(Identity.getUserId()).toBe("user-token-b@example.com")
    expect(calls).toHaveLength(2)
  })

  test("clears identity when token is null", async () => {
    await Identity.updateFromKiloAuth("token-a", "org-1", server)
    expect(Identity.getOrganizationId()).toBe("org-1")
    await Identity.updateFromKiloAuth(null, undefined, server)
    expect(Identity.getUserId()).toBeNull()
    expect(Identity.getOrganizationId()).toBeNull()
    expect(calls).toHaveLength(1)
  })

  test("a rejected token leaves the user anonymous and writes no cache", async () => {
    await Identity.updateFromKiloAuth("bad-token", undefined, server)
    expect(Identity.getUserId()).toBeNull()
    expect(existsSync(path.join(state.dir, "telemetry-profile.json"))).toBe(false)
  })

  test("refreshes a stale cache in the background and keeps using it", async () => {
    await Bun.write(
      path.join(state.dir, "telemetry-profile.json"),
      JSON.stringify({ token: digest("token-a"), email: "old@example.com", fetchedAt: 0 }),
    )
    await Identity.updateFromKiloAuth("token-a", undefined, server)
    expect(Identity.getUserId()).toBe("old@example.com")
    for (let attempt = 0; attempt < 100 && calls.length === 0; attempt++) await Bun.sleep(10)
    await Bun.sleep(50)
    const cache = JSON.parse(readFileSync(path.join(state.dir, "telemetry-profile.json"), "utf8"))
    expect(cache.email).toBe("user-token-a@example.com")
  })
})
