// kilocode_change - new file
//
// Custom test runner that executes each test file in its own isolated process.
// Prevents cross-contamination between test files by ensuring separate PIDs,
// temp directories, in-memory databases, and environment state.

import os from "os"
import path from "path"
import fs from "fs/promises"
import { TestProfile } from "./kilocode/test-profile"
import { TestShard } from "./kilocode/test-shard"
import { TestBatch } from "./kilocode/test-batch"
import batchAllowlist from "./kilocode/test-batch.json"
import { TestCli } from "./kilocode/test-cli"
import { remove } from "../test/kilocode/cleanup"

const root = path.resolve(import.meta.dir, "..")
const argv = process.argv.slice(2)

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    [
      "",
      "Usage: bun run script/test-runner.ts [options] [patterns...]",
      "",
      "Runs test files in isolated parallel processes to prevent cross-contamination.",
      "",
      "Options:",
      "  --ci                 Enable JUnit XML output to .artifacts/unit/junit.xml",
      "  --concurrency <N>    Max parallel processes (default: min(4, CPU count))",
      "  --timeout <ms>       Per-test timeout passed to bun test (default: 60000)",
      "  --file-timeout <ms>  Per-file process timeout (default: 300000)",
      "  --retries <N>        Extra attempts for failing files (default: 1)",
      "  --profile <name>     Run a curated test profile (env: KILO_TEST_PROFILE)",
      "  --shard <N/M>        Run one balanced file shard (env: KILO_TEST_SHARD)",
      "  --history <dir>      Load per-file durations from junit.xml under <dir> (env: KILO_TEST_HISTORY_DIR)",
      "  --bail               Stop on first failure",
      "  --dots               Show compact dot progress",
      "  --verbose            Show full output for every file",
      "  --no-batch           Disable batched groups; one process per file (env: KILO_TEST_NO_BATCH)", // kilocode_change
      "  -h, --help           Show this help",
      "",
      "Positional:",
      "  [patterns...]        Filter test files by substring match",
      "",
    ].join("\n"),
  )
  process.exit(0)
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function opt(name: string, fallback: number) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? Number(argv[i + 1]) || fallback : fallback
}

function text(name: string) {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return
  const value = argv[i + 1]
  if (value && !value.startsWith("-")) return value
  console.error(`Missing value for --${name}`)
  process.exit(2)
}

const ci = argv.includes("--ci")
const bail = argv.includes("--bail")
const verbose = argv.includes("--verbose")
const dots = !verbose && (ci || argv.includes("--dots"))
// Cap concurrency at 4 even on bigger runners: the bottleneck is shared
// resources (ports, global filesystem like ~/.local/share/kilo), not CPU.
// Eight parallel processes was triggering port/FS races, not going faster.
const concurrency = opt("concurrency", Math.min(4, os.cpus().length))
const timeout = opt("timeout", 60000)
const deadline = opt("file-timeout", 300000)
const retries = opt("retries", 1)
const flag = text("profile")
const env = process.env.KILO_TEST_PROFILE?.trim() || undefined
if (flag && env && flag !== env) {
  console.error(`Conflicting test profiles: --profile=${flag}, KILO_TEST_PROFILE=${env}`)
  process.exit(2)
}
const profile = flag ?? env
const shardFlag = text("shard")
const shardEnv = process.env.KILO_TEST_SHARD?.trim() || undefined
if (shardFlag && shardEnv && shardFlag !== shardEnv) {
  console.error(`Conflicting test shards: --shard=${shardFlag}, KILO_TEST_SHARD=${shardEnv}`)
  process.exit(2)
}
const parsed = TestShard.parse(shardFlag ?? shardEnv)
if (!parsed.ok) {
  console.error(parsed.error)
  process.exit(2)
}
const shard = parsed.value
const historyFlag = text("history")
const historyEnv = process.env.KILO_TEST_HISTORY_DIR?.trim() || undefined
if (historyFlag && historyEnv && historyFlag !== historyEnv) {
  console.error(`Conflicting test history dirs: --history=${historyFlag}, KILO_TEST_HISTORY_DIR=${historyEnv}`)
  process.exit(2)
}
const historyDir = historyFlag ?? historyEnv

const valued = new Set([
  "--concurrency",
  "--timeout",
  "--file-timeout",
  "--retries",
  "--profile",
  "--shard",
  "--history",
])
const patterns = argv.filter((arg, i) => {
  if (arg.startsWith("-")) return false
  if (i > 0 && valued.has(argv[i - 1])) return false
  return true
})

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const tty = !!process.stdout.isTTY
const green = (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s)
const red = (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s)
const yellow = (s: string) => (tty ? `\x1b[33m${s}\x1b[0m` : s)
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s)
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s)

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

const glob = new Bun.Glob("**/*.test.{ts,tsx}")
const all = (await Array.fromAsync(glob.scan({ cwd: path.join(root, "test") })))
  .map((file) => file.replaceAll("\\", "/"))
  .sort()

export const skipped = new Set([
  // Upstream browser OAuth integration tests bind the fixed callback port and
  // race with other parallel OAuth tests in CI.
  "mcp/oauth-browser.test.ts",
])

const selected = (() => {
  if (!profile) return all
  const result = TestProfile.resolve(profile, all)
  if (!result.ok) {
    console.error(result.error)
    process.exit(2)
  }
  const blocked = result.files.filter((file) => skipped.has(file))
  if (blocked.length > 0) {
    console.error(`Test profile "${profile}" contains skipped files:\n${blocked.map((file) => `- ${file}`).join("\n")}`)
    process.exit(2)
  }
  console.log(`Using test profile "${profile}": ${result.description} (${result.files.length} files)`)
  return result.files
})()
const matched =
  patterns.length > 0
    ? selected.filter((file) =>
        patterns.some((pattern) => file.includes(pattern) || path.join("test", file).includes(pattern)),
      )
    : selected
const candidates = patterns.length > 0 && !profile ? matched : matched.filter((file) => !skipped.has(file)) // kilocode_change
const weight = (file: string) => Bun.file(path.join(root, "test", file)).size
const durations = await loadHistory(historyDir)
const shardWeight = TestShard.weightFromDurations(durations, weight)
if (shard && shard.total > candidates.length) {
  console.error(`Test shard count ${shard.total} exceeds selected file count ${candidates.length}`)
  process.exit(2)
}
const files = shard ? TestShard.split(candidates, shardWeight, shard.total)[shard.index - 1] : candidates
if (Object.keys(durations).length > 0) {
  console.log(`Loaded ${Object.keys(durations).length} file durations from ${historyDir ?? "history"}`)
}

if (files.length === 0) {
  console.log("No test files found")
  process.exit(0)
}

// kilocode_change start - group isolation-safe files so they share a process.
// `--no-batch` restores strict process-per-file, which is the way to check
// whether a suspected contamination is caused by batching.
const batching = !argv.includes("--no-batch") && !process.env.KILO_TEST_NO_BATCH
const allow = TestBatch.allowlist(batchAllowlist)
// One group per lane: fewer would idle workers, more would add back spawns.
const plan = batching
  ? TestBatch.plan(files, allow, concurrency, shardWeight)
  : { groups: [], isolated: files.slice(), stale: [] }
if (plan.stale.length > 0) {
  console.log(
    `warn: ${plan.stale.length} test batch allowlist entr${plan.stale.length === 1 ? "y is" : "ies are"} not in this run`,
  )
}
const units: Unit[] = [
  ...plan.groups.map((group, index) => ({
    kind: "batch" as const,
    label: `batch ${index + 1}/${plan.groups.length} (${group.length} files)`,
    xml: `batch_${index + 1}`,
    files: group,
  })),
  ...plan.isolated.map((file) => ({
    kind: "file" as const,
    label: file,
    xml: file.replace(/[/\\]/g, "_"),
    files: [file],
  })),
]
// kilocode_change end

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// kilocode_change start - a work unit is one process: either a single file or a batched group
type Unit = {
  kind: "file" | "batch"
  /** How the unit is named in progress lines and failure output. */
  label: string
  /** Filesystem-safe stem for this unit's JUnit XML file. */
  xml: string
  files: string[]
}
// kilocode_change end

type Result = {
  file: string
  passed: boolean
  code: number
  stdout: string
  stderr: string
  duration: number
  timedout: boolean
  attempts: number
  limit: number // kilocode_change - the deadline this unit actually ran under
}

type Proc = ReturnType<typeof Bun.spawn>

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const xmldir = ci ? path.join(os.tmpdir(), `opencode-junit-${process.pid}`) : ""
if (ci) await fs.mkdir(xmldir, { recursive: true })
// kilocode_change start
const supplied = process.env[TestCli.ENV]
const built = supplied ? { binary: supplied, dir: undefined } : { binary: await TestCli.build(root), dir: undefined }

async function cleanBinary() {
  if (!built.dir) return
  await fs.rm(built.dir, { recursive: true, force: true })
}
// kilocode_change end

const counter = { done: 0 }
// kilocode_change - units, not files: a batch is one line, and the isolate-on-failure
// fallback adds units mid-run, so the denominator has to be mutable.
const total = { value: units.length }
const pad = String(units.length).length
const progress = { width: 80 }
const active = new Map<number, ReturnType<typeof Bun.spawn>>()
const pending = new Map<number, Promise<void>>()
const stopping = { promise: undefined as Promise<void> | undefined }
const stopped = { value: false }
const marks = {
  pass: ".",
  retry: "R",
  fail: "F",
  timeout: "T",
} as const
const legend = `Legend: ${marks.pass}=pass ${marks.retry}=pass-after-retry ${marks.fail}=fail ${marks.timeout}=timeout`

function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const promise = (async () => {
    let text = ""
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return text + decoder.decode()
      text += decoder.decode(chunk.value, { stream: true })
    }
  })()
  return {
    promise,
    close: () => reader.cancel().catch(() => undefined),
  }
}

async function signal(proc: Proc, sig: "SIGTERM" | "SIGKILL") {
  if (process.platform === "win32") {
    const args = ["/pid", String(proc.pid), "/T"]
    if (sig === "SIGKILL") args.push("/F")
    const kill = Bun.spawn(["taskkill", ...args], {
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    })
    await kill.exited
    return
  }

  const tree = Bun.spawn(["ps", "-axo", "pid=,ppid="], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const [code, text] = await Promise.all([tree.exited, new Response(tree.stdout).text()])
  const rows = code === 0 ? text.trim().split("\n") : []
  const children = new Map<number, number[]>()
  for (const row of rows) {
    const [pid, parent] = row.trim().split(/\s+/).map(Number)
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parent)) continue
    const list = children.get(parent) ?? []
    list.push(pid)
    children.set(parent, list)
  }
  const collect = (pid: number): number[] => (children.get(pid) ?? []).flatMap((child) => [...collect(child), child])
  for (const pid of [...collect(proc.pid), proc.pid]) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, sig)
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") continue
        // A kill failure (e.g. EPERM in a sandboxed runner) must not take down the whole run.
        console.error(`warn: failed to signal ${target} with ${sig}:`, error)
      }
    }
  }
}

async function terminate(proc: Proc) {
  if (proc.exitCode !== null) return
  await signal(proc, "SIGTERM")
  const exited = Symbol("exited")
  const result = await Promise.race([proc.exited.then(() => exited), Bun.sleep(2_000)])
  if (result === exited) return
  await signal(proc, "SIGKILL")
  await Promise.race([proc.exited, Bun.sleep(2_000)])
}

// ---------------------------------------------------------------------------
// Run a single test file
// ---------------------------------------------------------------------------

async function run(unit: Unit): Promise<Result> {
  // kilocode_change start - one process may now cover several files
  const cmd = ["bun", "test", ...unit.files.map((file) => path.join("test", file)), "--timeout", String(timeout)]
  // A group runs its files serially in one process, so its legitimate runtime
  // scales with file count. Three per-file deadlines is generous for that and
  // still catches a genuine hang; when it trips, the fallback re-runs each file
  // under the real per-file deadline anyway.
  const limit = unit.kind === "batch" ? deadline * 3 : deadline

  if (ci) {
    cmd.push("--reporter=junit", `--reporter-outfile=${path.join(xmldir, unit.xml + ".xml")}`)
  }
  // kilocode_change end

  const start = performance.now()
  const killed = { value: false }

  const proc = Bun.spawn(cmd, {
    cwd: root,
    env: { ...process.env, [TestCli.ENV]: built.binary },
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    detached: process.platform !== "win32",
  })
  active.set(proc.pid, proc)

  const stdout = drain(proc.stdout)
  const stderr = drain(proc.stderr)
  const code = await Promise.race([
    proc.exited.then((value) => ({ timedout: false, value })),
    Bun.sleep(limit).then(() => ({ timedout: true, value: -1 })), // kilocode_change - per-unit budget
  ]).then(async (result) => {
    if (result.timedout) {
      killed.value = true
      await terminate(proc)
    }
    await finish(proc)
    return result.timedout ? (proc.exitCode ?? result.value) : result.value
  })
  const output = await Promise.race([
    Promise.all([stdout.promise, stderr.promise]).then((value) => ({ closed: true, value })),
    Bun.sleep(2_000).then(() => ({ closed: false, value: ["", ""] as [string, string] })),
  ]).then(async (result) => {
    if (result.closed) return result.value
    await signal(proc, "SIGKILL")
    await Promise.all([stdout.close(), stderr.close()])
    return Promise.all([stdout.promise, stderr.promise])
  })

  return {
    file: unit.label, // kilocode_change - the unit's name, which for a lone file is the file
    passed: code === 0,
    code,
    stdout: output[0],
    stderr: output[1],
    duration: performance.now() - start,
    timedout: killed.value,
    attempts: 1,
    limit, // kilocode_change
  }
}

function finish(proc: ReturnType<typeof Bun.spawn>) {
  const found = pending.get(proc.pid)
  if (found) return found

  const promise = (async () => {
    await Promise.race([proc.exited, Bun.sleep(2_000)])
    await cleanup(proc.pid)
  })().finally(() => {
    active.delete(proc.pid)
    pending.delete(proc.pid)
  })
  pending.set(proc.pid, promise)
  return promise
}

function shutdown(code: number) {
  if (stopping.promise) return stopping.promise
  stopping.promise = (async () => {
    stopped.value = true
    const children = [...active.values()]
    await Promise.all(children.map(terminate))
    await Promise.all(children.map(finish))
    await cleanBinary()
    process.exit(code)
  })()
  return stopping.promise
}

process.once("SIGINT", () => void shutdown(130))
process.once("SIGTERM", () => void shutdown(143))

// ---------------------------------------------------------------------------
// Report a single result
// ---------------------------------------------------------------------------

function mark(result: Result) {
  if (result.timedout) return marks.timeout
  if (!result.passed) return marks.fail
  if (result.attempts > 1) return marks.retry
  return marks.pass
}

function report(result: Result) {
  counter.done++
  if (dots) {
    process.stdout.write(mark(result))
    if (counter.done % progress.width === 0) process.stdout.write("\n")
    return
  }

  const idx = String(counter.done).padStart(pad)
  const secs = (result.duration / 1000).toFixed(1)
  const tries = result.attempts > 1 ? dim(` [attempt ${result.attempts}/${retries + 1}]`) : ""

  if (result.timedout) {
    console.log(
      `[${idx}/${total.value}] ${red("TIME")} ${result.file} ${dim(`(${secs}s - exceeded ${result.limit / 1000}s)`)}${tries}`,
    )
    return
  }

  if (!result.passed) {
    console.log(`[${idx}/${total.value}] ${red("FAIL")} ${result.file} ${dim(`(${secs}s)`)}${tries}`)
    if (verbose && result.stderr.trim()) console.log(result.stderr)
    if (verbose && result.stdout.trim()) console.log(result.stdout)
    return
  }

  if (result.attempts > 1) {
    console.log(`[${idx}/${total.value}] ${yellow("FLAKY")} ${result.file} ${dim(`(${secs}s)`)}${tries}`)
    if (verbose && result.stdout.trim()) console.log(dim(result.stdout))
    return
  }

  console.log(`[${idx}/${total.value}] ${green("PASS")} ${result.file} ${dim(`(${secs}s)`)}`)
  if (verbose && result.stdout.trim()) console.log(dim(result.stdout))
}

// ---------------------------------------------------------------------------
// Parallel execution
// ---------------------------------------------------------------------------

console.log(`\nRunning ${bold(String(files.length))} test files with concurrency ${bold(String(concurrency))}`)
if (shard) console.log(`Using balanced test shard ${shard.index}/${shard.total}`)
// kilocode_change start
if (plan.groups.length > 0) {
  const batched = plan.groups.reduce((sum, group) => sum + group.length, 0)
  console.log(
    `Batching ${batched} isolation-safe files into ${plan.groups.length} processes; ${plan.isolated.length} stay isolated`,
  )
} else if (batching) {
  console.log("No batchable files in this run; every file gets its own process")
}
// kilocode_change end
if (dots) console.log(dim(legend))
console.log()

const start = performance.now()
const results: Result[] = []
// kilocode_change - heaviest unit first, a batch weighted by the sum of its contents.
// Sorted here rather than via TestShard.order because that helper is string-keyed.
const unitWeight = (unit: Unit) => unit.files.reduce((sum, file) => sum + shardWeight(file), 0)
const queue = units.slice().sort((a, b) => unitWeight(b) - unitWeight(a) || a.label.localeCompare(b.label))

const workers = Array.from({ length: Math.min(concurrency, units.length) }, async () => {
  while (queue.length > 0 && !stopped.value) {
    const unit = queue.shift()!
    let result = await run(unit)

    // kilocode_change start - a failed batch proves nothing about any single
    // file in it, so re-run its files in isolation and report those instead.
    // Batching can then only ever cost time, never change a verdict.
    if (!result.passed && unit.kind === "batch" && !stopped.value) {
      console.log(`${yellow("BATCH")} ${unit.label} failed; re-running its ${unit.files.length} files in isolation`)
      total.value += unit.files.length - 1
      queue.unshift(
        ...unit.files.map((file) => ({
          kind: "file" as const,
          label: file,
          xml: file.replace(/[/\\]/g, "_"),
          files: [file],
        })),
      )
      continue
    }
    // kilocode_change end

    // Retry failing files up to `retries` extra times. Bugs still fail on every
    // attempt; contention-based flakes (port races, slow FS, slow spawn) recover.
    // Preserve the last attempt's stdout/stderr/duration so a truly broken file
    // still shows a useful diagnostic.
    while (!result.passed && result.attempts <= retries && !stopped.value) {
      const retry = await run(unit)
      retry.attempts = result.attempts + 1
      result = retry
    }
    results.push(result)
    report(result)
    if (bail && !result.passed) stopped.value = true
  }
})

await Promise.all(workers)

if (dots && counter.done % progress.width !== 0) console.log()

const elapsed = (performance.now() - start) / 1000

// ---------------------------------------------------------------------------
// Failure details
// ---------------------------------------------------------------------------

const failures = results.filter((r) => !r.passed).sort((a, b) => a.file.localeCompare(b.file))

if (failures.length > 0 && !verbose) {
  console.log(`\n${bold(red("--- FAILURES ---"))}\n`)
  for (const f of failures) {
    const tag = f.timedout ? " (TIMED OUT)" : ""
    console.log(`${bold(red(f.file))}${tag}:`)
    const output = (f.stderr || f.stdout).trim()
    if (output)
      console.log(
        output
          .split("\n")
          .map((l) => "  " + l)
          .join("\n"),
      )
    console.log()
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.passed).length
const flaky = results.filter((r) => r.passed && r.attempts > 1)

console.log(
  `\n${bold(String(results.length))} files | ` +
    `${green(passed + " passed")} | ` +
    `${failures.length > 0 ? red(failures.length + " failed") : failures.length + " failed"} | ` +
    `${flaky.length > 0 ? yellow(flaky.length + " flaky") : flaky.length + " flaky"} | ` +
    `${elapsed.toFixed(1)}s\n`,
)

if (flaky.length > 0) {
  const sorted = flaky.slice().sort((a, b) => a.file.localeCompare(b.file))

  console.log(`${bold(yellow("--- FLAKY (passed on retry) ---"))}\n`)
  for (const r of sorted) {
    console.log(`  ${yellow(r.file)} ${dim(`(passed on attempt ${r.attempts}/${retries + 1})`)}`)
  }
  console.log()

  // Surface flakies to the GitHub Actions UI so reviewers don't have to scan
  // the raw log. Annotations show up on the PR; the step summary is visible at
  // the bottom of the job page and in the workflow summary email.
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const r of sorted) {
      const repo = `packages/opencode/test/${r.file}`
      console.log(`::warning file=${repo},title=Flaky test file::passed on attempt ${r.attempts} of ${retries + 1}`)
    }

    const summary = process.env.GITHUB_STEP_SUMMARY
    if (summary) {
      const md = [
        "### ⚠️ Flaky test files (passed on retry)",
        "",
        `${sorted.length} file${sorted.length === 1 ? "" : "s"} needed more than one attempt to pass.`,
        "",
        "| File | Attempts |",
        "|---|---|",
        ...sorted.map((r) => `| \`${r.file}\` | ${r.attempts}/${retries + 1} |`),
        "",
      ].join("\n")
      await fs.appendFile(summary, md + "\n")
    }
  }
}

// ---------------------------------------------------------------------------
// JUnit XML merge (CI mode)
// ---------------------------------------------------------------------------

if (ci) {
  await merge()
  await fs.rm(xmldir, { recursive: true, force: true }).catch((err) => {
    console.error("cleanup failed:", err)
  })
}

await cleanBinary()

process.exit(failures.length > 0 ? 1 : 0)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function merge() {
  const dir = path.join(root, ".artifacts", "unit")
  await fs.mkdir(dir, { recursive: true })

  const suites: string[] = []
  const counts = { tests: 0, failures: 0, errors: 0 }

  for (const file of files) {
    const name = file.replace(/[/\\]/g, "_") + ".xml"
    const fpath = path.join(xmldir, name)
    const found = await Bun.file(fpath).exists()

    if (found) {
      const content = await Bun.file(fpath).text()
      const extracted = extract(content)
      if (extracted) {
        suites.push(extracted)
        // Counts come from the outer <testsuites ...> root attributes, not from
        // regex-scanning the inner content, so nested <testsuite> blocks (bun
        // emits one per `describe`) don't get double-counted.
        const root = content.match(/<testsuites\b([^>]*)>/)
        if (root) {
          counts.tests += attr(root[1], "tests")
          counts.failures += attr(root[1], "failures")
          counts.errors += attr(root[1], "errors")
        }
        continue
      }
    }

    // No valid XML produced - generate synthetic entry for failed files
    const result = results.find((r) => r.file === file)
    if (!result || result.passed) continue

    const secs = (result.duration / 1000).toFixed(3)
    const msg = result.timedout
      ? `Test file timed out after ${deadline / 1000}s`
      : `Test process exited with code ${result.code}`
    const detail = esc((result.stderr || result.stdout || msg).slice(0, 10000))

    suites.push(
      `  <testsuite name="${esc(file)}" tests="1" failures="1" errors="0" time="${secs}">\n` +
        `    <testcase name="${esc(file)}" classname="${esc(file)}" time="${secs}">\n` +
        `      <failure message="${esc(msg)}">${detail}</failure>\n` +
        `    </testcase>\n` +
        `  </testsuite>`,
    )
    counts.tests++
    counts.failures++
  }

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${counts.tests}" failures="${counts.failures}" errors="${counts.errors}" time="${elapsed.toFixed(3)}">`,
    ...suites,
    "</testsuites>",
    "",
  ].join("\n")

  await Bun.write(path.join(dir, "junit.xml"), body)
}

async function cleanup(pid: number) {
  const dir = path.join(os.tmpdir(), `opencode-test-data-${pid}`)
  await remove(dir).catch((err) => {
    console.error(`cleanup failed for ${dir}:`, err)
  })
}

// Read every *.xml file under `dir` and merge per-file durations. The CI
// workflow restores the previous merged junit.xml into this directory via
// actions/cache; in practice it's a single file but scanning is cheap and
// tolerates future cross-shard aggregation layouts.
async function loadHistory(dir: string | undefined): Promise<TestShard.Durations> {
  if (!dir) return {}
  let entries: string[]
  try {
    const glob = new Bun.Glob("**/*.xml")
    entries = await Array.fromAsync(glob.scan({ cwd: dir }))
  } catch (err) {
    console.error(`history dir ${dir} is unreadable:`, err)
    return {}
  }
  const maps: TestShard.Durations[] = []
  for (const file of entries) {
    const content = await Bun.file(path.join(dir, file)).text()
    maps.push(TestShard.durationsFromJUnit(content))
  }
  return TestShard.combineDurations(...maps)
}

// Grab everything between the outer <testsuites ...> and </testsuites> of a
// per-file JUnit XML. Preserves nested <testsuite> blocks verbatim — the
// previous hand-rolled walker matched the first </testsuite> it found, which
// closed an inner suite and left the outer one dangling in the merged output.
function extract(content: string): string {
  const open = content.match(/<testsuites\b[^>]*>/)
  if (!open) return ""
  const start = open.index! + open[0].length
  const end = content.lastIndexOf("</testsuites>")
  if (end === -1 || end <= start) return ""
  return content.slice(start, end).trim()
}

function attr(attrs: string, name: string): number {
  const m = attrs.match(new RegExp(`\\b${name}="(\\d+)"`))
  return m ? Number(m[1]) : 0
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
