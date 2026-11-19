import { expect, test } from "bun:test"
import path from "node:path"
import { linkUpstream, repo, type Repo } from "./utils/testing"

const tool = path.join(import.meta.dir, "merge.ts")
const check = path.join(import.meta.dir, "..", "check-mirrors.ts")
const guard = path.join(import.meta.dir, "..", "check-workflows.ts")

/** Upstream at v2.0.26, and a Kilo `v2` branch from it that deleted `deploy.yml` */
async function fixture() {
  const r = await repo()
  await r.write("package.json", '{ "name": "fixture", "packageManager": "bun@1.4.2" }\n')
  await r.write(".gitignore", ["tmp/", "", "# Local dev files", "opencode-dev", ""].join("\n"))
  await r.write("src/a.ts", "export const a = 1\n")
  for (const name of ["check.yml", "check-test.yml", "deploy.yml"]) await r.write(`.github/workflows/${name}`, `name: ${name}\n`)
  await r.release("v2.0.26", "2026-10-08T00:00:00Z")
  await r.git("switch", "-q", "-c", "v2")
  await r.remove(".github/workflows/deploy.yml")
  await r.write(".github/workflows/kilo-v2.yml", "name: kilo-v2\n")
  await r.write(".github/workflows/kilo-v2-jetbrains.yml", "name: kilo-v2-jetbrains\n")
  await r.write(".github/workflows/kilo-v2-publish.yml", "name: kilo-v2-publish\n")
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

async function mirrors(r: Repo, ...args: string[]) {
  const proc = Bun.spawn(["bun", check, ...args], {
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

test("removes upstream files under a dropped package when the merge is clean", async () => {
  await using r = await fixture()
  await r.write("packages/session-ui/src/new-machine.ts", "export const machine = 1\n")
  await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  await linkUpstream(r)
  await r.git("switch", "-q", "-c", "sync-v2-0-27", "v2")

  const result = await run(r)
  expect(result.code).toBe(0)
  expect(result.output).toContain("Removed 1 skipped file(s)")
  expect(await Bun.file(path.join(r.dir, "packages/session-ui/src/new-machine.ts")).exists()).toBe(false)
  expect(await r.git("show", "--name-only", "--format=", "HEAD")).not.toContain("session-ui")
  expect(await r.git("status", "--porcelain")).toBe("")
})

test("stops for a new upstream workflow and a code conflict, with the merge in progress", async () => {
  await using r = await fixture()
  await r.write(".github/workflows/upstream-new.yml", "name: upstream-new\n")
  await r.write("src/a.ts", "export const a = 2\n")
  await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  await linkUpstream(r)
  await r.git("switch", "-q", "-c", "sync-v2-0-27", "v2")
  await r.write("src/a.ts", "export const a = 3 // kilocode_change\n")
  await r.commit("feat: kilo change")

  const result = await run(r)
  expect(result.code).toBe(1)
  expect(result.output).toContain("unexpected workflow: upstream-new.yml")
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

  const allowed = await run(r, "--version", "v2.0.28", "--allow-skip", "--dry-run")
  expect(allowed.code).toBe(0)
  expect(allowed.output).toContain("Skips v2.0.27 (--allow-skip)")
})

test("reconciles Kilo's marked root .gitignore rules with upstream .gitignore changes", async () => {
  await using r = await fixture()
  await r.git("switch", "-q", "v2")
  await r.write(
    ".gitignore",
    ["tmp/", "", "# Local dev files", "opencode-dev", "# kilocode_change: Kilo dev profile", ".kilo-v2-dev/", ""].join(
      "\n",
    ),
  )
  await r.commit("chore: kilo gitignore")
  await r.git("switch", "-q", "dev")
  await r.write(".gitignore", ["tmp/", "dist-node", "", "# Local dev files", "opencode-dev", ""].join("\n"))
  await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  await linkUpstream(r)
  await r.git("switch", "-q", "-c", "sync-v2-0-27", "v2")

  const result = await run(r)
  expect(result.code).toBe(0)
  expect(await Bun.file(path.join(r.dir, ".gitignore")).text()).toBe(
    [
      "tmp/",
      "dist-node",
      "",
      "# Local dev files",
      "opencode-dev",
      "# kilocode_change: Kilo dev profile",
      ".kilo-v2-dev/",
      "",
    ].join("\n"),
  )
  expect(await r.git("status", "--porcelain")).toBe("")
})

test("a --commit sync checks mirrors against the merged commit, not the previous release", async () => {
  await using r = await fixture()
  const release = await r.git("rev-parse", "v2.0.26^{commit}")
  const sha = await r.git("rev-parse", `${release}:src/a.ts`)
  await r.git("switch", "-q", "v2")
  await r.write("packages/kilo-probe/src/a.ts", "// kilo_mirror: src/a.ts\nexport const kilo = 1\n")
  await r.write(
    "script/upstream/mirrors.json",
    JSON.stringify(
      {
        mirrors: {
          "src/a.ts": {
            mirror: "packages/kilo-probe/src/a.ts",
            sha,
            why: "a test mirror",
            invariants: ["keep the kilo copy"],
          },
        },
      },
      null,
      2,
    ),
  )
  await r.commit("test: register a mirror")
  // The release sync in the history is what `pinned()` reads; without it the check falls back.
  await r.git("merge", "--no-ff", "-m", `chore(upstream): sync v2.0.26 (${release.slice(0, 11)})`, release)
  await r.git("switch", "-q", "dev")
  await r.write("src/a.ts", "export const a = 2\n")
  const target = await r.commit("fix: unreleased change")
  await linkUpstream(r)
  await r.git("switch", "-q", "-c", "sync-commit", "v2")

  const result = await run(r, "--commit", target)
  expect(result.code).toBe(1)
  expect(result.output).toContain("Mirrors touched: 1")
  expect(result.output).toContain("changed upstream")
  expect(result.output).toContain("The sync is incomplete")
  expect(await r.git("log", "-1", "--format=%s")).toContain(`sync dev-${target.slice(0, 11)}`)
  expect(
    await Bun.file(path.join(r.dir, ".git", "upstream-sync", `report-dev-${target.slice(0, 11)}.md`)).text(),
  ).toContain("`check-mirrors.ts --drift` fails")

  // The release pin is what the gate would have used: it does not see this drift.
  expect((await mirrors(r, "--drift", "--pin", release)).code).toBe(0)
  expect((await mirrors(r, "--drift", "--pin", target)).code).toBe(1)
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
