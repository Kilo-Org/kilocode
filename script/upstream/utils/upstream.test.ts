import { expect, test } from "bun:test"
import { defaultConfig } from "./config"
import { linkUpstream, repo } from "./testing"
import { pinned, syncMessage } from "./upstream"

test("the pin is the upstream parent of the newest sync merge", async () => {
  await using r = await repo()
  await r.write("a.txt", "1\n")
  const r26 = await r.release("v2.0.26", "2026-10-08T00:00:00Z")
  await r.git("branch", "v2")
  const r27 = await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  const r28 = await r.release("v2.0.28", "2026-10-13T00:00:00Z")
  await linkUpstream(r)
  await r.git("switch", "-q", "v2")
  const config = { ...defaultConfig, initialBase: r26 }

  const cwd = process.cwd()
  process.chdir(r.dir)
  try {
    expect(await pinned("HEAD", config)).toEqual({ tag: "initial", commit: r26 })

    // The sync merge lands on v2 through a pull request merge commit.
    await r.git("switch", "-q", "-c", "sync-v2-0-27")
    await r.git("merge", "-q", "--no-ff", "-m", syncMessage("v2.0.27", r27), r27)
    await r.git("switch", "-q", "v2")
    await r.write("kilo.txt", "kilo\n")
    await r.commit("feat: kilo work")
    await r.git("merge", "-q", "--no-ff", "-m", "Merge pull request #1 from sync-v2-0-27", "sync-v2-0-27")
    expect(await pinned("HEAD", config)).toEqual({ tag: "v2.0.27", commit: r27 })

    await r.git("merge", "-q", "--no-ff", "-m", syncMessage("v2.0.28", r28), r28)
    expect(await pinned("HEAD", config)).toEqual({ tag: "v2.0.28", commit: r28 })
  } finally {
    process.chdir(cwd)
  }
})

test("sync message uses an 11 character SHA", () => {
  expect(syncMessage("v2.0.27", "4d9678a79d6367ad1257c258049075e7a2d0c6c8")).toBe(
    "chore(upstream): sync v2.0.27 (4d9678a79d6)",
  )
})
