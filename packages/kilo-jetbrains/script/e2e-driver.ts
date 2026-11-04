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
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew"

type Request = {
  runId: string
  scenario: { id: string; lane: string; requires?: string[] }
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

function writeFallback(request: Request, resultPath: string, output: string) {
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
    capabilities: request.scenario.requires ?? [],
    outcome: "failed",
    startedAt: now,
    endedAt: new Date().toISOString(),
    assertions: [{ name: "driver.exit", status: "failed", detail: tail || "uiTest failed without output" }],
    lastState: {},
    artifacts: { logs: [], screenshots: [], snapshots: [] },
  }
  mkdirSync(dirname(resultPath), { recursive: true })
  writeFileSync(resultPath, JSON.stringify(result))
  console.error(`[jetbrains-e2e] wrote failed driver result for ${request.runId}`)
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

const child = Bun.spawnSync(command, {
  cwd: root,
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
})
const output = `${new TextDecoder().decode(child.stdout)}${new TextDecoder().decode(child.stderr)}`
process.stdout.write(output)

if (child.exitCode !== 0) {
  if (!existsSync(result)) writeFallback(payload, result, output)
  else console.error(`[jetbrains-e2e] uiTest exited with code ${child.exitCode}; using the driver result`)
  process.exit(0)
}

process.exit(0)
