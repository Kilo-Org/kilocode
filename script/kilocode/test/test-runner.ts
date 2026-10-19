#!/usr/bin/env bun

/**
 * Parallel, sharded test runner for the large workspace packages (core, tui, cli). Ported from the v1
 * runner (`packages/opencode/script/test-runner.ts` on `main`) and adapted to the v2 package layout.
 *
 * Run it from a package directory (the `test:ci` script does). It starts the package's own `test`
 * script with file arguments (`bun run test <files>`), so each package keeps its isolation wrapper,
 * preload and timeouts.
 *
 * - Shards: `--shard N/M` or `KILO_TEST_SHARD` runs one part of the work items. The split is
 *   longest-processing-time over the measured durations in test-durations.json.
 * - Own process: heavy files (at least BATCH_MS) and files with process-wide state (bun module mocks,
 *   spies on globals, module-scope env writes) run alone.
 * - Fast tier: the other files share a process, in path order, in batches of about BATCH_MS. Upstream
 *   runs each package suite in one process, so every directory is isolation-safe; batches only save
 *   the process start and module load that each file would otherwise pay.
 * - Retries: a failing item runs again (`--retries`, default 1). A pass on retry is reported as flaky.
 * - JUnit: `--ci` merges the per-process reports into artifacts/unit/<package>[-<N>of<M>].xml.
 */

import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { TestShard } from "./test-shard"

const ROOT = path.resolve(import.meta.dir, "../../..")
const DURATIONS = path.join(import.meta.dir, "test-durations.json")
// Files at least this slow run alone, and batches fill up to about this much measured time.
const BATCH_MS = 10_000
// Weight of a file without a measurement.
const DEFAULT_MS = 1_500
// Process-wide state that would leak into the other files of a batch.
const UNSAFE = [/\bmock\.module\s*\(/, /\bspyOn\s*\(\s*globalThis\b/, /^process\.env[.[]/m]

const argv = process.argv.slice(2)

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    [
      "",
      "Usage, from a package directory: bun ../../script/kilocode/test/test-runner.ts [options] [patterns...]",
      "",
      "Options:",
      "  --ci                 Write a merged JUnit report to artifacts/unit/",
      "  --concurrency <N>    Parallel processes (default: min(4, CPU count), env: KILO_TEST_CONCURRENCY)",
      "  --file-timeout <ms>  Kill deadline per process (default: 300000, env: KILO_TEST_FILE_TIMEOUT)",
      "  --retries <N>        Extra attempts for a failing item (default: 1)",
      "  --shard <N/M>        Run one balanced shard (env: KILO_TEST_SHARD)",
      "  --update-durations   Run every file alone and store its duration in test-durations.json",
      "  --bail               Stop after the first failure",
      "  --verbose            Print the output of every item",
      "",
      "Patterns filter the test files by substring.",
      "",
    ].join("\n"),
  )
  process.exit(0)
}

const cwd = process.cwd()
const pkg = path.relative(ROOT, cwd).replaceAll("\\", "/")
const ci = argv.includes("--ci")
const bail = argv.includes("--bail")
const verbose = argv.includes("--verbose")
const update = argv.includes("--update-durations")
const concurrency = count("concurrency", "KILO_TEST_CONCURRENCY", Math.min(4, os.cpus().length), 1)
const deadline = count("file-timeout", "KILO_TEST_FILE_TIMEOUT", 300_000, 1)
const retries = count("retries", undefined, 1, 0)
const shard = shardOf()
const valued = new Set(["--concurrency", "--file-timeout", "--retries", "--shard"])
const patterns = argv.filter((arg, i) => !arg.startsWith("-") && !valued.has(argv[i - 1] ?? ""))

// ---------------------------------------------------------------------------
// Work items
// ---------------------------------------------------------------------------

const listed = await Bun.$`git ls-files --cached --others --exclude-standard -- ${"*.test.ts"} ${"*.test.tsx"}`
  .cwd(cwd)
  .quiet()
  .text()
const discovered = await Promise.all(
  [...new Set(listed.split("\n").map((line) => line.trim()))]
    .filter((file) => file && !file.split("/").includes("node_modules"))
    .map(async (file) => ((await Bun.file(path.join(cwd, file)).exists()) ? file : undefined)),
)
const candidates = discovered
  .filter((file): file is string => file !== undefined)
  .filter((file) => patterns.length === 0 || patterns.some((pattern) => file.includes(pattern)))
  .sort()

const durations: Record<string, number> = await Bun.file(DURATIONS)
  .json()
  .catch(() => ({}))
const weight = (file: string) => durations[`${pkg}/${file}`] ?? DEFAULT_MS

// Batch only a full run: a filtered run is local debugging, and --update-durations measures each file alone.
const batches = patterns.length === 0 && !update ? await batch(candidates) : new Map<string, string[]>()
const batched = new Set([...batches.values()].flat())
const items = [...batches.keys(), ...candidates.filter((file) => !batched.has(file))]
const itemWeight = (item: string) => batches.get(item)?.reduce((sum, file) => sum + weight(file), 0) ?? weight(item)
const selected = shard ? (TestShard.split(items, itemWeight, shard.total)[shard.index - 1] ?? []) : items

if (selected.length === 0) {
  console.log(shard ? `No test files in shard ${shard.index}/${shard.total}` : "No test files found")
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

type Result = {
  item: string
  passed: boolean
  code: number
  output: string
  duration: number
  timedout: boolean
  attempts: number
}

type Proc = ReturnType<typeof Bun.spawn>

const xmldir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-junit-"))
const active = new Map<number, Proc>()
const state = { done: 0, stopped: false, stopping: undefined as Promise<void> | undefined }
const pad = String(selected.length).length
const flakyMembers = new Map<string, string[]>()

process.once("SIGINT", () => void shutdown(130))
process.once("SIGTERM", () => void shutdown(143))

for (const [name, members] of batches) {
  if (selected.includes(name)) console.log(`${name}: ${members.length} files in one process`)
}
console.log(
  `\nRunning ${selected.length} items (${selected.flatMap((item) => batches.get(item) ?? [item]).length} files) of ${pkg} with concurrency ${concurrency}` +
    (shard ? `, shard ${shard.index}/${shard.total}` : "") +
    "\n",
)

const start = performance.now()
const queue = TestShard.order(selected, itemWeight)
const results: Result[] = []

await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0 && !state.stopped) {
      const item = queue.shift()!
      const first = await run(item)
      const result = await retry(item, first)
      results.push(result)
      report(result)
      if (bail && !result.passed) state.stopped = true
    }
  }),
)

const elapsed = (performance.now() - start) / 1000
const failures = results.filter((result) => !result.passed).sort((a, b) => a.item.localeCompare(b.item))
const flaky = results.filter((result) => result.passed && result.attempts > 1).sort((a, b) => a.item.localeCompare(b.item))

if (failures.length > 0 && !verbose) {
  console.log("\n--- FAILURES ---\n")
  for (const failure of failures) {
    console.log(`${failure.item}${failure.timedout ? " (TIMED OUT)" : ""}:`)
    console.log(
      failure.output
        .trim()
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    )
    console.log()
  }
}

console.log(
  `\n${results.length} items | ${results.length - failures.length} passed | ${failures.length} failed | ${flaky.length} flaky | ${elapsed.toFixed(1)}s\n`,
)

if (flaky.length > 0) {
  console.log("--- FLAKY (passed on retry) ---\n")
  for (const result of flaky) {
    const members = flakyMembers.get(result.item)
    console.log(`  ${result.item} (attempt ${result.attempts}/${retries + 1})${members?.length ? `: ${members.join(", ")}` : ""}`)
  }
  console.log()
}

if (ci) await merge()
if (update) await store()
await fs.rm(xmldir, { recursive: true, force: true })
process.exit(failures.length > 0 ? 1 : 0)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function count(name: string, env: string | undefined, fallback: number, min: number) {
  const index = argv.indexOf(`--${name}`)
  const raw = index >= 0 ? argv[index + 1] : env ? process.env[env]?.trim() || undefined : undefined
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (Number.isSafeInteger(value) && value >= min) return value
  console.error(`Invalid ${index >= 0 ? `--${name}` : env} "${raw}"; expected an integer >= ${min}`)
  process.exit(2)
}

function shardOf() {
  const index = argv.indexOf("--shard")
  const flag = index >= 0 ? argv[index + 1] : undefined
  const env = process.env.KILO_TEST_SHARD?.trim() || undefined
  if (flag && env && flag !== env) {
    console.error(`Conflicting test shards: --shard=${flag}, KILO_TEST_SHARD=${env}`)
    process.exit(2)
  }
  const parsed = TestShard.parse(flag ?? env)
  if (parsed.ok) return parsed.value
  console.error(parsed.error)
  process.exit(2)
}

async function batch(files: string[]) {
  // Sequential reads: hundreds of parallel opens can pass a low file descriptor limit (macOS shells default to 256).
  const unsafe = new Set<string>()
  for (const file of files) {
    const source = await Bun.file(path.join(cwd, file)).text()
    if (UNSAFE.some((marker) => marker.test(source))) unsafe.add(file)
  }
  // Path order keeps a directory together; a chunk closes when the next file would pass BATCH_MS.
  const chunks = files
    .filter((file) => weight(file) < BATCH_MS && !unsafe.has(file))
    .reduce<string[][]>((all, file) => {
      const last = all.at(-1)
      if (last && last.reduce((sum, item) => sum + weight(item), 0) + weight(file) <= BATCH_MS) last.push(file)
      else all.push([file])
      return all
    }, [])
    .filter((chunk) => chunk.length > 1)
  return new Map(chunks.map((chunk, i) => [`[batch ${i + 1}: ${chunk[0]} ..]`, chunk]))
}

async function run(item: string): Promise<Result> {
  const files = batches.get(item) ?? [item]
  // `./` makes bun treat each argument as a path, not as a substring filter.
  const cmd = [process.execPath, "run", "test", ...files.map((file) => `./${file}`), "--reporter=junit", `--reporter-outfile=${xmlOf(item)}`]
  const begin = performance.now()
  const proc = Bun.spawn(cmd, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    detached: process.platform !== "win32",
  })
  active.set(proc.pid, proc)
  const streams = [collect(proc.stdout), collect(proc.stderr)]
  const timer = Symbol("timeout")
  const ended = await Promise.race([proc.exited, Bun.sleep(deadline).then(() => timer)])
  if (ended === timer) await terminate(proc)
  active.delete(proc.pid)
  // A process that a test left running can keep the pipes open. Wait a moment, then keep what arrived.
  const closed = await Promise.race([Promise.all(streams.map((stream) => stream.done)).then(() => true), Bun.sleep(2_000)])
  if (closed !== true) streams.forEach((stream) => stream.cancel())
  return {
    item,
    passed: ended === 0,
    code: typeof ended === "number" ? ended : -1,
    output: streams
      .map((stream) => stream.text())
      .filter(Boolean)
      .join("\n"),
    duration: performance.now() - begin,
    timedout: ended === timer,
    attempts: 1,
  }
}

function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  const done = (async () => {
    while (true) {
      const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }))
      if (chunk.done) return
      chunks.push(decoder.decode(chunk.value, { stream: true }))
    }
  })()
  return { done, text: () => chunks.join(""), cancel: () => void reader.cancel().catch(() => undefined) }
}

// Contention flakes (ports, slow spawn) fail fast and pass on retry; real bugs fail every attempt.
// A timeout already used the full deadline, so it does not run again.
async function retry(item: string, result: Result): Promise<Result> {
  if (result.passed || result.timedout || result.attempts > retries || state.stopped) return result
  if (batches.has(item)) flakyMembers.set(item, await failedMembers(item))
  const next = await run(item)
  return retry(item, { ...next, attempts: result.attempts + 1 })
}

async function failedMembers(item: string) {
  const xml = await Bun.file(xmlOf(item))
    .text()
    .catch(() => "")
  return [...xml.matchAll(/<testsuite\b[^>]*>/g)]
    .map((match) => ({ file: attr(match[0], "file"), failed: Number(attr(match[0], "failures")) > 0 }))
    .filter((suite) => suite.failed && suite.file)
    .map((suite) => suite.file)
    .filter((file, i, all) => all.indexOf(file) === i)
}

function report(result: Result) {
  state.done++
  const files = batches.get(result.item)?.length
  const label = files ? `${result.item} (${files} files)` : result.item
  const status = result.timedout ? "TIME" : !result.passed ? "FAIL" : result.attempts > 1 ? "FLAKY" : "PASS"
  const extra = result.timedout ? `, killed after ${deadline / 1000}s` : ""
  const tries = result.attempts > 1 ? ` [attempt ${result.attempts}/${retries + 1}]` : ""
  console.log(`[${String(state.done).padStart(pad)}/${selected.length}] ${status} ${label} (${(result.duration / 1000).toFixed(1)}s${extra})${tries}`)
  if (verbose && result.output.trim()) console.log(result.output)
}

async function merge() {
  const suites = await Promise.all(
    results.map(async (result) => {
      const xml = await Bun.file(xmlOf(result.item))
        .text()
        .catch(() => "")
      const open = xml.match(/<testsuites\b[^>]*>/)
      const end = xml.lastIndexOf("</testsuites>")
      if (open && end > open.index! + open[0].length) {
        return {
          body: xml.slice(open.index! + open[0].length, end).trim(),
          tests: Number(attr(open[0], "tests")),
          failures: Number(attr(open[0], "failures")),
        }
      }
      if (result.passed) return undefined
      // A process that crashed or timed out wrote no report: record one failed case for it.
      const secs = (result.duration / 1000).toFixed(3)
      const message = result.timedout ? `Timed out after ${deadline / 1000}s` : `Test process exited with code ${result.code}`
      return {
        body:
          `  <testsuite name="${esc(result.item)}" tests="1" failures="1" time="${secs}">\n` +
          `    <testcase name="${esc(result.item)}" classname="${esc(pkg)}" time="${secs}">\n` +
          `      <failure message="${esc(message)}">${esc(result.output.slice(0, 10_000))}</failure>\n` +
          `    </testcase>\n` +
          `  </testsuite>`,
        tests: 1,
        failures: 1,
      }
    }),
  )
  const found = suites.filter((suite) => suite !== undefined)
  const file = path.join(ROOT, "artifacts", "unit", `${path.basename(cwd)}${shard ? `-${shard.index}of${shard.total}` : ""}.xml`)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await Bun.write(
    file,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<testsuites name="${esc(pkg)}" tests="${found.reduce((sum, suite) => sum + suite.tests, 0)}" failures="${found.reduce((sum, suite) => sum + suite.failures, 0)}" time="${elapsed.toFixed(3)}">`,
      ...found.map((suite) => suite.body),
      "</testsuites>",
      "",
    ].join("\n"),
  )
  console.log(`JUnit report: ${path.relative(ROOT, file)}`)
}

// A timed-out file records only the deadline, so it keeps its old entry. Entries of other packages stay; deleted files go.
async function store() {
  if (patterns.length > 0 || shard) {
    console.log("--update-durations skipped: it needs a full run without patterns or shard")
    return
  }
  const fresh = Object.fromEntries(
    results.filter((result) => !result.timedout).map((result) => [`${pkg}/${result.item}`, Math.round(result.duration)]),
  )
  const current = new Set(candidates.map((file) => `${pkg}/${file}`))
  const merged = Object.fromEntries(
    Object.entries({ ...durations, ...fresh })
      .filter(([key]) => !key.startsWith(`${pkg}/`) || current.has(key))
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  await Bun.write(DURATIONS, JSON.stringify(merged, null, 1) + "\n")
  console.log(`Updated ${path.relative(ROOT, DURATIONS)}: ${Object.keys(fresh).length} measured in ${pkg}`)
}

function xmlOf(item: string) {
  return path.join(xmldir, `${item.replace(/[^a-zA-Z0-9.-]+/g, "_")}.xml`)
}

async function signal(proc: Proc, sig: "SIGTERM" | "SIGKILL") {
  if (process.platform === "win32") {
    const args = ["/pid", String(proc.pid), "/T", ...(sig === "SIGKILL" ? ["/F"] : [])]
    await Bun.spawn(["taskkill", ...args], { stdout: "ignore", stderr: "ignore", windowsHide: true }).exited
    return
  }
  // The test script starts `bun test` as a child, so signal the whole process tree.
  const text = await Bun.$`ps -axo pid=,ppid=`.quiet().nothrow().text()
  const children = new Map<number, number[]>()
  for (const row of text.trim().split("\n")) {
    const [pid = NaN, parent = NaN] = row.trim().split(/\s+/).map(Number)
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parent)) continue
    children.set(parent, [...(children.get(parent) ?? []), pid])
  }
  const tree = (pid: number): number[] => (children.get(pid) ?? []).flatMap((child) => [...tree(child), child])
  for (const pid of [...tree(proc.pid), proc.pid]) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, sig)
      } catch {
        // The process already ended, or it is not ours to signal.
      }
    }
  }
}

async function terminate(proc: Proc) {
  if (proc.exitCode !== null) return
  await signal(proc, "SIGTERM")
  if ((await Promise.race([proc.exited.then(() => true), Bun.sleep(2_000).then(() => false)])) === true) return
  await signal(proc, "SIGKILL")
  await Promise.race([proc.exited, Bun.sleep(2_000)])
}

function shutdown(code: number) {
  state.stopping ??= (async () => {
    state.stopped = true
    await Promise.all([...active.values()].map(terminate))
    await fs.rm(xmldir, { recursive: true, force: true })
    process.exit(code)
  })()
  return state.stopping
}

function attr(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? ""
}

function esc(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
