import { expect, test } from "bun:test"
import path from "node:path"
import { analyzeSync, generateMarkdownReport, type SyncReport } from "./utils/report"
import { defaultConfig } from "./utils/config"
import { linkUpstream, repo, type Repo } from "./utils/testing"

const script = path.join(import.meta.dir, "..", "check-mirrors.ts")

async function registry(
  r: Repo,
  mirrors: Record<string, { mirror: string; sha: string; changes: string }>,
  file = "script/upstream/mirrors.json",
) {
  await r.write(file, JSON.stringify({ mirrors }, null, 2))
}

async function run(r: Repo, ...args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], { cwd: r.dir, stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  return { code: await proc.exited, stdout, output: stdout + (await new Response(proc.stderr).text()) }
}

test("a registered mirror matches the pinned upstream file", async () => {
  await using r = await repo()
  await r.write("packages/cli/src/thing.ts", "export const upstream = 1\n")
  const pin = await r.commit("upstream")
  const sha = await r.git("rev-parse", `${pin}:packages/cli/src/thing.ts`)
  await r.write("packages/kilo-probe/src/thing.ts", "// kilo_mirror: packages/cli/src/thing.ts\nexport const kilo = 1\n")
  await registry(r, {
    "packages/cli/src/thing.ts": { mirror: "packages/kilo-probe/src/thing.ts", sha, changes: "adds the kilo copy" },
  })
  await r.commit("kilo")

  const result = await run(r, "--pin", pin)
  expect(result.code).toBe(0)
  expect(result.output).toContain("check-mirrors: ok")
  expect(result.output).toContain("1 mirror(s) registered, 1 marker(s) found")
})

test("an upstream change fails with the recorded intent until the copy and the SHA are updated", async () => {
  await using r = await repo()
  await r.write("packages/cli/src/thing.ts", "export const upstream = 1\n")
  const pin = await r.commit("upstream")
  const sha = await r.git("rev-parse", `${pin}:packages/cli/src/thing.ts`)
  const mirror = "packages/kilo-probe/src/thing.ts"
  await r.write(mirror, "// kilo_mirror: packages/cli/src/thing.ts\nexport const kilo = 1\n")
  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha, changes: "adds the kilo copy" } })
  await r.commit("kilo")

  await r.write("packages/cli/src/thing.ts", "export const upstream = 2\n")
  const next = await r.commit("upstream change")
  const changed = await run(r, "--pin", next)
  expect(changed.code).toBe(1)
  expect(changed.output).toContain("changed upstream")
  expect(changed.output).toContain("adds the kilo copy")

  const current = await r.git("rev-parse", `${next}:packages/cli/src/thing.ts`)
  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha: current, changes: "adds the kilo copy" } })
  expect((await run(r, "--pin", next)).code).toBe(0)
})

test("a custom registry path is named in the error and a missing registry fails", async () => {
  await using r = await repo()
  await r.write("packages/cli/src/thing.ts", "export const upstream = 1\n")
  const pin = await r.commit("upstream")
  const sha = await r.git("rev-parse", `${pin}:packages/cli/src/thing.ts`)
  const mirror = "packages/kilo-probe/src/thing.ts"
  await r.write(mirror, "// kilo_mirror: packages/cli/src/thing.ts\nexport const kilo = 1\n")
  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha: "0".repeat(40), changes: "adds the kilo copy" } }, "custom/mirrors.json")
  await r.commit("kilo")

  const changed = await run(r, "--pin", pin, "--registry", "custom/mirrors.json")
  expect(changed.code).toBe(1)
  expect(changed.output).toContain("custom/mirrors.json")

  const missing = await run(r, "--pin", pin, "--registry", "custom/absent.json")
  expect(missing.code).toBe(1)
  expect(missing.output).toContain("registry not found: custom/absent.json")
})

test("a CRLF copy marker is read", async () => {
  await using r = await repo()
  await r.write("packages/cli/src/thing.ts", "export const upstream = 1\n")
  const pin = await r.commit("upstream")
  const sha = await r.git("rev-parse", `${pin}:packages/cli/src/thing.ts`)
  const mirror = "packages/kilo-probe/src/thing.ts"
  await r.write(mirror, "// kilo_mirror: packages/cli/src/thing.ts\r\nexport const kilo = 1\r\n")
  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha, changes: "adds the kilo copy" } })
  await r.commit("kilo")

  expect((await run(r, "--pin", pin)).code).toBe(0)
})

test("an unregistered marker, a marker mismatch, a missing copy and a removed upstream file fail", async () => {
  await using r = await repo()
  await r.write("packages/cli/src/thing.ts", "export const upstream = 1\n")
  const pin = await r.commit("upstream")
  const sha = await r.git("rev-parse", `${pin}:packages/cli/src/thing.ts`)
  const mirror = "packages/kilo-probe/src/thing.ts"
  await r.write(mirror, "// kilo_mirror: packages/cli/src/thing.ts\nexport const kilo = 1\n")
  await r.write("packages/kilo-probe/src/other.ts", "// kilo_mirror: packages/cli/src/other.ts\nexport const other = 1\n")
  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha, changes: "adds the kilo copy" } })
  await r.commit("kilo")

  const unregistered = await run(r, "--pin", pin)
  expect(unregistered.code).toBe(1)
  expect(unregistered.output).toContain("unregistered mirror: packages/kilo-probe/src/other.ts")

  await r.write(mirror, "// kilo_mirror: packages/cli/src/elsewhere.ts\nexport const kilo = 1\n")
  const mismatch = await run(r, "--pin", pin)
  expect(mismatch.code).toBe(1)
  expect(mismatch.output).toContain("must start with")

  await r.remove(mirror)
  const missing = await run(r, "--pin", pin)
  expect(missing.code).toBe(1)
  expect(missing.output).toContain("mirror is missing")

  await r.write(mirror, "// kilo_mirror: packages/cli/src/thing.ts\nexport const kilo = 1\n")
  await registry(r, { "packages/cli/src/gone.ts": { mirror, sha, changes: "adds the kilo copy" } })
  const removed = await run(r, "--pin", pin)
  expect(removed.code).toBe(1)
  expect(removed.output).toContain("no longer exists at the pin")
})

test("analysis lists mirrors whose upstream file changed", async () => {
  await using r = await repo()
  await r.write("src/a.ts", "export const a = 1\n")
  const base = await r.release("v2.0.26", "2026-10-08T00:00:00Z")
  await r.git("switch", "-q", "-c", "v2")
  await r.commit("kilo")
  await r.git("switch", "-q", "dev")
  await r.write("src/a.ts", "export const a = 2\n")
  const target = await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  await linkUpstream(r)
  const changes = "adds | the\nkilo copy"
  await registry(r, {
    "src/a.ts": { mirror: "packages/kilo-probe/src/a.ts", sha: "0".repeat(40), changes },
  })

  const cwd = process.cwd()
  process.chdir(r.dir)
  try {
    const result = await analyzeSync("v2", target, base, defaultConfig)
    expect(result.mirrorsTouched).toEqual([
      { upstream: "src/a.ts", mirror: "packages/kilo-probe/src/a.ts", changes },
    ])

    const report: SyncReport = {
      timestamp: "2026-10-12T00:00:00Z",
      release: { version: "2.0.27", tag: "v2.0.27", tagCommit: target, commit: target, date: "2026-10-12T00:00:00Z" },
      baseBranch: "v2",
      baseCommit: base,
      mergeBranch: "sync-v2-0-27",
      analysis: result,
      lagBefore: { releases: 0, days: 0 },
      lagAfter: { releases: 0, days: 0 },
      notes: [],
    }
    expect(generateMarkdownReport(report)).toContain("adds \\| the kilo copy")
  } finally {
    process.chdir(cwd)
  }
})
