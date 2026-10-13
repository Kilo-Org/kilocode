import { expect, test } from "bun:test"
import path from "node:path"
import { repo, type Repo } from "./utils/testing"
import type { Baseline } from "./utils/baseline"

const annotations = path.join(import.meta.dir, "..", "check-opencode-annotations.ts")
const counter = path.join(import.meta.dir, "..", "check-shared-patches.ts")

async function fixture() {
  const r = await repo()
  await r.write("src/a.ts", "export const a = 1\n")
  await r.write("config.json", '{ "a": 1 }\n')
  const pin = await r.commit("upstream")
  return { r, pin }
}

async function baseline(r: Repo, value: Baseline) {
  await r.write("script/upstream/shared-patches.json", JSON.stringify(value))
}

async function run(r: Repo, script: string, pin: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", script, "--pin", pin, ...args], { cwd: r.dir, stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  return { code: await proc.exited, stdout, output: stdout + (await new Response(proc.stderr).text()) }
}

const empty = { limits: { files: 0, markedLines: 0, unmarkedLines: 0, deletedFiles: 0 }, files: {} }

test("marked lines and Kilo-owned files pass, unmarked lines fail", async () => {
  const { r, pin } = await fixture()
  await using _ = r
  await r.write("src/a.ts", "export const a = 1\nexport const k = 2 // kilocode_change\n")
  await r.write("packages/core/src/kilocode/k.ts", "export const k = 1\n")
  await r.write("src/new.ts", "// kilocode_change - new file\nexport const n = 1\n")
  await baseline(r, empty)
  await r.commit("kilo")
  expect((await run(r, annotations, pin)).code).toBe(0)

  await r.write("src/a.ts", "export const a = 1\nexport const k = 2 // kilocode_change\nexport const x = 3\n")
  await r.commit("kilo unmarked")
  const result = await run(r, annotations, pin)
  expect(result.code).toBe(1)
  expect(result.output).toContain("src/a.ts:3: export const x = 3")
  expect(result.output).not.toContain("kilocode/k.ts")

  // --worktree reads the working tree, untracked files included.
  await r.write("src/a.ts", "export const a = 1\n")
  await r.write("src/untracked.ts", "export const u = 1\n")
  const worktree = await run(r, annotations, pin, "--worktree")
  expect(worktree.code).toBe(1)
  expect(worktree.output).toContain("src/untracked.ts:1")
  expect(worktree.output).not.toContain("src/a.ts")
})

test("a JSON change needs an unmarked reason in the baseline", async () => {
  const { r, pin } = await fixture()
  await using _ = r
  await r.write("config.json", '{ "a": 2 }\n')
  await baseline(r, empty)
  await r.commit("kilo json")
  expect((await run(r, annotations, pin)).code).toBe(1)

  await baseline(r, {
    limits: { files: 1, markedLines: 0, unmarkedLines: 1, deletedFiles: 0 },
    files: { "config.json": { rung: 3, seam: "test", unmarked: "JSON has no comments" } },
  })
  await r.commit("baseline")
  expect((await run(r, annotations, pin)).code).toBe(0)
  expect((await run(r, counter, pin)).code).toBe(0)
})

test("the counter fails on a new shared patch without a seam and on a count above its limit", async () => {
  const { r, pin } = await fixture()
  await using _ = r
  await r.write("src/a.ts", "export const a = 1 // kilocode_change\n")
  await baseline(r, empty)
  await r.commit("kilo")
  const missing = await run(r, counter, pin)
  expect(missing.code).toBe(1)
  expect(missing.output).toContain("new shared patch without a stated seam: src/a.ts")
  expect(missing.output).toContain("files grew from 0 to 1")

  await baseline(r, {
    limits: { files: 1, markedLines: 1, unmarkedLines: 0, deletedFiles: 0 },
    files: { "src/a.ts": { rung: 3, seam: "test seam" } },
  })
  await r.commit("baseline")
  const ok = await run(r, counter, pin)
  expect(ok.code).toBe(0)
  expect(ok.output).toContain("| src/a.ts | M | 3 | 1 | 0 | 1 |")

  await r.write("src/a.ts", "export const a = 1 // kilocode_change\n// kilocode_change start\nexport const b = 2\n// kilocode_change end\n")
  await r.commit("bigger patch")
  const grew = await run(r, counter, pin)
  expect(grew.code).toBe(1)
  expect(grew.output).toContain("markedLines grew from 1 to 4")

  await r.remove("config.json")
  await r.commit("delete shared file")
  const json = JSON.parse((await run(r, counter, pin, "--json")).stdout)
  expect(json.counts).toEqual({ files: 1, markedLines: 4, unmarkedLines: 0, deletedFiles: 1 })
})
