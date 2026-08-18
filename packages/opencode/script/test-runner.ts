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
      "  --concurrency <N>    Max parallel processes (default: min(4, CPU count), env: KILO_TEST_CONCURRENCY)",
      "  --timeout <ms>       Per-test timeout passed to bun test (default: 60000)",
      "  --file-timeout <ms>  Per-file process timeout (default: 300000, env: KILO_TEST_FILE_TIMEOUT)",
      "  --retries <N>        Extra attempts for failing files (default: 1)",
      "  --profile <name>     Run a curated test profile (env: KILO_TEST_PROFILE)",
      "  --shard <N/M>        Run one balanced file shard (env: KILO_TEST_SHARD)",
      "  --update-durations   After a full run, refresh script/kilocode/test-durations.json",
      "  --bail               Stop on first failure",
      "  --dots               Show compact dot progress",
      "  --verbose            Show full output for every file",
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
const updateDurations = argv.includes("--update-durations") // kilocode_change
const verbose = argv.includes("--verbose")
const dots = !verbose && (ci || argv.includes("--dots"))
// Cap concurrency at 4 even on bigger runners: the bottleneck is shared
// resources (ports, global filesystem like ~/.local/share/kilo), not CPU.
// Eight parallel processes was triggering port/FS races, not going faster.
// kilocode_change start - allow CI to lower concurrency via env. On the 4-vCPU
// Windows runner, the default (min(4, cpus)=4) oversubscribes: 4 heavy real-server
// test files share 4 vCPUs (~1 each) and blow their per-test timeouts.
// `KILO_TEST_CONCURRENCY` lets the workflow throttle Windows without affecting the
// local default. An explicit `--concurrency` flag wins.
const concurrencyEnv = (() => {
  const raw = process.env.KILO_TEST_CONCURRENCY?.trim()
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    console.error(`Invalid KILO_TEST_CONCURRENCY "${raw}"; expected a positive integer`)
    process.exit(2)
  }
  return value
})()
const concurrency = opt("concurrency", concurrencyEnv ?? Math.min(4, os.cpus().length))
// kilocode_change end
const timeout = opt("timeout", 60000)
// kilocode_change start - allow CI to raise the per-file kill deadline via env. On Windows,
// heavy real-server files (e.g. config-overlay) legitimately run ~270s serially, only ~30s
// under the 300s default; raising it there prevents a slow-but-healthy run from being killed.
const fileTimeoutEnv = (() => {
  const raw = process.env.KILO_TEST_FILE_TIMEOUT?.trim()
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    console.error(`Invalid KILO_TEST_FILE_TIMEOUT "${raw}"; expected a positive integer (ms)`)
    process.exit(2)
  }
  return value
})()
const deadline = opt("file-timeout", fileTimeoutEnv ?? 300000)
// kilocode_change end
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

const valued = new Set(["--concurrency", "--timeout", "--file-timeout", "--retries", "--profile", "--shard"])
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
if (shard && shard.total > candidates.length) {
  console.error(`Test shard count ${shard.total} exceeds selected file count ${candidates.length}`)
  process.exit(2)
}
// kilocode_change start - shard by estimated DURATION, not file size. File size is a poor
// proxy: run-process.test.ts is ~7 KB but ~230s, while config-overlay is the single slowest
// file — under size-weighting both landed in the same shard, stacking the two heaviest files.
// DURATION_HINTS are max observed per-file durations (ms) from real Windows CI runs; the LPT
// splitter places the highest-weight files first, so hinted heavy files get spread across
// distinct shards. Unhinted files fall back to size (a fine proxy among the fast majority);
// hint values (tens of thousands of ms) dominate byte sizes, so heavy files always sort first.
// Refresh these from observed CI durations when the suite changes materially.
const DURATION_HINTS: Record<string, number> = {
  "kilocode/server/config-overlay.test.ts": 270_000,
  "cli/run/run-process.test.ts": 233_000,
  "snapshot/snapshot.test.ts": 165_000,
  "session/prompt.test.ts": 128_000,
  "tool/shell.test.ts": 95_000,
  "kilocode/background-process.test.ts": 94_000,
  "provider/provider.test.ts": 90_000,
  "kilocode/indexing-startup.test.ts": 88_000,
  "kilocode/daemon.test.ts": 65_000,
  "tool/task.test.ts": 64_000,
}
// Measured per-file durations (ms) from a full local run; refresh with
// `bun run script/test-runner.ts --update-durations`. Relative order is what LPT needs,
// so a macOS measurement balances Windows shards fine. Hints above still win: they are
// Windows-observed maxima.
const measuredDurations: Record<string, number> = await Bun.file(
  path.join(root, "script", "kilocode", "test-durations.json"),
)
  .json()
  .catch(() => ({}))
// Memoized: weight() runs inside sort comparators (TestShard.order/split), and the
// byte-size fallback is a blocking stat syscall — thousands of repeats without a cache.
const weightCache = new Map<string, number>()
const weight = (file: string) => {
  const cached = weightCache.get(file)
  if (cached !== undefined) return cached
  const value = DURATION_HINTS[file] ?? measuredDurations[file] ?? Bun.file(path.join(root, "test", file)).size
  weightCache.set(file, value)
  return value
}
// kilocode_change end

// kilocode_change start - fast tier: run isolation-safe test files in ONE shared `bun test`
// process instead of one process each. Per-file processes exist to contain cross-test state
// (disk DBs, singletons, native handles); the directories below are verified to run together
// cleanly in a single pass (empirically: all pass in one process). This trades ~1s of process
// boot + TS compile per file for a single boot, the dominant cost for these small fast files.
// The batch enters shard splitting as one pseudo-file with a duration-scale weight, so LPT
// places it like any other heavy file and exactly one shard executes it. Directories are
// batched by default; files that cannot share a process are excluded by BATCH_EXCLUDES or
// demoted automatically by the unsafe-marker scan below.
// Deliberately excludes directories whose runtime is real I/O work (git/, server/, session/,
// project/, provider/, ...): those parallelize well across the per-file worker pool, while a
// batch runs its members sequentially. The tier is for files where boot cost dominates.
// Several independent batches (instead of one) keep each batch short enough to schedule
// like a normal heavy file, and let LPT spread them across shards and worker slots.
// Batch weights are computed from member durations, never hand-maintained.
const FAST_TIERS: Record<string, string[]> = {
  "fast-tier-core": [
    "account/",
    "config/",
    "effect/",
    "event-manifest.test.ts",
    "format/",
    "image/",
    "installation/",
    "patch/",
    "provider/model-status.test.ts",
    "provider/transform.test.ts",
    "question/",
    "share/",
    "suggestion/",
    "util/",
  ],
  "fast-tier-kilocode": [
    "kilocode/config/",
    "kilocode/memory/",
    // kilocode/permission/ stays per-file: permission-origins asserts the merged config has
    // no global-scope keys, so it cannot share an XDG root with tests that write global config.
    "kilocode/presence/",
    "kilocode/project/",
    "kilocode/provider/",
    "kilocode/skills/",
    "kilocode/storage/",
    "kilocode/suggestion/",
    "kilocode/tui/",
    "kilocode/util/",
  ],
  "fast-tier-kilocode-sessions": ["kilocode/session-export/", "kilocode/session/", "kilocode/sessions/"],
  "fast-tier-kilocode-tools": ["kilocode/anaconda-desktop/", "kilocode/cloud/", "kilocode/tool/"],
  "fast-tier-cli": ["cli/"],
  "fast-tier-misc": ["acp/", "auth/", "bun/", "filesystem/", "ide/", "lsp/", "mcp/", "plugin/", "storage/", "v2/"],
  "fast-tier-tool": ["tool/"],
}
// Files that must run alone, never in a shared batch, for reasons a source scan cannot
// detect: real subprocesses, fs watchers, and wall-clock stall simulations are all
// timing-sensitive under batch CPU contention. Same entry semantics as FAST_TIERS
// (".ts" = exact file, otherwise directory prefix). Files with *detectable* process-wide
// markers (mock.module, AppRuntime.dispose, global fetch spies) do not need listing here:
// the batch builder scans member sources and demotes them to per-file automatically.
const BATCH_EXCLUDES = [
  "cli/run/", // spawns real non-interactive runs (SIGINT/daemon timing)
  "kilocode/background-process.test.ts",
  "kilocode/daemon.test.ts", // spawns real daemon subprocesses, races wall-clock deadlines
  "kilocode/instance-vcs-watcher.test.ts",
  "kilocode/issue-8656-stall.test.ts",
  // Heavy real-work files: a batch runs members sequentially, so files whose runtime is
  // dominated by real execution (not process boot) parallelize better in their own process.
  "tool/shell.test.ts",
  "tool/task.test.ts",
]
// Entry semantics shared by FAST_TIERS and BATCH_EXCLUDES: ".ts" = exact file, else prefix.
const matchesEntry = (file: string, entry: string) => (entry.endsWith(".ts") ? file === entry : file.startsWith(entry))
const isBatchExcluded = (file: string) => BATCH_EXCLUDES.some((entry) => matchesEntry(file, entry))
// 8 batches (~24 files each) keep the heaviest single work item small enough for
// LPT to pack shards evenly; fewer, bigger batches set a floor under the slowest shard.
const KILOCODE_ROOT_TIERS = 8
const kilocodeRootTier = (file: string) => {
  if (!file.startsWith("kilocode/")) return undefined
  if (file.slice("kilocode/".length).includes("/")) return undefined
  let hash = 0
  for (let i = 0; i < file.length; i++) hash = (hash * 31 + file.charCodeAt(i)) | 0
  return `fast-tier-kilocode-root-${Math.abs(hash) % KILOCODE_ROOT_TIERS}`
}
const tierOf = (file: string) => {
  if (isBatchExcluded(file)) return undefined
  for (const [name, entries] of Object.entries(FAST_TIERS)) {
    if (entries.some((entry) => matchesEntry(file, entry))) return name
  }
  return kilocodeRootTier(file)
}
const batches = new Map<string, string[]>()
// --update-durations disables batching so every file runs (and is measured) individually;
// batched members otherwise never appear in results and their entries would rot.
if (patterns.length === 0 && !profile && !updateDurations) {
  for (const file of candidates) {
    const tier = tierOf(file)
    if (!tier) continue
    const members = batches.get(tier) ?? []
    members.push(file)
    batches.set(tier, members)
  }

  // A batch shares one process, so process-wide mutations poison every later file in it.
  // Scan member sources for the known-unsafe markers and demote matches to per-file runs:
  // bun's mock.module is process-wide and permanent, AppRuntime.dispose() kills the shared
  // runtime, and global-fetch spies observe batch-mates' traffic. A developer adding such
  // a test anywhere keeps a green suite; the file just does not share a process.
  // Limitation: only the test file's own source is scanned — a marker hidden in an
  // imported helper is invisible; batch-only failures that vanish per-file point there.
  // Markers: bun module mocks, disposal of the shared app runtime, spies on true globals,
  // and module-scope env writes (column 0 — env set inside a test body is indented and
  // typically restored; a load-time write leaks into every batch-mate's import snapshot).
  const unsafe = [
    /\bmock\.module\s*\(/,
    /\bAppRuntime\.dispose\s*\(/,
    /\bspyOn\s*\(\s*globalThis\b/,
    /^process\.env[.[]/m,
  ]
  const demoted = new Set<string>()
  const members = [...batches.values()].flat()
  // Bounded chunks: an unbounded Promise.all over ~440 files can exhaust low soft
  // fd limits (macOS shells commonly default to 256) before a single test runs.
  for (let i = 0; i < members.length; i += 64) {
    await Promise.all(
      members.slice(i, i + 64).map(async (member) => {
        const source = await Bun.file(path.join(root, "test", member)).text()
        if (unsafe.some((pattern) => pattern.test(source))) demoted.add(member)
      }),
    )
  }
  if (demoted.size > 0) {
    console.log(
      `Fast tier: ${demoted.size} file(s) use process-wide mocks/disposal/spies and run per-file instead:\n` +
        [...demoted].map((file) => `- ${file}`).join("\n"),
    )
    for (const [name, members] of batches)
      batches.set(
        name,
        members.filter((member) => !demoted.has(member)),
      )
  }
  for (const [name, members] of batches) if (members.length < 2) batches.delete(name)
}
const batched = new Set([...batches.values()].flat())
const shardInput = [...batches.keys(), ...candidates.filter((file) => !batched.has(file))]
// A batch runs its members sequentially, so its weight is the sum of member durations
// (hint > measured > a typical boot-dominated file) plus one process boot. Computed, not
// hand-maintained: stale per-tier constants systematically under-weighted heavy batches.
const TYPICAL_BATCHED_FILE_MS = 1_500
const BATCH_BOOT_MS = 3_000
const batchWeights = new Map(
  [...batches.entries()].map(([name, members]) => [
    name,
    members.reduce(
      (total, member) => total + (DURATION_HINTS[member] ?? measuredDurations[member] ?? TYPICAL_BATCHED_FILE_MS),
      BATCH_BOOT_MS,
    ),
  ]),
)
const shardWeight = (file: string) => batchWeights.get(file) ?? weight(file)
const files = shard ? TestShard.split(shardInput, shardWeight, shard.total)[shard.index - 1] : shardInput
// kilocode_change end

if (files.length === 0) {
  console.log("No test files found")
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Result = {
  file: string
  passed: boolean
  code: number
  stdout: string
  stderr: string
  duration: number
  timedout: boolean
  deadline: number // kilocode_change - the kill deadline actually applied (batches get a roomier one)
  attempts: number
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
const pad = String(files.length).length
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

async function run(file: string): Promise<Result> {
  // kilocode_change start - a fast-tier pseudo-file expands to all of its batch members in
  // one process; a shared pass compiles once, so it gets a roomier process deadline than a
  // single file even though each member is individually fast.
  const members = batches.get(file)
  const targets = members ? members.map((member) => path.join("test", member)) : [path.join("test", file)]
  const cmd = ["bun", "test", ...targets, "--timeout", String(timeout)]
  // kilocode_change end

  if (ci) {
    const name = file.replace(/[/\\]/g, "_") + ".xml"
    cmd.push("--reporter=junit", `--reporter-outfile=${path.join(xmldir, name)}`)
  }

  const start = performance.now()
  const killed = { value: false }
  const fileDeadline = members ? Math.max(deadline, 600_000) : deadline // kilocode_change

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
    Bun.sleep(fileDeadline).then(() => ({ timedout: true, value: -1 })), // kilocode_change
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
    file,
    passed: code === 0,
    code,
    stdout: output[0],
    stderr: output[1],
    duration: performance.now() - start,
    timedout: killed.value,
    deadline: fileDeadline, // kilocode_change
    attempts: 1,
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
      `[${idx}/${files.length}] ${red("TIME")} ${result.file} ${dim(`(${secs}s - exceeded ${result.deadline / 1000}s)`)}${tries}`,
    )
    return
  }

  if (!result.passed) {
    console.log(`[${idx}/${files.length}] ${red("FAIL")} ${result.file} ${dim(`(${secs}s)`)}${tries}`)
    if (verbose && result.stderr.trim()) console.log(result.stderr)
    if (verbose && result.stdout.trim()) console.log(result.stdout)
    return
  }

  if (result.attempts > 1) {
    console.log(`[${idx}/${files.length}] ${yellow("FLAKY")} ${result.file} ${dim(`(${secs}s)`)}${tries}`)
    if (verbose && result.stdout.trim()) console.log(dim(result.stdout))
    return
  }

  console.log(`[${idx}/${files.length}] ${green("PASS")} ${result.file} ${dim(`(${secs}s)`)}`)
  if (verbose && result.stdout.trim()) console.log(dim(result.stdout))
}

// ---------------------------------------------------------------------------
// Parallel execution
// ---------------------------------------------------------------------------

// kilocode_change start - report the batches so shard logs stay interpretable
for (const [name, members] of batches) {
  if (!files.includes(name)) continue
  console.log(`\nFast tier ${bold(name)}: ${bold(String(members.length))} isolation-safe files in one shared process`)
}
// kilocode_change end
console.log(`\nRunning ${bold(String(files.length))} test files with concurrency ${bold(String(concurrency))}`)
if (shard) console.log(`Using balanced test shard ${shard.index}/${shard.total}`)
if (dots) console.log(dim(legend))
console.log()

const start = performance.now()
const results: Result[] = []
// Order by shardWeight, not weight: batch pseudo-files are not real paths, so weight()
// gives them 0 and they would start LAST — leaving one worker running a whole batch
// after everything else finished. Heaviest-first keeps the tail short. kilocode_change
const queue = TestShard.order(files, shardWeight)

// kilocode_change start - a flaky batch names only its pseudo-file; pull the members that
// failed on the earlier attempt out of that attempt's output so annotations can attribute
// the flake to real files. bun prints a "test/<file>:" heading before each file's tests.
const flakyMembers = new Map<string, string[]>()
const failedMembersOf = (stdout: string, members: string[]) => {
  const failed = new Set<string>()
  let current: string | undefined
  for (const line of stdout.split("\n")) {
    const heading = line.match(/^(?:.*[\\/])?test[\\/](.+\.test\.tsx?):\s*$/)
    if (heading) {
      const name = heading[1].replaceAll("\\", "/")
      current = members.includes(name) ? name : undefined
      continue
    }
    if (current && /^\(fail\)/.test(line.trim())) failed.add(current)
  }
  return [...failed]
}
// kilocode_change end

const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
  while (queue.length > 0 && !stopped.value) {
    const file = queue.shift()!
    let result = await run(file)
    // Retry failing files up to `retries` extra times. Bugs still fail on every
    // attempt; contention-based flakes (port races, slow FS, slow spawn) recover.
    // Preserve the last attempt's stdout/stderr/duration so a truly broken file
    // still shows a useful diagnostic.
    // A timed-out item already burned the full kill deadline; retrying doubles a
    // pathological hang (2x600s) and can push a shard past the 45-minute job budget.
    // Contention flakes fail fast and still get their retry.
    while (!result.passed && !result.timedout && result.attempts <= retries && !stopped.value) {
      const members = batches.get(file) // kilocode_change
      if (members) flakyMembers.set(file, failedMembersOf(result.stdout, members)) // kilocode_change
      const retry = await run(file)
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
      // kilocode_change start - annotate a flaky batch's failing members, not the pseudo-file
      if (batches.has(r.file)) {
        for (const member of flakyMembers.get(r.file) ?? []) {
          console.log(
            `::warning file=packages/opencode/test/${member},title=Flaky test file (in ${r.file})::passed on attempt ${r.attempts} of ${retries + 1}`,
          )
        }
        continue
      }
      // kilocode_change end
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

// kilocode_change start - refresh the measured shard weights from this run. Only a full,
// unfiltered pass measures every per-file work item, so gate on that. Batch pseudo-files
// are skipped: their members are timed collectively, so per-member entries are preserved.
if (updateDurations) {
  if (patterns.length > 0 || profile || shard) {
    console.log("\n--update-durations skipped: needs a full run (no patterns, profile, or shard)")
  } else {
    // Merge over the existing file rather than replacing it: batched members are timed
    // collectively (only their pseudo-file appears in results), but their individual
    // durations still feed the computed batch weights — replacing would erase them.
    const fresh = Object.fromEntries(
      results
        // Only passing runs measure real duration: a timed-out file would record the kill
        // deadline (~600s) and a failing file records contention noise, skewing LPT.
        .filter((result) => result.passed && !batches.has(result.file))
        .map((result) => [result.file, Math.round(result.duration)] as const),
    )
    const files = new Set(candidates)
    const merged = Object.fromEntries(
      Object.entries({ ...measuredDurations, ...fresh })
        .filter(([file]) => files.has(file))
        .sort(([a], [b]) => a.localeCompare(b)),
    )
    await Bun.write(
      path.join(root, "script", "kilocode", "test-durations.json"),
      JSON.stringify(merged, null, 1) + "\n",
    )
    console.log(
      `\nUpdated script/kilocode/test-durations.json: ${Object.keys(fresh).length} re-measured, ${Object.keys(merged).length} total`,
    )
  }
}
// kilocode_change end

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
      ? `Test file timed out after ${result.deadline / 1000}s`
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
