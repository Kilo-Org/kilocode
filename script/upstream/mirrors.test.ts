import { expect, test } from "bun:test"
import path from "node:path"
import { analyzeSync, generateMarkdownReport, type SyncReport } from "./utils/report"
import { defaultConfig } from "./utils/config"
import { linkUpstream, repo, type Repo } from "./utils/testing"

const script = path.join(import.meta.dir, "..", "check-mirrors.ts")

async function registry(
  r: Repo,
  mirrors: Record<string, { mirror: string; sha: string; why: string; invariants: string[] }>,
  file = "script/upstream/mirrors.json",
) {
  await r.write(file, JSON.stringify({ mirrors }, null, 2))
}

async function run(r: Repo, ...args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], { cwd: r.dir, stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  return { code: await proc.exited, stdout, output: stdout + (await new Response(proc.stderr).text()) }
}

test("a registered mirror matches the registry structure without a pin", async () => {
  await using r = await repo()
  await r.write("packages/cli/src/thing.ts", "export const upstream = 1\n")
  const pin = await r.commit("upstream")
  const sha = await r.git("rev-parse", `${pin}:packages/cli/src/thing.ts`)
  await r.write("packages/kilo-probe/src/thing.ts", "// kilo_mirror: packages/cli/src/thing.ts\nexport const kilo = 1\n")
  await registry(r, {
    "packages/cli/src/thing.ts": { mirror: "packages/kilo-probe/src/thing.ts", sha, why: "adds the kilo copy", invariants: ["keeps the kilo copy"] },
  })
  await r.commit("kilo")

  const result = await run(r)
  expect(result.code).toBe(0)
  expect(result.output).toContain("check-mirrors: ok")
  expect(result.output).toContain("1 mirror(s) registered, 1 marker(s) found")
  expect(result.stdout).not.toContain("At pin")

  const drift = await run(r, "--drift", "--pin", pin)
  expect(drift.code).toBe(0)
  expect(drift.stdout).toContain("At pin")
})

test("the structure check ignores drift, and --drift fails until the SHA is recorded", async () => {
  await using r = await repo()
  await r.write("packages/cli/src/thing.ts", "export const upstream = 1\n")
  const pin = await r.commit("upstream")
  const sha = await r.git("rev-parse", `${pin}:packages/cli/src/thing.ts`)
  const mirror = "packages/kilo-probe/src/thing.ts"
  await r.write(mirror, "// kilo_mirror: packages/cli/src/thing.ts\nexport const kilo = 1\n")
  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha, why: "adds the kilo copy", invariants: ["keeps the kilo copy"] } })
  await r.commit("kilo")

  await r.write("packages/cli/src/thing.ts", "export const upstream = 2\n")
  const next = await r.commit("upstream change")

  // This is what CI runs: a normal PR cannot re-merge a copy, so drift is not its failure.
  expect((await run(r)).code).toBe(0)

  const changed = await run(r, "--drift", "--pin", next)
  expect(changed.code).toBe(1)
  expect(changed.output).toContain("changed upstream")
  expect(changed.output).toContain("adds the kilo copy")

  // --pin implies drift, so the sync never has to remember both flags.
  expect((await run(r, "--pin", next)).code).toBe(1)

  const current = await r.git("rev-parse", `${next}:packages/cli/src/thing.ts`)
  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha: current, why: "adds the kilo copy", invariants: ["keeps the kilo copy"] } })
  expect((await run(r, "--drift", "--pin", next)).code).toBe(0)
})

test("a custom registry path is named in the error and a missing registry fails", async () => {
  await using r = await repo()
  await r.write("packages/cli/src/thing.ts", "export const upstream = 1\n")
  const pin = await r.commit("upstream")
  const sha = await r.git("rev-parse", `${pin}:packages/cli/src/thing.ts`)
  const mirror = "packages/kilo-probe/src/thing.ts"
  await r.write(mirror, "// kilo_mirror: packages/cli/src/thing.ts\nexport const kilo = 1\n")
  await registry(r, { "packages/cli/src/other.ts": { mirror, sha, why: "adds the kilo copy", invariants: ["keeps the kilo copy"] } }, "custom/mirrors.json")
  await r.commit("kilo")

  const unregistered = await run(r, "--registry", "custom/mirrors.json")
  expect(unregistered.code).toBe(1)
  expect(unregistered.output).toContain("custom/mirrors.json")

  const missing = await run(r, "--registry", "custom/absent.json")
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
  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha, why: "adds the kilo copy", invariants: ["keeps the kilo copy"] } })
  await r.commit("kilo")

  expect((await run(r)).code).toBe(0)
})

test("an unregistered marker, a marker mismatch and a missing copy fail without a pin", async () => {
  await using r = await repo()
  await r.write("packages/cli/src/thing.ts", "export const upstream = 1\n")
  const pin = await r.commit("upstream")
  const sha = await r.git("rev-parse", `${pin}:packages/cli/src/thing.ts`)
  const mirror = "packages/kilo-probe/src/thing.ts"
  await r.write(mirror, "// kilo_mirror: packages/cli/src/thing.ts\nexport const kilo = 1\n")
  await r.write("packages/kilo-probe/src/other.ts", "// kilo_mirror: packages/cli/src/other.ts\nexport const other = 1\n")
  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha, why: "adds the kilo copy", invariants: ["keeps the kilo copy"] } })
  await r.commit("kilo")

  const unregistered = await run(r)
  expect(unregistered.code).toBe(1)
  expect(unregistered.output).toContain("unregistered mirror: packages/kilo-probe/src/other.ts")

  await r.write(mirror, "// kilo_mirror: packages/cli/src/elsewhere.ts\nexport const kilo = 1\n")
  const mismatch = await run(r)
  expect(mismatch.code).toBe(1)
  expect(mismatch.output).toContain("must start with")

  await r.remove(mirror)
  const missing = await run(r)
  expect(missing.code).toBe(1)
  expect(missing.output).toContain("mirror is missing")
})

test("a removed upstream file is drift, not structure", async () => {
  await using r = await repo()
  const before = await r.commit("before the file existed")
  await r.write("packages/cli/src/thing.ts", "export const upstream = 1\n")
  await r.commit("upstream")
  const mirror = "packages/kilo-probe/src/thing.ts"
  await r.write(mirror, "// kilo_mirror: packages/cli/src/thing.ts\nexport const kilo = 1\n")
  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha: "0".repeat(40), why: "adds the kilo copy", invariants: ["keeps the kilo copy"] } })
  await r.commit("kilo")

  expect((await run(r)).code).toBe(0)
  const removed = await run(r, "--drift", "--pin", before)
  expect(removed.code).toBe(1)
  expect(removed.output).toContain("no longer exists at the pin")
})

test("an entry needs a why and an invariant to guide a re-merge", async () => {
  await using r = await repo()
  await r.write("packages/cli/src/thing.ts", "export const upstream = 1\n")
  const pin = await r.commit("upstream")
  const sha = await r.git("rev-parse", `${pin}:packages/cli/src/thing.ts`)
  const mirror = "packages/kilo-probe/src/thing.ts"
  await r.write(mirror, "// kilo_mirror: packages/cli/src/thing.ts\nexport const kilo = 1\n")

  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha, why: "  ", invariants: ["a rule"] } })
  await r.commit("empty why")
  const why = await run(r)
  expect(why.code).toBe(1)
  expect(why.output).toContain("`why` is empty")

  await registry(r, { "packages/cli/src/thing.ts": { mirror, sha, why: "a reason", invariants: [] } })
  const invariants = await run(r)
  expect(invariants.code).toBe(1)
  expect(invariants.output).toContain("`invariants` needs at least one non-empty rule")
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
  const why = "adds | the kilo copy"
  const invariants = ["keeps the kilo copy", "resolves imports through @opencode/cli/*"]
  await registry(r, {
    "src/a.ts": { mirror: "packages/kilo-probe/src/a.ts", sha: "0".repeat(40), why, invariants },
  })

  const cwd = process.cwd()
  process.chdir(r.dir)
  try {
    const result = await analyzeSync("v2", target, base, defaultConfig)
    expect(result.mirrorsTouched).toEqual([
      { upstream: "src/a.ts", mirror: "packages/kilo-probe/src/a.ts", why, invariants },
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
    expect(generateMarkdownReport(report)).toContain(
      [
        "### `src/a.ts` → `packages/kilo-probe/src/a.ts`",
        "",
        why,
        "",
        `- ${invariants[0]}`,
        `- ${invariants[1]}`,
      ].join("\n"),
    )
  } finally {
    process.chdir(cwd)
  }
})
