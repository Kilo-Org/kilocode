import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { WorktreeDiff } from "../../src/kilocode/review/worktree-diff"

describe("WorktreeDiff summary", () => {
  async function setup() {
    return await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "tracked.txt"), "hello\n")
        await $`git add tracked.txt`.cwd(dir).quiet()
        await $`git commit -m "init"`.cwd(dir).quiet()
      },
    })
  }

  test("summary returns metadata without loading contents", async () => {
    await using tmp = await setup()
    await Bun.write(path.join(tmp.path, "tracked.txt"), "hello\nworld\n")
    await fs.mkdir(path.join(tmp.path, "node_modules", "pkg"), { recursive: true })
    await Bun.write(path.join(tmp.path, "node_modules", "pkg", "index.js"), "module.exports = 1\n")

    const diffs = await WorktreeDiff.summary({ dir: tmp.path, base: "HEAD" })
    const tracked = diffs.find((diff) => diff.file === "tracked.txt")
    const generated = diffs.find((diff) => diff.file === "node_modules/pkg/index.js")

    expect(tracked).toBeDefined()
    expect(tracked?.tracked).toBe(true)
    expect(tracked?.summarized).toBe(true)
    expect(tracked?.before).toBe("")
    expect(tracked?.after).toBe("")
    expect(tracked?.status).toBe("modified")

    expect(generated).toBeDefined()
    expect(generated?.tracked).toBe(false)
    expect(generated?.generatedLike).toBe(true)
    expect(generated?.summarized).toBe(true)
    expect(generated?.before).toBe("")
    expect(generated?.after).toBe("")
    expect(generated?.additions).toBe(1)
    expect(generated?.status).toBe("added")
    expect(generated?.stamp?.length).toBeGreaterThan(0)
  })

  test("detail loads one file and computes untracked line counts", async () => {
    await using tmp = await setup()
    await fs.mkdir(path.join(tmp.path, "vendor"), { recursive: true })
    await Bun.write(path.join(tmp.path, "vendor", "bundle.js"), "one\ntwo\nthree\n")

    const diff = await WorktreeDiff.detail({ dir: tmp.path, base: "HEAD", file: "vendor/bundle.js" })

    expect(diff).toBeDefined()
    expect(diff?.summarized).toBe(false)
    expect(diff?.tracked).toBe(false)
    expect(diff?.generatedLike).toBe(true)
    expect(diff?.before).toBe("")
    expect(diff?.after).toBe("one\ntwo\nthree\n")
    expect(diff?.additions).toBe(3)
    expect(diff?.status).toBe("added")
  })
})
