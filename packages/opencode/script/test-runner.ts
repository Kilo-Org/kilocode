// kilocode_change - new file
// Runs validated domains in reusable processes while retaining one process per
// file for domains that have not been migrated yet.

import fs from "fs/promises"
import os from "os"
import path from "path"
import { TestGroup } from "./kilocode/test-groups"
import { TestProfile } from "./kilocode/test-profile"

const root = path.resolve(import.meta.dir, "..")
const argv = process.argv.slice(2)

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    [
      "",
      "Usage: bun run script/test-runner.ts [options] [patterns...]",
      "",
      "Runs validated semantic domains with isolated fallback for all other files.",
      "",
      "Options:",
      "  --ci                 Write JUnit XML to .artifacts/unit/junit.xml",
      "  --concurrency <N>    Max parallel test processes (default: min(4, CPU count))",
      "  --timeout <ms>       Per-test timeout passed to Bun (default: 60000)",
      "  --file-timeout <ms>  Per-process timeout (default: 300000)",
      "  --retries <N>        Extra attempts for isolated files only (default: 1)",
      "  --profile <name>     Run a curated test profile (env: KILO_TEST_PROFILE)",
      "  --domain <name>      Run one semantic test domain",
      "  --bail               Stop scheduling groups after the first failure",
      "  --dots               Show compact progress",
      "  --verbose            Show output for every process",
      "  -h, --help           Show this help",
      "",
    ].join("\n"),
  )
  process.exit(0)
}

function value(name: string) {
  const flag = `--${name}`
  const found = argv.filter((arg) => arg === flag || arg.startsWith(`${flag}=`))
  if (found.length === 0) return
  if (found.length > 1) {
    console.error(`Duplicate option: ${flag}`)
    process.exit(2)
  }
  const arg = found[0]
  if (arg !== flag) return arg.slice(flag.length + 1)
  const index = argv.indexOf(flag)
  const next = argv[index + 1]
  if (next !== undefined) return next
  console.error(`Missing value for ${flag}`)
  process.exit(2)
}

function number(name: string, fallback: number) {
  const input = value(name)
  if (input === undefined) return fallback
  const parsed = Number(input)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  console.error(`Invalid value for --${name}: ${input || "missing"}`)
  process.exit(2)
}

function text(name: string) {
  const input = value(name)
  if (input === undefined) return
  if (input && !input.startsWith("-")) return input
  console.error(`Missing value for --${name}`)
  process.exit(2)
}

const valued = new Set(["--concurrency", "--timeout", "--file-timeout", "--retries", "--profile", "--domain"])
const boolean = new Set(["--ci", "--bail", "--dots", "--verbose", "--help", "-h"])
for (const arg of argv) {
  if (!arg.startsWith("-")) continue
  const flag = arg.split("=", 1)[0]
  if (valued.has(flag) && (arg === flag || arg.startsWith(`${flag}=`))) continue
  if (boolean.has(arg)) continue
  console.error(`Unknown option: ${arg}`)
  process.exit(2)
}

const ci = argv.includes("--ci")
const bail = argv.includes("--bail")
const verbose = argv.includes("--verbose")
const dots = !verbose && (ci || argv.includes("--dots"))
const concurrency = number("concurrency", Math.min(4, os.cpus().length))
const timeout = number("timeout", 60_000)
const deadline = number("file-timeout", 300_000)
const retries = number("retries", 1)
const domain = text("domain")
const flag = text("profile")
const env = process.env.KILO_TEST_PROFILE?.trim() || undefined
if (flag && env && flag !== env) {
  console.error(`Conflicting test profiles: --profile=${flag}, KILO_TEST_PROFILE=${env}`)
  process.exit(2)
}
const profile = flag ?? env
const patterns = argv.filter((arg, index) => {
  if (arg.startsWith("-")) return false
  return index === 0 || !valued.has(argv[index - 1])
})

const glob = new Bun.Glob("**/*.test.{ts,tsx}")
const all = (await Array.fromAsync(glob.scan({ cwd: path.join(root, "test") })))
  .map((file) => file.replaceAll("\\", "/"))
  .toSorted()
const eligible = all.filter((file) => !TestGroup.excluded.has(file))
const grouped = TestGroup.resolve(eligible)
if (!grouped.ok) {
  console.error(grouped.error)
  process.exit(2)
}
const selected = (() => {
  if (!profile) return eligible
  const result = TestProfile.resolve(profile, all)
  if (!result.ok) {
    console.error(result.error)
    process.exit(2)
  }
  const blocked = result.files.filter((file) => TestGroup.excluded.has(file))
  if (blocked.length > 0) {
    console.error(
      `Test profile "${profile}" contains excluded files:\n${blocked.map((file) => `- ${file}`).join("\n")}`,
    )
    process.exit(2)
  }
  console.log(`Using test profile "${profile}": ${result.description} (${result.files.length} files)`)
  return result.files
})()
const scoped = (() => {
  if (!domain) return selected
  const group = grouped.groups.find((group) => group.name === domain)
  if (!group) {
    console.error(
      `Unknown test domain: ${domain}\nAvailable domains: ${grouped.groups.map((group) => group.name).join(", ")}`,
    )
    process.exit(2)
  }
  const allowed = new Set(group.files)
  return selected.filter((file) => allowed.has(file))
})()
const files =
  patterns.length > 0
    ? scoped.filter((file) =>
        patterns.some((pattern) => file.includes(pattern) || path.join("test", file).includes(pattern)),
      )
    : scoped
if (files.length === 0) {
  console.log("No test files found")
  process.exit(0)
}

type Unit = {
  id: number
  name: string
  files: string[]
  weight: number
  isolated: boolean
}

type Result = Unit & {
  passed: boolean
  code: number
  stdout: string
  stderr: string
  duration: number
  timedout: boolean
  attempts: number
  report: string
}

const chosen = new Set(files)
const weights = new Map(files.map((file) => [file, Bun.file(path.join(root, "test", file)).size]))
const pending: Omit<Unit, "id">[] = []
for (const group of grouped.groups) {
  const members = group.files.filter((file) => chosen.has(file))
  if (members.length === 0) continue
  if (group.mode === "domain") {
    pending.push({
      name: group.name,
      files: members,
      weight: members.reduce((sum, file) => sum + weights.get(file)!, 0),
      isolated: false,
    })
    continue
  }
  for (const file of members) {
    pending.push({
      name: `${group.name}:${file}`,
      files: [file],
      weight: weights.get(file)!,
      isolated: true,
    })
  }
}
const units = pending
  .filter((unit) => unit.files.length > 0)
  .toSorted((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
  .map((unit, id) => ({ ...unit, id }))
const covered = units.flatMap((unit) => unit.files)
if (covered.length !== files.length || new Set(covered).size !== files.length) {
  console.error(`Runner plan covers ${covered.length} entries for ${files.length} selected files`)
  process.exit(2)
}

const run = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-run-"))
const xmldir = path.join(run, "junit")
if (ci) await fs.mkdir(xmldir, { recursive: true })
const launches = { value: 0 }

async function execute(unit: Unit, attempt: number): Promise<Result> {
  launches.value++
  const report = path.join(xmldir, `${unit.id}-${attempt}.xml`)
  const cmd = [
    process.execPath,
    "test",
    ...unit.files.map((file) => path.join("test", file)),
    "--isolate",
    "--only-failures",
    "--timeout",
    String(timeout),
  ]
  if (process.platform !== "win32") cmd.push("--no-orphans")
  if (ci) cmd.push("--reporter=junit", `--reporter-outfile=${report}`)
  const start = performance.now()
  const timedout = { value: false }
  const proc = Bun.spawn(cmd, {
    cwd: root,
    env: {
      ...process.env,
      ...(unit.isolated ? {} : { KILO_TEST_ROOT: run }),
      ...(profile ? { KILO_TEST_PROFILE: profile } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    detached: process.platform !== "win32",
  })
  const timer = setTimeout(() => {
    timedout.value = true
    if (process.platform === "win32") {
      const child = Bun.spawnSync(["taskkill", "/pid", String(proc.pid), "/t", "/f"], {
        stdout: "ignore",
        stderr: "ignore",
        windowsHide: true,
      })
      if (child.exitCode !== 0) {
        console.error(`Failed to terminate timed out test process tree ${proc.pid}`)
        proc.kill(9)
      }
      return
    }
    try {
      process.kill(-proc.pid, "SIGKILL")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        console.error("Failed to terminate test process group", error)
      proc.kill(9)
    }
  }, deadline)
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  return {
    ...unit,
    passed: code === 0 && !timedout.value,
    code,
    stdout,
    stderr,
    duration: performance.now() - start,
    timedout: timedout.value,
    attempts: attempt,
    report,
  }
}

async function runUnit(unit: Unit, attempt = 1): Promise<Result> {
  const result = await execute(unit, attempt)
  if (result.passed || !unit.isolated || stopped.value || attempt > retries) return result
  return runUnit(unit, attempt + 1)
}

const tty = !!process.stdout.isTTY
const color = (code: number, value: string) => (tty ? `\x1b[${code}m${value}\x1b[0m` : value)
const green = (value: string) => color(32, value)
const red = (value: string) => color(31, value)
const yellow = (value: string) => color(33, value)
const dim = (value: string) => color(2, value)
const bold = (value: string) => color(1, value)
const marks = { pass: ".", retry: "R", fail: "F", timeout: "T" } as const
const count = { value: 0 }
const width = String(units.length).length

function mark(result: Result) {
  if (result.timedout) return marks.timeout
  if (!result.passed) return marks.fail
  if (result.attempts > 1) return marks.retry
  return marks.pass
}

function report(result: Result) {
  count.value++
  if (dots) {
    process.stdout.write(mark(result))
    if (count.value % 80 === 0) process.stdout.write("\n")
    return
  }
  const index = String(count.value).padStart(width)
  const seconds = (result.duration / 1000).toFixed(1)
  const label = result.timedout
    ? red("TIME")
    : !result.passed
      ? red("FAIL")
      : result.attempts > 1
        ? yellow("FLAKY")
        : green("PASS")
  console.log(
    `[${index}/${units.length}] ${label} ${result.name} ${dim(`(${seconds}s, ${result.files.length} files)`)}`,
  )
  if (verbose && result.stdout.trim()) console.log(dim(result.stdout))
  if (verbose && result.stderr.trim()) console.log(result.stderr)
}

const domains = units.filter((unit) => !unit.isolated).length
console.log(
  `\nRunning ${bold(String(files.length))} test files in ${bold(String(units.length))} processes ` +
    `(${domains} reusable ${domains === 1 ? "domain" : "domains"}, concurrency ${concurrency})`,
)
if (dots)
  console.log(
    dim(`Legend: ${marks.pass}=pass ${marks.retry}=pass-after-retry ${marks.fail}=fail ${marks.timeout}=timeout`),
  )
console.log()

const start = performance.now()
const queue = [...units]
const results: Result[] = []
const stopped = { value: false }
const workers = Array.from({ length: Math.min(concurrency, units.length) }, async () => {
  while (queue.length > 0 && !stopped.value) {
    const result = await runUnit(queue.shift()!)
    results.push(result)
    report(result)
    if (bail && !result.passed) stopped.value = true
  }
})
await Promise.all(workers)
if (dots && count.value % 80 !== 0) console.log()

const elapsed = (performance.now() - start) / 1000
const failures = results.filter((result) => !result.passed).toSorted((a, b) => a.name.localeCompare(b.name))
if (failures.length > 0 && !verbose) {
  console.log(`\n${bold(red("--- FAILURES ---"))}\n`)
  for (const failure of failures) {
    console.log(`${bold(red(failure.name))} (${failure.files.join(", ")}):`)
    const output = (failure.stderr || failure.stdout).trim()
    if (output)
      console.log(
        output
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n"),
      )
    console.log()
  }
}

const flaky = results.filter((result) => result.passed && result.attempts > 1)
if (flaky.length > 0) {
  console.log(`${bold(yellow("--- FLAKY DEDICATED FILES ---"))}\n`)
  for (const result of flaky.toSorted((a, b) => a.files[0].localeCompare(b.files[0]))) {
    console.log(`  ${yellow(result.files[0])} ${dim(`(passed on attempt ${result.attempts}/${retries + 1})`)}`)
  }
  console.log()

  if (process.env.GITHUB_ACTIONS === "true") {
    for (const result of flaky) {
      const file = `packages/opencode/test/${result.files[0]}`
      console.log(
        `::warning file=${file},title=Flaky test file::passed on attempt ${result.attempts} of ${retries + 1}`,
      )
    }
    const summary = process.env.GITHUB_STEP_SUMMARY
    if (summary) {
      const rows = flaky
        .toSorted((a, b) => a.files[0].localeCompare(b.files[0]))
        .map((result) => `| \`${result.files[0]}\` | ${result.attempts}/${retries + 1} |`)
      await fs.appendFile(
        summary,
        ["### Flaky test files", "", "| File | Attempts |", "|---|---|", ...rows, ""].join("\n"),
      )
    }
  }
}

const invalid: string[] = []
if (ci) {
  const output = path.join(root, ".artifacts", "unit", "junit.xml")
  await fs.mkdir(path.dirname(output), { recursive: true })
  const suites: string[] = []
  const counts = { tests: 0, failures: 0, errors: 0, skipped: 0 }
  for (const result of results) {
    const file = Bun.file(result.report)
    const exists = await file.exists()
    const content = exists ? await file.text() : ""
    const inner = extractSuites(content)
    const root = content.match(/<testsuites\b([^>]*)>/)
    if (inner !== undefined && root) {
      suites.push(inner)
      counts.tests += attribute(root[1], "tests")
      counts.failures += attribute(root[1], "failures")
      counts.errors += attribute(root[1], "errors")
      counts.skipped += attribute(root[1], "skipped")
      continue
    }
    if (!exists && result.passed && result.isolated) continue

    invalid.push(result.name)
    const seconds = (result.duration / 1000).toFixed(3)
    const message = result.timedout
      ? `Test process timed out after ${deadline / 1000}s`
      : result.code === 0
        ? "Test process produced no valid JUnit report"
        : `Test process exited with code ${result.code}`
    const detail = escapeXml((result.stderr || result.stdout || message).slice(0, 10_000))
    for (const test of result.files) {
      suites.push(
        `  <testsuite name="${escapeXml(test)}" tests="1" failures="1" errors="0" skipped="0" time="${seconds}">\n` +
          `    <testcase name="${escapeXml(test)}" classname="${escapeXml(result.name)}" time="${seconds}">\n` +
          `      <failure message="${escapeXml(message)}">${detail}</failure>\n` +
          `    </testcase>\n` +
          `  </testsuite>`,
      )
      counts.tests++
      counts.failures++
    }
  }
  await Bun.write(
    output,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<testsuites tests="${counts.tests}" failures="${counts.failures}" errors="${counts.errors}" skipped="${counts.skipped}" time="${elapsed.toFixed(3)}">`,
      ...suites,
      "</testsuites>",
      "",
    ].join("\n"),
  )
}

await fs.rm(run, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
const passed = results.filter((result) => result.passed).reduce((sum, result) => sum + result.files.length, 0)
const failed = failures.reduce((sum, result) => sum + result.files.length, 0)
console.log(
  `\n${bold(String(results.reduce((sum, result) => sum + result.files.length, 0)))} files | ` +
    `${green(`${passed} passed`)} | ` +
    `${failed > 0 ? red(`${failed} failed in ${failures.length} processes`) : "0 failed"} | ` +
    `${launches.value} launches | ${elapsed.toFixed(1)}s\n`,
)
if (invalid.length > 0)
  console.error(`Missing or invalid JUnit reports:\n${invalid.map((name) => `- ${name}`).join("\n")}`)
process.exit(failures.length > 0 || invalid.length > 0 ? 1 : 0)

function extractSuites(content: string) {
  const open = content.match(/<testsuites\b[^>]*>/)
  if (!open) return
  const start = open.index! + open[0].length
  const end = content.lastIndexOf("</testsuites>")
  if (end === -1 || end < start) return
  return content.slice(start, end).trim()
}

function attribute(input: string, name: string) {
  const match = input.match(new RegExp(`\\b${name}="(\\d+)"`))
  return match ? Number(match[1]) : 0
}

function escapeXml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}
