import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { sizes } from "../../src/agent-manager/orphans/size"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-orphan-size-"))
  tempDirs.push(dir)
  return dir
}

describe("orphan-size sizes", () => {
  it("sums regular file sizes across nested directories", async () => {
    const root = await tempDir()
    await fs.writeFile(path.join(root, "a.txt"), "a".repeat(10))
    await fs.mkdir(path.join(root, "nested"))
    await fs.writeFile(path.join(root, "nested", "b.txt"), "b".repeat(20))

    const result = await sizes([root])

    expect(result.get(root)).toBe(30)
  })

  it("never follows symlinks and skips them from the total", async () => {
    const root = await tempDir()
    await fs.writeFile(path.join(root, "real.txt"), "x".repeat(100))
    const outside = await tempDir()
    await fs.writeFile(path.join(outside, "big.txt"), "y".repeat(5000))
    await fs.symlink(path.join(outside, "big.txt"), path.join(root, "link.txt"))

    const result = await sizes([root])

    expect(result.get(root)).toBe(100)
  })

  it("omits a path that fails outright rather than throwing", async () => {
    const missing = path.join(os.tmpdir(), "kilo-orphan-size-does-not-exist")

    const result = await sizes([missing])

    expect(result.has(missing)).toBe(false)
  })

  it("omits an unreadable directory's contents without failing the whole path", async () => {
    if (process.platform === "win32") return // chmod semantics differ; covered on posix CI runners.
    const root = await tempDir()
    await fs.writeFile(path.join(root, "visible.txt"), "z".repeat(10))
    const locked = path.join(root, "locked")
    await fs.mkdir(locked)
    await fs.writeFile(path.join(locked, "hidden.txt"), "h".repeat(1000))
    await fs.chmod(locked, 0)

    try {
      const result = await sizes([root])
      // The visible file is still counted; the unreadable subtree is silently skipped rather than
      // making the whole path fail.
      expect(result.get(root)).toBe(10)
    } finally {
      await fs.chmod(locked, 0o755)
    }
  })

  it("computes several paths with bounded concurrency", async () => {
    const roots = await Promise.all(
      Array.from({ length: 6 }, async (_v, i) => {
        const dir = await tempDir()
        await fs.writeFile(path.join(dir, "f.txt"), "q".repeat(i + 1))
        return dir
      }),
    )

    const result = await sizes(roots, { concurrency: 2 })

    roots.forEach((dir, i) => expect(result.get(dir)).toBe(i + 1))
  })

  it("stops early once the signal is aborted", async () => {
    const root = await tempDir()
    await fs.writeFile(path.join(root, "a.txt"), "a".repeat(10))
    const controller = new AbortController()
    controller.abort()

    const result = await sizes([root], { signal: controller.signal })

    expect(result.size).toBe(0)
  })
})
