import { expect, test } from "bun:test"
import { defaultConfig } from "./config"
import { linkUpstream, repo } from "./testing"
import { getReleases, getSyncStatus } from "./version"

test("releases resolve to the parent of the tag, and the next sync is the oldest missing release", async () => {
  await using r = await repo()
  await r.write("a.txt", "1\n")
  const r26 = await r.release("v2.0.26", "2026-10-08T00:00:00Z")
  await r.git("branch", "v2")
  const r27 = await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  const r28 = await r.release("v2.0.28", "2026-10-13T12:00:00Z")
  // A tag that is not on upstream dev (for example a Kilo tag) is ignored.
  await r.git("switch", "-q", "-c", "other", r26)
  await r.release("v2.0.99", "2026-10-14T00:00:00Z")
  await r.git("switch", "-q", "dev")
  await linkUpstream(r)

  const cwd = process.cwd()
  process.chdir(r.dir)
  try {
    const releases = await getReleases(defaultConfig)
    expect(releases.map((x) => [x.tag, x.commit])).toEqual([
      ["v2.0.28", r28],
      ["v2.0.27", r27],
      ["v2.0.26", r26],
    ])
    expect(releases[0]?.tagCommit).not.toBe(r28)

    const status = await getSyncStatus("v2", defaultConfig)
    expect(status.merged?.tag).toBe("v2.0.26")
    expect(status.pending.map((x) => x.tag)).toEqual(["v2.0.28", "v2.0.27"])
    expect(status.next?.tag).toBe("v2.0.27")
    expect(status.lag).toEqual({ releases: 2, days: 5.5 })

    await r.git("switch", "-q", "v2")
    await r.git("merge", "-q", "--no-ff", "-m", "sync", r27)
    const after = await getSyncStatus("v2", defaultConfig)
    expect(after.merged?.tag).toBe("v2.0.27")
    expect(after.next?.tag).toBe("v2.0.28")
    expect(after.lag).toEqual({ releases: 1, days: 1.5 })
  } finally {
    process.chdir(cwd)
  }
})
