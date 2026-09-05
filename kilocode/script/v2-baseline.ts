#!/usr/bin/env bun
// Reproduces the pinned-baseline evidence in kilocode/baseline/pinned-v2-baseline.md.
// Ref verification is offline and always runs; --checks additionally replays the
// authoritative upstream v2 CI commands and writes their output to
// kilocode/baseline/logs (gitignored).

import { $ } from "bun"
import { mkdir } from "node:fs/promises"
import path from "node:path"

const PINNED_V2 = "76dbaf20adbd43fd208a00ef3cda4a51e125a234"
const ROOT = path.resolve(import.meta.dir, "../..")
const LOGS = path.join(ROOT, "kilocode/baseline/logs")

// Mirrors .github/workflows/typecheck.yml and the `unit` job of .github/workflows/test.yml
// at the pinned SHA. The Node build step is omitted: CI pins Node 26.4.0 for it, and the
// e2e job is skipped on the v2 branch by its own `if` condition.
const CHECKS = [
  { name: "install", cwd: ".", argv: ["bun", "install"] },
  { name: "typecheck", cwd: ".", argv: ["bun", "typecheck"] },
  { name: "test", cwd: ".", argv: ["bun", "turbo", "test", "--continue"], env: { GITHUB_ACTIONS: "false" } },
  { name: "client-check-generated", cwd: "packages/client", argv: ["bun", "run", "check:generated"] },
  { name: "www-check-generated", cwd: "packages/www", argv: ["bun", "run", "check:generated"] },
  { name: "cli-build", cwd: "packages/cli", argv: ["bun", "run", "script/build.ts", "--single", "--skip-install"] },
  { name: "cli-service-smoke", cwd: "packages/cli", argv: ["bun", "run", "script/service-smoke.ts"] },
]

const rev = async (ref: string) => (await $`git -C ${ROOT} rev-parse ${ref}`.quiet().nothrow()).stdout.toString().trim()
const mergeBase = async (a: string, b: string) =>
  (await $`git -C ${ROOT} merge-base ${a} ${b}`.quiet().nothrow()).stdout.toString().trim()

console.log("# refs")
for (const ref of ["HEAD", "origin/main", "upstream/dev", "upstream/v2"])
  console.log(`${ref.padEnd(14)} ${await rev(ref)}`)

console.log("\n# merge-bases")
console.log(`origin/main..upstream/v2   ${await mergeBase("origin/main", "upstream/v2")}`)
console.log(`upstream/dev..upstream/v2  ${await mergeBase("upstream/dev", "upstream/v2")}`)

console.log("\n# ancestry")
const ahead = (await $`git -C ${ROOT} rev-list --count upstream/v2..HEAD`.quiet().nothrow()).stdout.toString().trim()
const assertions = [
  {
    label: `HEAD contains pinned upstream/v2 ${PINNED_V2}`,
    ok: (await $`git -C ${ROOT} merge-base --is-ancestor ${PINNED_V2} HEAD`.quiet().nothrow()).exitCode === 0,
    required: true,
  },
  {
    label: "local upstream/v2 still points at the pinned SHA",
    ok: (await rev("upstream/v2")) === PINNED_V2,
    required: true,
  },
  // A slice branch legitimately carries its own commits, so this one only reports.
  { label: `HEAD carries ${ahead} commit(s) on top of upstream/v2`, ok: true, required: false },
]
for (const assertion of assertions) console.log(`${assertion.ok ? "ok  " : "FAIL"} ${assertion.label}`)

if (assertions.some((assertion) => assertion.required && !assertion.ok)) {
  console.log("\nbaseline ancestry broken; refusing to run checks")
  process.exit(1)
}

if (!Bun.argv.includes("--checks")) {
  console.log("\npass --checks to replay the upstream v2 CI commands")
  process.exit(0)
}

await mkdir(LOGS, { recursive: true })
console.log("\n# checks")
const results = []
for (const check of CHECKS) {
  const log = path.join(LOGS, `${check.name}.log`)
  const started = Bun.nanoseconds()
  const proc = Bun.spawn(check.argv, {
    cwd: path.join(ROOT, check.cwd),
    env: { ...process.env, ...check.env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  await Bun.write(log, `$ ${check.argv.join(" ")}\n(cwd ${check.cwd})\n\n${stdout}${stderr}`)
  const seconds = ((Bun.nanoseconds() - started) / 1e9).toFixed(1)
  results.push({ name: check.name, exitCode, seconds, log })
  console.log(`${exitCode === 0 ? "ok  " : "FAIL"} ${check.name.padEnd(22)} ${seconds}s  ${path.relative(ROOT, log)}`)
}

// Known-red checks are reported, never suppressed: see kilocode/baseline/pinned-v2-baseline.md
// for the failures that pristine upstream v2 already has at this SHA.
console.log(
  "\ncompare failures against kilocode/baseline/pinned-v2-baseline.md before attributing them to Kilo changes",
)
process.exit(results.some((result) => result.exitCode !== 0) ? 1 : 0)
