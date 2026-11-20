#!/usr/bin/env bun

/**
 * JetBrains split-mode e2e for Advanced > Privacy > Send usage data.
 *
 * Usage:
 *   bun script/e2e-settings.ts
 *
 * Uses the K1 fake provider and the headful Starter/Driver adapter. The driver toggles telemetry
 * off, verifies the write lands in the CLI's global config, and reopens settings to confirm the
 * value is read back. Screenshots and the component snapshot land under build/e2e/<runId>/.
 */

import { manifest, run, RunError } from "../../kilo-e2e/src/index"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const artifactsDir = join(root, "build", "e2e")
const runId = `jetbrains-settings-${Date.now()}`

const git = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" })
const kiloCommit = git.exitCode === 0 ? new TextDecoder().decode(git.stdout).trim() : null

try {
  const report = await run({
    manifest: { ...manifest("settings.telemetry", "local"), timeoutMs: 45 * 60_000 },
    provider: {
      id: "kilo-e2e-fake",
      command: [process.execPath, join(root, "../kilo-e2e/fixtures/provider.ts")],
    },
    driver: {
      id: "jetbrains-starter",
      command: [process.execPath, join(root, "script/e2e-driver.ts")],
    },
    artifactsDir,
    runId,
    provenance: { kiloCommit },
    timeouts: { driver: 45 * 60_000 },
  })
  console.log(`[jetbrains-e2e] settings passed: ${join(artifactsDir, runId, "evidence.json")}`)
  console.log(JSON.stringify({ outcome: report.outcome, assertions: report.assertions.length }))
} catch (error) {
  const evidence = error instanceof RunError ? error.evidencePath : undefined
  console.error(`[jetbrains-e2e] settings failed: ${error instanceof Error ? error.message : String(error)}`)
  if (evidence) console.error(`[jetbrains-e2e] evidence: ${evidence}`)
  process.exit(1)
}
