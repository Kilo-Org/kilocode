import { expect, test } from "bun:test"
import path from "node:path"
import { linkUpstream, repo } from "./utils/testing"

const script = path.join(import.meta.dir, "list-versions.ts")

async function run(dir: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, script, "--no-fetch", ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

test("--json prints the sync status as one JSON object and nothing else", async () => {
  await using r = await repo()
  await r.write("a.txt", "1\n")
  const r26 = await r.release("v2.0.26", "2026-10-08T00:00:00Z")
  await r.git("branch", "v2")
  const r27 = await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  const r28 = await r.release("v2.0.28", "2026-10-13T12:00:00Z")
  await linkUpstream(r)

  const behind = await run(r.dir, "--json", "--base", "v2")
  expect(behind.code, behind.stderr).toBe(0)
  const status = JSON.parse(behind.stdout)
  expect(status).toMatchObject({
    base: "v2",
    merged: { tag: "v2.0.26", commit: r26 },
    next: { tag: "v2.0.27", commit: r27 },
    lag: { releases: 2, days: 5.5 },
  })
  expect(status.pending.map((x: { tag: string; commit: string }) => [x.tag, x.commit])).toEqual([
    ["v2.0.28", r28],
    ["v2.0.27", r27],
  ])
  expect(Date.parse(status.pending[0].date)).toBe(Date.parse("2026-10-13T12:00:00Z"))

  // A base that has the newest release has nothing pending.
  const current = await run(r.dir, "--json", "--base", "dev")
  expect(current.code, current.stderr).toBe(0)
  expect(JSON.parse(current.stdout)).toMatchObject({
    base: "dev",
    merged: { tag: "v2.0.28" },
    next: null,
    pending: [],
    lag: { releases: 0, days: 0 },
  })
})

test("--json keeps a failure off stdout", async () => {
  await using r = await repo()
  await r.write("a.txt", "1\n")
  await r.release("v2.0.26", "2026-10-08T00:00:00Z")

  // No upstream remote.
  const missing = await run(r.dir, "--json", "--base", "dev")
  expect(missing.code).toBe(1)
  expect(missing.stdout).toBe("")
  expect(missing.stderr).toContain("No 'upstream' remote")

  // A base that does not resolve is an error, not a base without releases.
  await linkUpstream(r)
  const unknown = await run(r.dir, "--json", "--base", "no-such-ref")
  expect(unknown.code).toBe(1)
  expect(unknown.stdout).toBe("")
  expect(unknown.stderr).toContain("Base 'no-such-ref' is not a commit")
})

test("without --json the status is the table for people", async () => {
  await using r = await repo()
  await r.write("a.txt", "1\n")
  await r.release("v2.0.26", "2026-10-08T00:00:00Z")
  await r.git("branch", "v2")
  await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  await linkUpstream(r)

  const result = await run(r.dir, "--base", "v2")
  expect(result.code, result.stderr).toBe(0)
  expect(result.stdout).toContain("Upstream v2 Releases")
  expect(result.stdout).toContain("bun script/upstream/merge.ts --version v2.0.27")
})
