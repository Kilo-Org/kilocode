#!/usr/bin/env bun
// Reproduces the baseline in migration-tracking/technical-notes/baseline/pinned-v2-baseline.md at the current upstream base.
//
// The base is the release commit that `pinned()` returns (the second parent of the newest
// `chore(upstream): sync v2.x.y (<sha>)` merge), so the script follows each sync without an edit.
// Ref verification is offline and always runs. --checks also runs the commands that CI runs on the
// v2 line (.github/workflows/check.yml, test.yml, kilo-v2.yml) and writes each output to
// migration-tracking/technical-notes/baseline/logs (gitignored by the root `logs/` rule).
//
// Usage:
//   bun migration-tracking/technical-notes/script/v2-baseline.ts                    # refs and ancestry
//   bun migration-tracking/technical-notes/script/v2-baseline.ts --checks           # plus every check
//   bun migration-tracking/technical-notes/script/v2-baseline.ts --checks --only test,cli-build

import { $ } from "bun"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pinned } from "../../../script/upstream/utils/upstream"

const ROOT = path.resolve(import.meta.dir, "../../..")
const LOGS = path.join(ROOT, "migration-tracking/technical-notes/baseline/logs")
// pinned() and the git helpers run in the working directory.
process.chdir(ROOT)

// CI order. `gated: false` marks checks CI does not run; the baseline records them, but they do not
// fail the run. Steps deliberately not mirrored:
// - check.yml `lint:changed`: pull requests only, against the merge's first parent.
// - test.yml `affected` and `e2e`: disabled on the fork (`if: false`), they test removed packages.
// - test.yml shards and `--affected`: the baseline runs every package once (core, tui and cli through their
//   own `test` script, which `test:ci` shards in CI), with --force so turbo replays no cached result.
// - test.yml Windows matrix, JUnit reports and artifact uploads; kilo-v2.yml CLI archive and upload, and
//   `migration progress comment` (posts to the PR). The darwin-arm64 or linux-x64 build of kilo-v2.yml is
//   the cli-build check on this host.
// - test.yml Node build: runs only on Node 26 or later, which CI pins (26.4.0).
const CHECKS: Check[] = [
  // .github/actions/setup-bun, used by every job that installs. A plain `bun install` can reorder
  // `patchedDependencies` in bun.lock on this tree; the frozen install fails on a real drift instead.
  { name: "install", cwd: ".", argv: ["bun", "install", "--frozen-lockfile"] },
  // check.yml
  { name: "check", cwd: ".", argv: ["bun", "run", "check"] },
  // test.yml unit
  { name: "effect-simplification-rules", cwd: ".", argv: ["bun", "run", "test:effect-simplification-rules"] },
  { name: "effect-simplifications", cwd: ".", argv: ["bun", "run", "lint:effect-simplifications"] },
  {
    name: "test",
    cwd: ".",
    argv: ["bun", "turbo", "test", "--concurrency=3", "--continue", "--force"],
    env: { GITHUB_ACTIONS: "false" },
    isolate: true,
  },
  { name: "codemode-publish-dry-run", cwd: "packages/codemode", argv: ["bun", "run", "script/publish.ts", "--dry-run"] },
  { name: "client-check-generated", cwd: "packages/client", argv: ["bun", "run", "check:generated"] },
  { name: "www-check-generated", cwd: "services/www", argv: ["bun", "run", "check:generated"] },
  // test.yml sdk
  { name: "sdk-verify-package", cwd: ".", argv: ["bun", "turbo", "verify:package", "--filter=@opencode/sdk"] },
  // test.yml build, kilo-v2.yml build
  { name: "cli-build", cwd: "packages/cli", argv: ["bun", "run", "script/build.ts", "--single", "--skip-install"] },
  {
    name: "cli-binary-version",
    cwd: ".",
    argv: ["bash", "-c", `binary=(packages/cli/dist/cli-${process.platform}-${process.arch}/bin/*) && "\${binary[0]}" --version`],
  },
  { name: "cli-service-smoke", cwd: "packages/cli", argv: ["bun", "run", "script/service-smoke.ts"], isolate: true },
  {
    name: "node-build",
    cwd: "packages/cli",
    argv: ["bun", "run", "script/build-node.ts", "--single", "--skip-install", "--outdir=dist/node"],
    skip: nodeTooOld,
  },
  { name: "node-service-smoke", cwd: "packages/cli", argv: ["bun", "run", "script/service-smoke.ts", "--node"], skip: nodeTooOld, isolate: true },
  // kilo-v2.yml
  { name: "workflow-allowlist", cwd: ".", argv: ["bun", "script/check-workflows.ts"] },
  { name: "opencode-annotations", cwd: ".", argv: ["bun", "script/check-opencode-annotations.ts"] },
  { name: "shared-patches", cwd: ".", argv: ["bun", "script/check-shared-patches.ts"] },
  { name: "progress-map", cwd: ".", argv: ["bun", "script/upstream/progress.ts", "--check"], skip: noV1Target },
  { name: "upstream-install", cwd: "script/upstream", argv: ["bun", "install", "--frozen-lockfile"] },
  { name: "upstream-typecheck", cwd: "script/upstream", argv: ["bun", "run", "typecheck"] },
  { name: "upstream-test", cwd: "script/upstream", argv: ["bun", "test"] },
  { name: "kilo-import-rule", cwd: "script/upstream", argv: ["bun", "placement.ts", "--imports"] },
  { name: "kilo-plugin-test", cwd: "packages/kilo-plugin", argv: ["bun", "test"], isolate: true },
  { name: "kilo-cli-test", cwd: "packages/kilo-cli", argv: ["bun", "test"], isolate: true },
  { name: "kilo-cli-startup", cwd: "packages/kilo-cli", argv: ["bun", "run", "startup"] },
  { name: "test-runner-test", cwd: "script/kilocode/test", argv: ["bun", "test"] },
  // Not run by CI; recorded in the baseline.
  { name: "effect-patterns", cwd: ".", argv: ["bun", "run", "lint:effect-patterns"], gated: false },
  { name: "protocol-check-generated", cwd: "packages/protocol", argv: ["bun", "run", "check:generated"], gated: false },
]

type Check = {
  name: string
  cwd: string
  argv: string[]
  env?: Record<string, string>
  /** Run with HOME-like directories in a temp dir, as the v2-migration skill requires for tests */
  isolate?: boolean
  /** A reason to skip on this host, or undefined */
  skip?: () => Promise<string | undefined>
  gated?: boolean
}

const git = async (...args: string[]) => (await $`git ${args}`.quiet().nothrow()).stdout.toString().trim()
const exists = async (ref: string) => (await $`git rev-parse --verify -q ${ref}^{commit}`.quiet().nothrow()).exitCode === 0
const ancestor = async (a: string, b: string) => (await $`git merge-base --is-ancestor ${a} ${b}`.quiet().nothrow()).exitCode === 0

const pin = await pinned("HEAD")

console.log("# refs")
console.log(`${"pin".padEnd(14)} ${pin.commit}  (${pin.tag}, from pinned() in script/upstream/utils/upstream.ts)`)
for (const ref of ["HEAD", "origin/v2", "origin/main", "upstream/dev", "upstream/v2"])
  console.log(`${ref.padEnd(14)} ${(await exists(ref)) ? await git("rev-parse", ref) : "(not present locally)"}`)

console.log("\n# ancestry")
const upstream = await exists("upstream/dev")
const assertions = [
  { label: `pin ${pin.commit.slice(0, 11)} is an ancestor of HEAD`, ok: await ancestor(pin.commit, "HEAD") },
  ...(upstream
    ? [
        {
          label: `pin ${pin.commit.slice(0, 11)} is an ancestor of upstream/dev (if not: fetch upstream dev, or upstream rewrote history)`,
          ok: await ancestor(pin.commit, "upstream/dev"),
        },
      ]
    : []),
]
for (const assertion of assertions) console.log(`${assertion.ok ? "ok  " : "FAIL"} ${assertion.label}`)
if (!upstream) console.log("skip upstream/dev is not present locally; `git fetch upstream dev` to check it")
if (assertions.some((assertion) => !assertion.ok)) {
  console.log("\nbaseline ancestry broken; refusing to run checks")
  process.exit(1)
}
console.log(`info HEAD carries ${await git("rev-list", "--count", `${pin.commit}..HEAD`)} commit(s) on top of the pin`)
if (upstream)
  console.log(`info upstream/dev is ${await git("rev-list", "--count", `${pin.commit}..upstream/dev`)} commit(s) past the pin`)

if (!Bun.argv.includes("--checks")) {
  console.log("\npass --checks to run the CI commands")
  process.exit(0)
}

const only = Bun.argv.includes("--only") ? new Set(Bun.argv[Bun.argv.indexOf("--only") + 1]?.split(",")) : undefined
const unknown = [...(only ?? [])].filter((name) => !CHECKS.some((check) => check.name === name))
if (unknown.length > 0) {
  console.log(`\nunknown check(s): ${unknown.join(", ")}. Known: ${CHECKS.map((check) => check.name).join(", ")}`)
  process.exit(1)
}

await mkdir(LOGS, { recursive: true })
console.log(`\n# checks (bun ${Bun.version}, node ${await nodeVersion()}, ${process.platform}-${process.arch})`)
const started = Bun.nanoseconds()
const results = []
for (const check of CHECKS.filter((check) => !only || only.has(check.name))) {
  const reason = await check.skip?.()
  if (reason) {
    console.log(`skip ${check.name.padEnd(28)} ${reason}`)
    continue
  }
  const log = path.join(LOGS, `${check.name}.log`)
  const home = check.isolate ? await mkdtemp(path.join(tmpdir(), "kilo-v2-baseline-")) : undefined
  const begin = Bun.nanoseconds()
  const proc = Bun.spawn(check.argv, {
    cwd: path.join(ROOT, check.cwd),
    env: { ...process.env, ...check.env, ...(home ? isolated(home) : {}) },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (home) await rm(home, { recursive: true, force: true })
  await Bun.write(log, `$ ${check.argv.join(" ")}\n(cwd ${check.cwd})\n\n${stdout}${stderr}`)
  const seconds = ((Bun.nanoseconds() - begin) / 1e9).toFixed(1)
  const gated = check.gated !== false
  results.push({ name: check.name, code, gated })
  const status = code === 0 ? "ok  " : gated ? "FAIL" : "red "
  console.log(`${status} ${check.name.padEnd(28)} ${seconds.padStart(7)}s  ${path.relative(ROOT, log)}${gated ? "" : "  (not run by CI)"}`)
}
console.log(`\ntotal ${((Bun.nanoseconds() - started) / 1e9 / 60).toFixed(1)} min`)

// Upstream tests can leave servers behind (v2-migration skill, "Isolation").
const leftovers = (await $`pgrep -fl ${"opencode-test-|opencode-service-lifecycle"}`.quiet().nothrow()).stdout.toString().trim()
if (leftovers) console.log(`\nleft-over test processes, stop them:\n${leftovers}`)

// Known reds are reported, never suppressed: compare them with the current capture before attributing
// them to a Kilo change.
console.log(
  "\ncompare failures with migration-tracking/technical-notes/baseline/pinned-v2-baseline.md, and with origin/v2 before your change",
)
process.exit(results.some((result) => result.gated && result.code !== 0) ? 1 : 0)

function isolated(home: string) {
  return {
    OPENCODE_TEST_HOME: home,
    XDG_DATA_HOME: path.join(home, "data"),
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_STATE_HOME: path.join(home, "state"),
    XDG_CACHE_HOME: path.join(home, "cache"),
  }
}

async function nodeVersion() {
  return (await $`node --version`.quiet().nothrow()).stdout.toString().trim() || "absent"
}

async function nodeTooOld() {
  const version = await nodeVersion()
  const major = Number(version.match(/^v(\d+)/)?.[1] ?? 0)
  return major >= 26 ? undefined : `CI pins Node 26.4.0 for the Node build; this host has ${version}`
}

async function noV1Target() {
  return (await exists("origin/main")) ? undefined : "origin/main is not present locally; `git fetch origin main`"
}
