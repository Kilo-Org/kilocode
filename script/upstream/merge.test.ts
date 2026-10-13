import { expect, test } from "bun:test"
import path from "node:path"
import { linkUpstream, repo, type Repo } from "./utils/testing"

const tool = path.join(import.meta.dir, "merge.ts")
const guard = path.join(import.meta.dir, "..", "check-workflows.ts")

/** Upstream at v2.0.26, and a Kilo `v2` branch from it that deleted `deploy.yml` */
async function fixture() {
  const r = await repo()
  await r.write("package.json", '{ "name": "fixture", "packageManager": "bun@1.4.2" }\n')
  await r.write("src/a.ts", "export const a = 1\n")
  for (const name of ["check.yml", "test.yml", "deploy.yml"]) await r.write(`.github/workflows/${name}`, `name: ${name}\n`)
  await r.release("v2.0.26", "2026-10-08T00:00:00Z")
  await r.git("switch", "-q", "-c", "v2")
  await r.remove(".github/workflows/deploy.yml")
  await r.write(".github/workflows/kilo-v2.yml", "name: kilo-v2\n")
  await r.write("script/check-workflows.ts", await Bun.file(guard).text())
  await r.commit("chore(ci): kilo workflows")
  await r.git("switch", "-q", "dev")
  return r
}

async function run(r: Repo, ...args: string[]) {
  const proc = Bun.spawn(["bun", tool, "--base-branch", "HEAD", "--no-fetch", "--no-worktrees", "--no-install", ...args], {
    cwd: r.dir,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text())
  return { code: await proc.exited, output }
}

test("syncs the next release with a merge commit and keeps deleted workflows deleted", async () => {
  await using r = await fixture()
  await r.write(".github/workflows/deploy.yml", "name: deploy\non: push\n")
  await r.write("src/a.ts", "export const a = 2\n")
  const release = await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  await linkUpstream(r)
  await r.git("switch", "-q", "-c", "sync-v2-0-27", "v2")

  const result = await run(r)
  expect(result.output).toContain("Target: v2.0.27")
  expect(result.code).toBe(0)
  expect(await r.git("log", "-1", "--format=%s")).toBe(`chore(upstream): sync v2.0.27 (${release.slice(0, 11)})`)
  expect((await r.git("log", "-1", "--format=%P")).split(" ")).toEqual([await r.git("rev-parse", "v2"), release])
  expect(await Bun.file(path.join(r.dir, ".github/workflows/deploy.yml")).exists()).toBe(false)
  expect(await Bun.file(path.join(r.dir, "src/a.ts")).text()).toBe("export const a = 2\n")
  expect(await r.git("status", "--porcelain")).toBe("")
})

test("stops for a new upstream workflow and a code conflict, with the merge in progress", async () => {
  await using r = await fixture()
  await r.write(".github/workflows/deploy-update.yml", "name: deploy-update\n")
  await r.write("src/a.ts", "export const a = 2\n")
  await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  await linkUpstream(r)
  await r.git("switch", "-q", "-c", "sync-v2-0-27", "v2")
  await r.write("src/a.ts", "export const a = 3 // kilocode_change\n")
  await r.commit("feat: kilo change")

  const result = await run(r)
  expect(result.code).toBe(1)
  expect(result.output).toContain("unexpected workflow: deploy-update.yml")
  expect(result.output).toContain("src/a.ts")
  expect(await r.git("rev-parse", "-q", "--verify", "MERGE_HEAD")).not.toBe("")
  expect(await r.git("diff", "--name-only", "--diff-filter=U")).toBe("src/a.ts")
})

test("refuses a release that skips an older one", async () => {
  await using r = await fixture()
  await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  await r.release("v2.0.28", "2026-10-13T00:00:00Z")
  await linkUpstream(r)
  await r.git("switch", "-q", "-c", "sync", "v2")

  const result = await run(r, "--version", "v2.0.28")
  expect(result.code).toBe(1)
  expect(result.output).toContain("skips v2.0.27")
})

test("dry run reports the conflicts without changing the branch", async () => {
  await using r = await fixture()
  await r.write(".github/workflows/deploy.yml", "name: deploy\non: push\n")
  await r.write(".github/workflows/deploy-update.yml", "name: deploy-update\n")
  await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  await linkUpstream(r)
  await r.git("switch", "-q", "v2")
  const head = await r.git("rev-parse", "HEAD")

  const result = await run(r, "--dry-run")
  expect(result.code).toBe(0)
  expect(result.output).toContain(".github/workflows/deploy.yml (modify/delete): workflow")
  expect(result.output).toContain(".github/workflows/deploy-update.yml")
  expect(result.output).toContain("Lag before: 1 release(s)")
  expect(await r.git("rev-parse", "HEAD")).toBe(head)
  expect(await r.git("status", "--porcelain")).toBe("")
})
