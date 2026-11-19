#!/usr/bin/env bun

/**
 * Headless JetBrains local/Cloud `session.open` runner.
 *
 * Works in the cloud-agent macOS environment with its virtual display and on Linux with an
 * owned Xvfb display. It preflights the environment, reuses or starts the local Cloud stack,
 * runs the existing K1/C1/J1/J2 matrix, and writes a per-run summary plus the K1 evidence.
 *
 * Run `bun script/e2e-headless.ts --help` for usage, examples, and exit codes.
 */

import { spawnSync } from "node:child_process"
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { watch } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
  claimDir,
  DirExistsError,
  ensureDir,
  EvidenceReport,
  RunError,
  type Lane,
  type ScenarioID,
} from "../../kilo-e2e/src/index"
import { cellRunId, runCell } from "./e2e-cell"
import {
  UsageError,
  downServices,
  failureHint,
  parseArgs,
  parseJavaMajor,
  parseStackStatus,
  providerLogName,
  renderSummary,
  resolveEnvironment,
  usage,
  type CellResult,
  type Options,
  type StackStatus,
} from "./e2e-headless-lib"

const EXIT = { passed: 0, failed: 1, preflight: 2, cancelled: 130 } as const
const root = resolve(import.meta.dir, "..")
const defaults = { artifacts: join(root, "build", "e2e") }
const STACK_GROUP = "cloud-agent"
const STACK_START_TIMEOUT = 30 * 60_000
const STACK_STOP_TIMEOUT = 5 * 60_000
const STACK_STATUS_TIMEOUT = 5 * 60_000

class SetupError extends Error {}

type Problem = { message: string; fix: string }

type CommandExit = { code: number | null; timedOut: boolean }

type CommandCapture = CommandExit & { stdout: string; stderr: string }

type Proc = ReturnType<typeof Bun.spawn>

type DisplayHandle = {
  label: string
  stop: () => Promise<void>
}

class Stack {
  label = "not started"
  owned = false

  constructor(private readonly cloud: string | undefined) {}

  async stop(): Promise<{ ok: boolean; message: string }> {
    if (!this.owned || !this.cloud) return { ok: true, message: "not started by this run" }
    console.log("[headless] stopping the local Cloud stack this run started")
    const exit = await runInherit(["pnpm", "-s", "dev:stop"], this.cloud, STACK_STOP_TIMEOUT)
    if (exit.timedOut) return { ok: false, message: "command timed out" }
    if (exit.code !== 0) return { ok: false, message: `command exited ${exit.code}` }
    return { ok: true, message: "stopped" }
  }
}

async function main(): Promise<number> {
  let options: Options
  try {
    options = parseArgs(Bun.argv.slice(2), defaults)
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`[headless] ${error.message}`)
      console.error(usage(defaults))
      return EXIT.preflight
    }
    throw error
  }
  if (options.help) {
    console.log(usage(defaults))
    return EXIT.passed
  }
  options = resolveEnvironment(options, process.env)
  if (options.gitUrl) process.env.E2E_GIT_URL = options.gitUrl

  const problems = preflight(options)
  if (problems.length > 0) {
    console.error("[headless] preflight failed:")
    for (const problem of problems) console.error(`- ${problem.message}\n  Fix: ${problem.fix}`)
    return EXIT.preflight
  }

  const runId = options.runId ?? `jetbrains-headless-${Date.now()}`
  const runRoot = join(options.artifacts, runId)
  try {
    await ensureDir(options.artifacts)
    await claimDir(runRoot)
  } catch (error) {
    if (error instanceof DirExistsError) console.error(`[headless] run directory already exists: ${runRoot}`)
    else console.error(`[headless] could not create run directory ${runRoot}: ${message(error)}`)
    return EXIT.preflight
  }

  const startedAt = new Date().toISOString()
  const kiloCommit = gitCommit(root)
  const cloudCommit = options.cloud ? gitCommit(options.cloud) : null
  const cells: CellResult[] = []
  const controller = new AbortController()
  const abort = () => {
    if (controller.signal.aborted) return
    console.error("[headless] cancellation requested; aborting the active cell and cleaning up")
    controller.abort()
  }
  process.on("SIGINT", abort)
  process.on("SIGTERM", abort)

  let display: DisplayHandle | undefined
  let stack: Stack | undefined
  let setupError: Error | undefined
  let cleanup = "not required"
  let cleanupFailed = false
  let cancelled = false
  let exitCode: number = EXIT.passed

  try {
    display = await startDisplay(options)
    console.log(`[headless] display: ${display.label}`)

    stack = new Stack(options.cloud)
    await ensureStack(options, stack, controller.signal)
    console.log(`[headless] cloud stack: ${stack.label}`)

    for (const scenario of options.scenarios) {
      for (const lane of options.lanes) {
        if (controller.signal.aborted) {
          cancelled = true
          break
        }
        const cell = await runOne(options, runRoot, runId, scenario, lane, kiloCommit, cloudCommit, controller.signal)
        cells.push(cell)
        printCell(cell, runRoot)
        if (cell.outcome === "cancelled") cancelled = true
      }
      if (cancelled) break
    }
  } catch (error) {
    if (controller.signal.aborted) cancelled = true
    setupError = error instanceof SetupError ? error : new SetupError(message(error))
    console.error(`[headless] setup failed: ${setupError.message}`)
  } finally {
    const notes: string[] = []
    if (display) {
      try {
        await display.stop()
        notes.push("display stopped")
      } catch (error) {
        notes.push(`display cleanup failed: ${message(error)}`)
        cleanupFailed = true
      }
    }
    if (stack) {
      if (!stack.owned) {
        notes.push(stack.label === "reused a running local stack" ? "reused Cloud stack left running" : stack.label)
      } else if (options.keepStack) {
        notes.push("owned Cloud stack kept (--keep-stack)")
      } else {
        try {
          const stopped = await stack.stop()
          if (stopped.ok) notes.push(`owned Cloud stack ${stopped.message}`)
          else {
            notes.push(`owned Cloud stack cleanup failed: ${stopped.message}`)
            cleanupFailed = true
          }
        } catch (error) {
          notes.push(`owned Cloud stack cleanup failed: ${message(error)}`)
          cleanupFailed = true
        }
      }
    }
    cleanup = notes.length > 0 ? notes.join("; ") : "not required"

    if (cancelled) exitCode = EXIT.cancelled
    else if (setupError) exitCode = EXIT.preflight
    else if (cleanupFailed || cells.some((cell) => cell.outcome !== "passed" && cell.outcome !== "cancelled"))
      exitCode = EXIT.failed

    const summaryPath = join(runRoot, "summary.md")
    const summary = renderSummary({
      runId,
      startedAt,
      endedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      display: display?.label ?? "not started",
      stack: stack?.label ?? "not started",
      cleanup,
      kiloCommit,
      cloudCommit,
      cells,
      exitCode,
    })
    writeFileSync(summaryPath, summary, { mode: 0o600 })
    console.log(`[headless] summary: ${summaryPath}`)
    if (setupError) console.error(`[headless] ${setupError.message}`)
    console.log(`[headless] exit ${exitCode}`)
  }

  process.off("SIGINT", abort)
  process.off("SIGTERM", abort)
  return exitCode
}

async function runOne(
  options: Options,
  runRoot: string,
  baseRunId: string,
  scenario: ScenarioID,
  lane: Lane,
  kiloCommit: string | null,
  cloudCommit: string | null,
  signal: AbortSignal,
): Promise<CellResult> {
  const runId = cellRunId(baseRunId, scenario, lane)
  try {
    const evidence = await runCell({
      root,
      cloud: options.cloud ?? "",
      artifactsDir: runRoot,
      runId,
      scenario,
      lane,
      kiloCommit,
      cloudCommit,
      signal,
    })
    return cellResult(evidence)
  } catch (error) {
    const failure =
      error instanceof RunError
        ? { code: error.code, message: error.message }
        : { code: "driver_result", message: message(error) }
    const evidencePath = error instanceof RunError ? error.evidencePath : undefined
    const evidence = evidencePath ? readEvidence(evidencePath) : undefined
    const providerLog = providerTail(evidencePath, failure.code)
    if (evidence) {
      const result = cellResult(evidence)
      return { ...result, failure: result.failure ?? failure, providerLog }
    }
    return {
      scenario,
      lane,
      runId,
      outcome: failure.code === "cancelled" ? "cancelled" : "failed",
      evidence: null,
      failure,
      providerLog,
      failed: [],
      passed: 0,
    }
  }
}

function cellResult(evidence: EvidenceReport): CellResult {
  const failed = evidence.assertions
    .filter((assertion) => assertion.status === "failed")
    .map((assertion) => ({ name: assertion.name, detail: assertion.detail }))
  return {
    scenario: evidence.scenarioId,
    lane: evidence.lane,
    runId: evidence.runId,
    outcome: evidence.outcome,
    evidence: join(evidence.runId, "evidence.json"),
    failure: evidence.failure,
    failed,
    passed: evidence.assertions.filter((assertion) => assertion.status === "passed").length,
    cleanup: {
      status: evidence.cleanup.status,
      removed: evidence.cleanup.removed.length,
      leftovers: evidence.cleanup.leftovers.length,
    },
  }
}

function readEvidence(path: string): EvidenceReport | undefined {
  try {
    const parsed = EvidenceReport.safeParse(JSON.parse(readFileSync(path, "utf8")))
    if (!parsed.success) {
      console.error(`[headless] evidence at ${path} does not match the K1 schema`)
      return undefined
    }
    return parsed.data
  } catch (error) {
    console.error(`[headless] could not read evidence at ${path}: ${message(error)}`)
    return undefined
  }
}

function printCell(cell: CellResult, runRoot: string) {
  const evidence = cell.evidence ? join(runRoot, cell.evidence) : "no evidence"
  const failed = cell.failed.length > 0 ? ` (${cell.failed.map((item) => item.name).join(", ")})` : ""
  console.log(`[headless] ${cell.scenario}/${cell.lane}: ${cell.outcome}${failed} -> ${evidence}`)
  if (cell.failure) console.error(`[headless] hint: ${failureHint(cell.failure.code)}`)
  if (cell.providerLog) console.error(`[headless] provider output (tail):\n${cell.providerLog}`)
}

function providerTail(evidencePath: string | undefined, code: string): string | undefined {
  if (!evidencePath) return undefined
  const log = join(dirname(evidencePath), providerLogName(code))
  if (!existsSync(log)) return undefined
  try {
    return readFileSync(log, "utf8").split(/\r?\n/).slice(-30).join("\n").slice(-6000)
  } catch (error) {
    console.error(`[headless] could not read provider log ${log}: ${message(error)}`)
    return undefined
  }
}

async function ensureStack(options: Options, stack: Stack, signal: AbortSignal): Promise<void> {
  const cloud = options.cloud
  if (!cloud) throw new SetupError("Cloud checkout is not configured")
  const status = await readStackStatus(cloud, signal)
  const down = downServices(status)
  if (down.length === 0) {
    stack.label = "reused a running local stack"
    return
  }
  if (options.stack === "reuse") {
    throw new SetupError(
      `local Cloud stack is not ready (down: ${down.join(", ")}); start it with ` +
        `\`pnpm dev:start ${STACK_GROUP} --no-attach\` in ${cloud}`,
    )
  }
  console.log(`[headless] starting local Cloud stack (down: ${down.join(", ")})`)
  stack.label = "starting"
  stack.owned = true
  const exit = await runInherit(
    ["pnpm", "-s", "dev:start", STACK_GROUP, "--no-attach"],
    cloud,
    STACK_START_TIMEOUT,
    signal,
  )
  if (exit.timedOut) throw new SetupError("pnpm dev:start timed out; stopping the stack this run started")
  if (exit.code !== 0) throw new SetupError(`pnpm dev:start exited ${exit.code}; see the output above`)
  const after = await readStackStatus(cloud, signal)
  const missing = downServices(after)
  if (missing.length > 0) {
    throw new SetupError(`local Cloud stack is still not ready after start (down: ${missing.join(", ")})`)
  }
  stack.label = "started by this run"
}

async function readStackStatus(cloud: string, signal: AbortSignal): Promise<StackStatus> {
  const result = await capture(["pnpm", "-s", "dev:status", "--json"], cloud, STACK_STATUS_TIMEOUT, signal)
  if (result.timedOut) throw new SetupError("pnpm dev:status timed out")
  const status = parseStackStatus(result.stdout)
  if (!status) {
    throw new SetupError(
      `could not read the local Cloud stack status; run \`pnpm dev:status --json\` in ${cloud}` +
        tail(result.stdout, result.stderr),
    )
  }
  return status
}

function preflight(options: Options): Problem[] {
  const problems: Problem[] = []
  const platform = `${process.platform}-${process.arch}`

  if (process.platform !== "darwin" && process.platform !== "linux") {
    problems.push({
      message: `unsupported platform ${platform}`,
      fix: "Run on cloud-agent macOS or Linux under Xvfb.",
    })
  }

  for (const command of ["bun", "node", "pnpm", "git"]) {
    if (!Bun.which(command)) problems.push({ message: `${command} is not on PATH`, fix: `Install ${command}.` })
  }

  const gradlew = join(root, process.platform === "win32" ? "gradlew.bat" : "gradlew")
  if (!existsSync(gradlew)) {
    problems.push({ message: `Gradle wrapper is missing at ${gradlew}`, fix: "Run from a full kilocode checkout." })
  } else if (process.platform !== "win32") {
    try {
      accessSync(gradlew, constants.X_OK)
    } catch {
      problems.push({ message: `Gradle wrapper is not executable: ${gradlew}`, fix: `chmod +x ${gradlew}` })
    }
  }

  {
    const java = runSync("java", ["-version"])
    if (java.code !== 0) {
      problems.push({ message: "Java is not runnable", fix: "Install Java 21 and set JAVA_HOME." })
    } else {
      const major = parseJavaMajor(java.output)
      if (major === undefined) {
        problems.push({
          message: "could not determine the Java version",
          fix: "Install Temurin/Corretto Java 21 and set JAVA_HOME.",
        })
      } else if (major < 21) {
        problems.push({
          message: `Java ${major} is too old`,
          fix: "Install Java 21 (for example with SDKMAN: sdk install java 21-tem).",
        })
      }
    }
  }

  const opencode = join(root, "..", "opencode")
  if (!existsSync(join(opencode, "script", "build.ts")) || !existsSync(join(opencode, "package.json"))) {
    problems.push({
      message: "local CLI sources are missing under packages/opencode",
      fix: "Run from a full kilocode checkout so :backend:buildRepoCli can build the local CLI.",
    })
  }

  checkDisplay(options, problems)
  checkCloud(options, problems)
  return problems
}

function checkDisplay(options: Options, problems: Problem[]) {
  if (options.display === "xvfb" && process.platform !== "linux") {
    problems.push({ message: "--display xvfb is only supported on Linux", fix: "Use --display auto or system." })
    return
  }
  if (process.platform === "darwin") {
    const result = runSync("pgrep", ["-x", "WindowServer"])
    if (result.code !== 0) {
      problems.push({
        message: "no macOS WindowServer/virtual display was detected",
        fix: "Run in the cloud-agent environment with its virtual display, or start a GUI session.",
      })
    }
    return
  }
  if (options.display === "system") {
    if (!process.env.DISPLAY) {
      problems.push({ message: "--display system requires DISPLAY", fix: "Set DISPLAY or use --display xvfb." })
    }
    return
  }
  if (!Bun.which("Xvfb")) {
    problems.push({
      message: "Xvfb is not installed",
      fix: "Install Xvfb (for example apt-get install xvfb) or pass --display system with a live DISPLAY.",
    })
  }
}

function checkCloud(options: Options, problems: Problem[]) {
  const cloud = options.cloud
  if (!cloud) {
    problems.push({
      message: "Cloud checkout is not configured",
      fix: "Pass --cloud-repo <path> or set KILO_E2E_CLOUD_REPO.",
    })
    return
  }
  if (!existsSync(cloud)) {
    problems.push({ message: `Cloud checkout does not exist: ${cloud}`, fix: "Clone Kilo-Org/cloud and retry." })
    return
  }
  const provider = join(cloud, "services", "cloud-agent-next", "test", "e2e", "fixture-provider.ts")
  if (!existsSync(provider)) {
    problems.push({
      message: `C1 fixture provider is missing at ${provider}`,
      fix: "Point --cloud-repo at a current Kilo-Org/cloud checkout.",
    })
  }
  if (!existsSync(join(cloud, "node_modules"))) {
    problems.push({ message: `Cloud dependencies are not installed in ${cloud}`, fix: "Run pnpm install in the Cloud checkout." })
  }
  const env = readEnvFile(join(cloud, ".env.local")) ?? readEnvFile(join(cloud, ".env"))
  if (!env?.POSTGRES_URL && !env?.DATABASE_URL) {
    problems.push({
      message: "the Cloud local stack database URL is missing from .env.local",
      fix: "Run pnpm dev:worktree:prepare and pnpm dev:env in the Cloud checkout.",
    })
  }
  const devVars = readEnvFile(join(cloud, "services", "cloud-agent-next", ".dev.vars"))
  if (!devVars?.NEXTAUTH_SECRET) {
    problems.push({
      message: "cloud-agent-next/.dev.vars does not define NEXTAUTH_SECRET",
      fix: "Run pnpm dev:env in the Cloud checkout.",
    })
  }
  if (!Bun.which("tmux")) {
    problems.push({ message: "tmux is not on PATH", fix: "Install tmux; the Cloud dev stack runs its services in tmux." })
  }
  const docker = runSync("docker", ["info", "--format", "{{.ServerVersion}}"])
  if (docker.code !== 0) {
    problems.push({
      message: "Docker is not reachable",
      fix: "Start Docker Desktop (macOS) or the Docker daemon (Linux).",
    })
  }
}

function readEnvFile(path: string): Record<string, string> | undefined {
  if (!existsSync(path)) return undefined
  const values: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index < 0) continue
    values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "")
  }
  return values
}

async function startDisplay(options: Options): Promise<DisplayHandle> {
  if (process.platform === "darwin") {
    return { label: "macOS WindowServer (virtual display)", stop: async () => undefined }
  }
  if (process.platform !== "linux") throw new SetupError(`unsupported platform ${process.platform}`)
  if (options.display === "system") {
    const display = process.env.DISPLAY
    if (!display) throw new SetupError("--display system requires DISPLAY to be set")
    return { label: `inherited DISPLAY ${display}`, stop: async () => undefined }
  }

  const bin = Bun.which("Xvfb")
  if (!bin) throw new SetupError("Xvfb is not installed")
  const socketDir = "/tmp/.X11-unix"
  mkdirSync(socketDir, { recursive: true, mode: 0o1777 })
  const number = freeDisplay(socketDir)
  const socket = join(socketDir, `X${number}`)
  const proc = Bun.spawn([bin, `:${number}`, "-screen", "0", "1920x1080x24", "-nolisten", "tcp"], {
    stdout: "ignore",
    stderr: "pipe",
  })
  const stderr = new Response(proc.stderr).text()
  try {
    await waitForPath(socket, 15_000, proc.exited)
  } catch (error) {
    proc.kill(9)
    await proc.exited
    const detail = await stderr
    throw new SetupError(`could not start Xvfb :${number}: ${message(error)}${tail(detail)}`)
  }
  process.env.DISPLAY = `:${number}`
  return { label: `owned Xvfb :${number}`, stop: () => stopProcess(proc) }
}

function freeDisplay(socketDir: string): number {
  for (let number = 99; number < 200; number++) {
    if (!existsSync(join(socketDir, `X${number}`)) && !existsSync(`/tmp/.X${number}-lock`)) return number
  }
  throw new SetupError("no free X display number between 99 and 199")
}

function waitForPath(path: string, timeoutMs: number, exited: Promise<number>): Promise<void> {
  if (existsSync(path)) return Promise.resolve()
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  let settled = false
  function finish(error?: Error) {
    if (settled) return
    settled = true
    clearTimeout(timer)
    watcher.close()
    if (error) reject(error)
    else resolve()
  }
  const watcher = watch(dirname(path), () => {
    if (existsSync(path)) finish()
  })
  const timer = setTimeout(() => finish(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
  void exited.then(() => finish(new Error("Xvfb exited before creating its socket")))
  return promise
}

async function stopProcess(proc: Proc): Promise<void> {
  if (proc.exitCode !== null) return
  proc.kill("SIGTERM")
  const timer = setTimeout(() => {
    if (proc.exitCode === null) proc.kill(9)
  }, 5_000)
  await proc.exited
  clearTimeout(timer)
}

async function runInherit(
  command: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandExit> {
  if (signal?.aborted) return { code: null, timedOut: false }
  const proc = Bun.spawn(command, { cwd, env: process.env, stdout: "inherit", stderr: "inherit" })
  let force: ReturnType<typeof setTimeout> | undefined
  const terminate = () => {
    if (force) return
    proc.kill()
    force = setTimeout(() => {
      if (proc.exitCode === null) proc.kill(9)
    }, 5_000)
  }
  const onAbort = () => terminate()
  signal?.addEventListener("abort", onAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    if (proc.exitCode !== null) return
    timedOut = true
    console.error(`[headless] command timed out after ${timeoutMs}ms: ${command.join(" ")}`)
    terminate()
  }, timeoutMs)
  const code = await proc.exited
  clearTimeout(timer)
  if (force) clearTimeout(force)
  signal?.removeEventListener("abort", onAbort)
  return { code, timedOut }
}

async function capture(
  command: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandCapture> {
  if (signal?.aborted) return { code: null, timedOut: false, stdout: "", stderr: "" }
  const proc = Bun.spawn(command, { cwd, env: process.env, stdout: "pipe", stderr: "pipe" })
  const stdout = new Response(proc.stdout).text()
  const stderr = new Response(proc.stderr).text()
  let force: ReturnType<typeof setTimeout> | undefined
  const terminate = () => {
    if (force) return
    proc.kill()
    force = setTimeout(() => {
      if (proc.exitCode === null) proc.kill(9)
    }, 5_000)
  }
  const onAbort = () => terminate()
  signal?.addEventListener("abort", onAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    if (proc.exitCode !== null) return
    timedOut = true
    terminate()
  }, timeoutMs)
  const code = await proc.exited
  clearTimeout(timer)
  if (force) clearTimeout(force)
  signal?.removeEventListener("abort", onAbort)
  return { code, timedOut, stdout: await stdout, stderr: await stderr }
}

function runSync(command: string, args: string[]): { code: number | null; output: string } {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 15_000 })
  const text = (value: string | Buffer | null) => (value == null ? "" : value.toString())
  return { code: result.status, output: `${text(result.stdout)}${text(result.stderr)}` }
}

function gitCommit(dir: string): string | null {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8", timeout: 10_000 })
  if (result.status !== 0) return null
  const value = result.stdout.trim()
  return value.length > 0 ? value : null
}

function tail(stdout: string, stderr = ""): string {
  const text = `${stdout}\n${stderr}`.trim()
  if (text.length === 0) return ""
  return `\n${text.split(/\r?\n/).slice(-10).join("\n")}`
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

if (import.meta.main) process.exit(await main())
