import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../../fixture/fixture"
import { detectRepo, findRepoFrom } from "../../../src/kilocode/cli/dev-setup"

// Simulate a repo root by writing the sentinel file detectRepo looks for.
async function makeSynthRepo(dir: string) {
  const pkg = path.join(dir, "packages", "opencode")
  await fs.mkdir(pkg, { recursive: true })
  await Bun.write(path.join(pkg, "package.json"), JSON.stringify({ name: "synth" }))
  return dir
}

async function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env[name]
    else process.env[name] = prev
  }
}

describe("findRepoFrom", () => {
  test("returns the repo root when started from a nested path", async () => {
    await using tmp = await tmpdir()
    await makeSynthRepo(tmp.path)
    const nested = path.join(tmp.path, "packages", "opencode", "src", "kilocode", "cli")
    await fs.mkdir(nested, { recursive: true })

    const found = await findRepoFrom(nested)
    expect(found).toBe(tmp.path)
  })

  test("returns the repo root when started from the root itself", async () => {
    await using tmp = await tmpdir()
    await makeSynthRepo(tmp.path)

    const found = await findRepoFrom(tmp.path)
    expect(found).toBe(tmp.path)
  })

  test("returns undefined when no sentinel is found up to filesystem root", async () => {
    await using tmp = await tmpdir()
    // No packages/opencode/package.json anywhere under tmp, and the filesystem
    // above tmp does not contain a kilocode repo at its own root.
    const found = await findRepoFrom(tmp.path)
    expect(found).toBeUndefined()
  })
})

describe("detectRepo", () => {
  test("honours KILO_DEV_REPO without touching the filesystem", async () => {
    // Pointing at a path that does not exist — the hint must be returned as-is
    // (this proves no walk happens when KILO_DEV_REPO is set).
    const hint = "/definitely/does/not/exist/kilo-repo"
    const got = await withEnv("KILO_DEV_REPO", hint, () => detectRepo())
    expect(got).toBe(hint)
  })

  test("KILO_DEV_REPO wins over the filesystem walk", async () => {
    // Build a synthetic repo, point KILO_DEV_REPO at it, and run from an
    // unrelated cwd. Even though the walk from cwd (inside the real kilo
    // checkout) would succeed, the hint must take priority.
    await using tmp = await tmpdir()
    await makeSynthRepo(tmp.path)

    const got = await withEnv("KILO_DEV_REPO", tmp.path, () => detectRepo())
    expect(got).toBe(tmp.path)
  })
})
