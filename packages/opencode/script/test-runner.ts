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
      "  --concurrency <N>    Max parallel processes (default: min(4, CPU count))",
      "  --timeout <ms>       Per-test timeout passed to bun test (default: 60000)",
      "  --file-timeout <ms>  Per-file process timeout (default: 300000)",
      "  --retries <N>        Extra attempts for failing files (default: 1)",
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
// Cap concurrency at 4 even on bigger runners: the bottleneck is shared
// resources (ports, global filesystem like ~/.local/share/kilo), not CPU.
// Eight parallel processes was triggering port/FS races, not going faster.
const concurrency = opt("concurrency", Math.min(4, os.cpus().length))
const timeout = opt("timeout", 60000)
const deadline = opt("file-timeout", 300000)
const retries = opt("retries", 1)

const valued = new Set(["--concurrency", "--timeout", "--file-timeout", "--retries"])
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
const all = (await Array.fromAsync(glob.scan({ cwd: path.join(root, "test") }))).sort()

export const skipped = new Set([
  // Upstream browser OAuth integration tests bind the fixed callback port and
  // race with other parallel OAuth tests in CI.
  "mcp/oauth-browser.test.ts",
])

const matched =
  patterns.length > 0 ? all.filter((f) => patterns.some((p) => f.includes(p) || path.join("test", f).includes(p))) : all
const files = patterns.length > 0 ? matched : matched.filter((f) => !skipped.has(f)) // kilocode_change

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
  attempts: number
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const xmldir = ci ? path.join(os.tmpdir(), `opencode-junit-${process.pid}`) : ""
if (ci) await fs.mkdir(xmldir, { recursive: true })

const counter = { done: 0 }
const pad = String(files.length).length

// ---------------------------------------------------------------------------
// Run a single test file
// ---------------------------------------------------------------------------

async function run(file: string): Promise<Result> {
  const target = path.join("test", file)
  const cmd = ["bun", "test", target, "--timeout", String(timeout)]

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

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  clearTimeout(timer)

  return {
    file,
    passed: code === 0,
    code,
    stdout,
    stderr,
    duration: performance.now() - start,
    timedout: killed.value,
    attempts: 1,
  }
}

// ---------------------------------------------------------------------------
// Report a single result
// ---------------------------------------------------------------------------

function report(result: Result) {
  counter.done++
  const idx = String(counter.done).padStart(pad)
  const secs = (result.duration / 1000).toFixed(1)
  const tries = result.attempts > 1 ? dim(` [attempt ${result.attempts}/${retries + 1}]`) : ""

  if (result.timedout) {
    console.log(
      `[${idx}/${files.length}] ${red("TIME")} ${result.file} ${dim(`(${secs}s - exceeded ${deadline / 1000}s)`)}${tries}`,
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

console.log(`\nRunning ${bold(String(files.length))} test files with concurrency ${bold(String(concurrency))}\n`)

const start = performance.now()
const results: Result[] = []
const queue = [...files]
const stopped = { value: false }

const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
  while (queue.length > 0 && !stopped.value) {
    const file = queue.shift()!
    let result = await run(file)
    // Retry failing files up to `retries` extra times. Bugs still fail on every
    // attempt; contention-based flakes (port races, slow FS, slow spawn) recover.
    // Preserve the last attempt's stdout/stderr/duration so a truly broken file
    // still shows a useful diagnostic.
    while (!result.passed && result.attempts <= retries && !stopped.value) {
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
      console.log(
        `::warning file=${repo},title=Flaky test file::passed on attempt ${r.attempts} of ${retries + 1}`,
      )
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
