#!/usr/bin/env bun

/**
 * Run the headful JetBrains Starter/Driver adapter for one K1 driver request.
 *
 * Usage:
 *   bun script/e2e-driver.ts --request <driver-request.json> --result <driver-result.json>
 *
 * The coordinator launches this as the driver command and appends --request/--result.
 * Secrets travel only through the inherited environment; we never put them in argv.
 * --no-daemon is required so Gradle inherits that environment for the test JVM and IDE.
 *
 * The adapter always tries to leave a K1 DriverResult behind. If Gradle fails before the test
 * can write one (for example a pinned/released CLI build), this wrapper writes a failed result
 * with the actionable Gradle output so the coordinator reports driver_failed, not driver_crash.
 *
 * The wrapper owns the whole Gradle tree rather than just its direct child: with --no-daemon
 * nothing else notices a wrapper timeout, so a timeout or signal kills forked test JVMs and the
 * headful IDE before exiting instead of leaving them orphaned.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew"
const DEFAULT_BUDGET = 45 * 60_000
const MIN_BUDGET = 120_000
const TERM_GRACE = 10_000

type Request = {
  runId: string
  scenario: { id: string; lane: string; requires?: string[]; timeoutMs?: number }
  descriptorPath?: string
}

function parse(argv: string[]) {
  const values: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg !== "--request" && arg !== "--result") throw new Error(`unknown argument: ${arg}`)
    const value = argv[++i]
    if (!value) throw new Error(`missing value for ${arg}`)
    values[arg.slice(2)] = value
  }
  return values
}

function fail(message: string): never {
  console.error(`[jetbrains-e2e] ${message}`)
  process.exit(2)
}

function readRequest(path: string): Request {
  return JSON.parse(readFileSync(path, "utf8")) as Request
}

function redact(input: string, request: Request) {
  let text = input
  if (request.descriptorPath && existsSync(request.descriptorPath)) {
    try {
      const descriptor = JSON.parse(readFileSync(request.descriptorPath, "utf8")) as {
        credentials?: { apiKey?: string; orgId?: string }
        cleanup?: { token?: string }
      }
      for (const secret of [descriptor.credentials?.apiKey, descriptor.credentials?.orgId, descriptor.cleanup?.token]) {
        if (secret) text = text.split(secret).join("[redacted]")
      }
    } catch {
      // The descriptor is optional for a fallback result; never fail while reporting a failure.
    }
  }
  return text
}

function writeFallback(request: Request, resultPath: string, output: string, name = "driver.exit") {
  const now = new Date().toISOString()
  const tail = redact(output.trim(), request).slice(-1200)
  const result = {
    schemaVersion: 1,
    runId: request.runId,
    scenarioId: request.scenario.id,
    lane: request.scenario.lane,
    driver: { id: "jetbrains-starter", version: "1" },
    ide: { name: "unknown", version: "unknown" },
    provenance: { clientHash: null, cliHash: null },
    // Echo the scenario requirements on a synthetic failure: K1 checks capabilities before
    // outcome, so an empty list would replace the driver.exit/driver.timeout diagnostic with a
    // capability error.
    capabilities: request.scenario.requires ?? [],
    outcome: "failed",
    startedAt: now,
    endedAt: new Date().toISOString(),
    assertions: [{ name, status: "failed", detail: tail || "uiTest failed without output" }],
    lastState: {},
    artifacts: { logs: [], screenshots: [], snapshots: [] },
  }
  mkdirSync(dirname(resultPath), { recursive: true })
  writeFileSync(resultPath, JSON.stringify(result))
  console.error(`[jetbrains-e2e] wrote failed driver result for ${request.runId}`)
}

function children(pid: number): number[] {
  const result = Bun.spawnSync(["pgrep", "-P", String(pid)], { stdout: "pipe", stderr: "ignore" })
  if (result.exitCode !== 0) return []
  return new TextDecoder()
    .decode(result.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
}

function killTree(pid: number, signal: "SIGTERM" | "SIGKILL" = "SIGTERM") {
  if (process.platform === "win32") {
    // Windows has no process groups here; /T kills the whole tree and /F is required for the
    // forked JVMs. Signal escalation is unnecessary because taskkill is already forceful.
    Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" })
    return
  }
  for (const child of children(pid)) killTree(child, signal)
  try {
    process.kill(pid, signal)
  } catch {
    // The process may already be gone; killing the rest of the tree is still useful.
  }
}

let args: Record<string, string>
try {
  args = parse(Bun.argv.slice(2))
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

const request = args.request
const result = args.result
if (!request || !result) fail("usage: bun script/e2e-driver.ts --request <path> --result <path>")
if (!existsSync(request)) fail(`request file does not exist: ${request}`)
if (!existsSync(dirname(result))) fail(`result directory does not exist: ${dirname(result)}`)

const payload = readRequest(request)
rmSync(result, { force: true })

// K1 maps the fixture bearer to KILO_API_KEY, but the JetBrains Cloud workspace surface gates on
// the CLI profile, and the CLI profile endpoint accepts OAuth access tokens (not API keys). The C1
// fixture bearer is a valid `/api/profile` bearer, so present it in the OAuth shape the fixture
// needs. The secret never goes on argv.
const env: Record<string, string | undefined> = { ...process.env }
if (payload.descriptorPath && existsSync(payload.descriptorPath)) {
  try {
    const descriptor = JSON.parse(readFileSync(payload.descriptorPath, "utf8")) as {
      credentials?: { apiKey?: string }
    }
    const key = descriptor.credentials?.apiKey
    if (key) {
      env.KILO_AUTH_CONTENT = JSON.stringify({
        kilo: { type: "oauth", access: key, refresh: "kilo-e2e-fixture", expires: Date.now() + 3_600_000 },
      })
    }
  } catch {
    // Leave the inherited auth environment untouched when the descriptor is unreadable.
  }
}

const command = [
  gradlew,
  "uiTest",
  "--no-daemon",
  "--no-configuration-cache",
  "--console=plain",
  "-Pkilo.e2e=true",
  "-Pkilo.cli.pinned=false",
  `-Pkilo.e2e.request=${request}`,
  `-Pkilo.e2e.result=${result}`,
]

const override = Number(process.env.KILO_E2E_DRIVER_TIMEOUT_MS)
const budget =
  Number.isFinite(override) && override > 0
    ? override
    : Math.max(MIN_BUDGET, (payload.scenario.timeoutMs ?? DEFAULT_BUDGET) - 60_000)

const child = Bun.spawn(command, {
  cwd: root,
  env,
  stdout: "pipe",
  stderr: "pipe",
})
let output = ""
let finished = false
let timedOut = false

async function pump(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    output += text
    process.stdout.write(text)
  }
}

const pumps = [pump(child.stdout), pump(child.stderr)]

const timer = setTimeout(() => {
  if (finished) return
  timedOut = true
  console.error(`[jetbrains-e2e] uiTest exceeded ${budget}ms; terminating the Gradle/IDE process tree`)
  killTree(child.pid)
  setTimeout(() => killTree(child.pid, "SIGKILL"), TERM_GRACE)
}, budget)

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    killTree(child.pid, signal === "SIGINT" ? "SIGKILL" : "SIGTERM")
    process.exit(1)
  })
}

const code = await child.exited
clearTimeout(timer)
await Promise.allSettled(pumps)
finished = true

if (code !== 0) {
  if (!existsSync(result)) writeFallback(payload, result, output, timedOut ? "driver.timeout" : "driver.exit")
  else console.error(`[jetbrains-e2e] uiTest exited with code ${code}; using the driver result`)
}

process.exit(0)
