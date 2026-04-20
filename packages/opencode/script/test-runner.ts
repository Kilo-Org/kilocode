// kilocode_change - new file
//
// Custom test runner that executes each test file in its own isolated process.
// Prevents cross-contamination between test files by ensuring separate PIDs,
// temp directories, in-memory databases, and environment state.

import os from "os"
import path from "path"
import fs from "fs/promises"

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
      "  --concurrency <N>    Max parallel processes (default: CPU count)",
      "  --timeout <ms>       Per-test timeout passed to bun test (default: 30000)",
      "  --file-timeout <ms>  Per-file process timeout (default: 300000)",
      "  --bail               Stop on first failure",
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

const ci = argv.includes("--ci")
const bail = argv.includes("--bail")
const verbose = argv.includes("--verbose")
const concurrency = opt("concurrency", os.cpus().length)
const timeout = opt("timeout", 30000)
const deadline = opt("file-timeout", 300000)
const tail = 64 * 1024

const valued = new Set(["--concurrency", "--timeout", "--file-timeout"])
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
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s)
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s)

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

const glob = new Bun.Glob("**/*.test.{ts,tsx}")
const all = (await Array.fromAsync(glob.scan({ cwd: path.join(root, "test") }))).sort()

const files =
  patterns.length > 0 ? all.filter((f) => patterns.some((p) => f.includes(p) || path.join("test", f).includes(p))) : all

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
}

type Capture = {
  full: string
  tail: string
  file: string
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const tmpdir = path.join(os.tmpdir(), `opencode-test-runner-${process.pid}`)
const xmldir = ci ? path.join(tmpdir, "junit") : ""
await fs.mkdir(tmpdir, { recursive: true })
if (ci) await fs.mkdir(xmldir, { recursive: true })

const counter = { done: 0 }
const pad = String(files.length).length

// ---------------------------------------------------------------------------
// Run a single test file
// ---------------------------------------------------------------------------

async function run(file: string): Promise<Result> {
  const target = path.join("test", file)
  const cmd = ["bun", "test", target, "--timeout", String(timeout)]
  const slug = file.replace(/[/\\:]/g, "_")

  if (ci) {
    const name = file.replace(/[/\\]/g, "_") + ".xml"
    cmd.push("--reporter=junit", `--reporter-outfile=${path.join(xmldir, name)}`)
  }

  const start = performance.now()
  const killed = { value: false }

  const proc = Bun.spawn(cmd, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })

  const timer = setTimeout(() => {
    killed.value = true
    proc.kill()
  }, deadline)

  const [out, err, code] = await Promise.all([
    capture(proc.stdout, path.join(tmpdir, `${slug}.stdout`)),
    capture(proc.stderr, path.join(tmpdir, `${slug}.stderr`)),
    proc.exited,
  ])
  const passed = code === 0
  const stdout = await output(out, passed)
  const stderr = await output(err, passed)

  clearTimeout(timer)

  return {
    file,
    passed,
    code,
    stdout,
    stderr,
    duration: performance.now() - start,
    timedout: killed.value,
  }
}

// ---------------------------------------------------------------------------
// Report a single result
// ---------------------------------------------------------------------------

function report(result: Result) {
  counter.done++
  const idx = String(counter.done).padStart(pad)
  const secs = (result.duration / 1000).toFixed(1)

  if (result.timedout) {
    console.log(
      `[${idx}/${files.length}] ${red("TIME")} ${result.file} ${dim(`(${secs}s - exceeded ${deadline / 1000}s)`)}`,
    )
    return
  }

  if (!result.passed) {
    console.log(`[${idx}/${files.length}] ${red("FAIL")} ${result.file} ${dim(`(${secs}s)`)}`)
    if (verbose && result.stderr.trim()) console.log(result.stderr)
    if (verbose && result.stdout.trim()) console.log(result.stdout)
    return
  }

  console.log(`[${idx}/${files.length}] ${green("PASS")} ${result.file} ${dim(`(${secs}s)`)}`)
  if (verbose && result.stdout.trim()) console.log(dim(result.stdout))
}

// ---------------------------------------------------------------------------
// Parallel execution
// ---------------------------------------------------------------------------

console.log(`\nRunning ${bold(String(files.length))} test files with concurrency ${bold(String(concurrency))}\n`)

const start = performance.now()
const results: Result[] = []
const queue = [...files]
const stopped = { value: false }

const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
  while (queue.length > 0 && !stopped.value) {
    const file = queue.shift()!
    const result = await run(file)
    results.push(result)
    report(result)
    if (bail && !result.passed) stopped.value = true
  }
})

await Promise.all(workers)

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

console.log(
  `\n${bold(String(results.length))} files | ` +
    `${green(passed + " passed")} | ` +
    `${failures.length > 0 ? red(failures.length + " failed") : failures.length + " failed"} | ` +
    `${elapsed.toFixed(1)}s\n`,
)

// ---------------------------------------------------------------------------
// JUnit XML merge (CI mode)
// ---------------------------------------------------------------------------

if (ci) await merge()
await fs.rm(tmpdir, { recursive: true, force: true }).catch((err) => {
  console.error("cleanup failed:", err)
})

process.exit(failures.length > 0 ? 1 : 0)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function capture(stream: ReadableStream<Uint8Array> | null, file: string): Promise<Capture> {
  const ring = {
    value: "",
    push(text: string) {
      const next = this.value + text
      this.value = next.length > tail ? next.slice(-tail) : next
    },
  }
  const chunks: string[] = []
  const sink = verbose ? undefined : await fs.open(file, "w")
  const reader = stream?.getReader()
  const decoder = new TextDecoder()
  const write = async (text: string) => {
    if (!text) return
    ring.push(text)
    if (verbose) chunks.push(text)
    await sink?.write(text)
  }

  try {
    if (reader) {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        await write(decoder.decode(chunk.value, { stream: true }))
      }
    }
    await write(decoder.decode())
    return { full: chunks.join(""), tail: ring.value, file }
  } finally {
    await sink?.close()
  }
}

async function output(cap: Capture, passed: boolean) {
  if (verbose) return cap.full
  if (passed) return cap.tail
  return Bun.file(cap.file).text()
}

async function copy(out: Awaited<ReturnType<typeof fs.open>>, file: string) {
  const reader = Bun.file(file).stream().getReader()
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    await out.write(chunk.value)
  }
}

async function merge() {
  const dir = path.join(root, ".artifacts", "unit")
  const body = path.join(tmpdir, "suites.xml")
  await fs.mkdir(dir, { recursive: true })

  const counts = { tests: 0, failures: 0, errors: 0 }
  const suites = await fs.open(body, "w")

  try {
    for (const file of files) {
      const name = file.replace(/[/\\]/g, "_") + ".xml"
      const fpath = path.join(xmldir, name)
      const found = await Bun.file(fpath).exists()

      if (found) {
        const content = await Bun.file(fpath).text()
        const extracted = extract(content)
        if (extracted) {
          await suites.write(extracted + "\n")
          counts.tests += attr(content, "tests")
          counts.failures += attr(content, "failures")
          counts.errors += attr(content, "errors")
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
      const suite =
        `  <testsuite name="${esc(file)}" tests="1" failures="1" errors="0" time="${secs}">\n` +
        `    <testcase name="${esc(file)}" classname="${esc(file)}" time="${secs}">\n` +
        `      <failure message="${esc(msg)}">${detail}</failure>\n` +
        `    </testcase>\n` +
        `  </testsuite>`

      await suites.write(suite + "\n")
      counts.tests++
      counts.failures++
    }
  } finally {
    await suites.close()
  }

  const junit = await fs.open(path.join(dir, "junit.xml"), "w")
  try {
    await junit.write(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        `<testsuites tests="${counts.tests}" failures="${counts.failures}" errors="${counts.errors}" time="${elapsed.toFixed(3)}">\n`,
    )
    await copy(junit, body)
    await junit.write("</testsuites>\n")
  } finally {
    await junit.close()
  }
}

function extract(content: string, from = 0): string {
  const root = content.indexOf("<testsuites", from)
  const start = root === -1 ? -1 : content.indexOf(">", root)
  const stop = root === -1 ? -1 : content.lastIndexOf("</testsuites>")
  if (start !== -1 && stop > start) return content.slice(start + 1, stop).trim()

  const open = "<testsuite "
  const close = "</testsuite>"
  const s = content.indexOf(open, from)
  if (s === -1) return ""
  const e = end(content, s + open.length, 1)
  if (e === -1) return ""
  const suite = content.slice(s, e)
  const rest = extract(content, e)
  return rest ? suite + "\n" + rest : suite
}

function end(content: string, from: number, depth: number): number {
  const open = "<testsuite "
  const close = "</testsuite>"
  const s = content.indexOf(open, from)
  const e = content.indexOf(close, from)
  if (e === -1) return -1
  if (s !== -1 && s < e) return end(content, s + open.length, depth + 1)
  if (depth === 1) return e + close.length
  return end(content, e + close.length, depth - 1)
}

function attr(content: string, name: string): number {
  const match = content.match(new RegExp(`${name}="(\\d+)"`))
  return match ? Number(match[1]) : 0
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
