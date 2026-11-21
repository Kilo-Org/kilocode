import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Profile } from "../src/profile"
import { binary, createVerdicts, environment, validate } from "../src/nono-binary"
import { generate } from "../src/nono-profile"

const live = process.platform === "darwin" && binary() ? describe : describe.skip

function env(home: string, temporary: string) {
  return environment({ HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: temporary })
}

test("caches a verdict and evicts the oldest entry at the cap", () => {
  const cache = createVerdicts(2)
  expect(cache.get("a")).toBeUndefined()
  cache.set("a", undefined)
  expect(cache.get("a")).toBeDefined()
  expect(cache.get("a")?.value).toBeUndefined()
  cache.set("b", "failed")
  cache.set("c", "failed")
  expect(cache.size).toBe(2)
  expect(cache.get("a")).toBeUndefined()
  expect(cache.get("b")?.value).toBe("failed")
  cache.set("b", "updated")
  expect(cache.size).toBe(2)
  expect(cache.get("b")?.value).toBe("updated")
})

live("nono profile validation", () => {
  test("rejects a malformed profile before the launch", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-nono-validate-"))
    try {
      const file = path.join(dir, "bad.json")
      await fs.writeFile(file, JSON.stringify({ extends: "default", filesystem: { nope: true } }))
      const problem = validate(file, env(os.homedir(), dir))
      expect(problem).toBeDefined()
      expect(problem).toContain("unknown field")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("accepts a generated profile", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-nono-validate-"))
    try {
      const profile: Profile = {
        filesystem: {
          allowWrite: [{ path: dir, kind: "subtree" }],
          denyWrite: [],
          denyNames: [],
          temporaryDirectory: dir,
        },
        network: { mode: "deny", allowedHosts: [] },
        environment: { deny: [], set: {} },
      }
      const generated = generate(profile, {
        cwd: dir,
        paths: { data: path.join(dir, "data"), config: path.join(dir, "config") },
      })
      const file = path.join(dir, "profile.json")
      await fs.writeFile(file, JSON.stringify(generated))
      expect(validate(file, env(os.homedir(), dir))).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
