#!/usr/bin/env bun

/**
 * JetBrains split-mode smoke run through the K1 coordinator.
 *
 * Usage:
 *   bun script/e2e-smoke.ts
 *
 * This uses the K1 fake provider (fixture lifecycle, descriptor, cleanup) and the
 * headful Starter/Driver adapter. It is intentionally not wired into `check`/`test`.
 */

import { SCHEMA_VERSION, run, RunError, type ScenarioManifest } from "../../kilo-e2e/src/index"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const artifactsDir = join(root, "build", "e2e")
const runId = `jetbrains-smoke-${Date.now()}`

const git = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" })
const kiloCommit = git.exitCode === 0 ? new TextDecoder().decode(git.stdout).trim() : null

const manifest: ScenarioManifest = {
  schemaVersion: SCHEMA_VERSION,
  id: "session.open",
  lane: "local",
  prompt: { directive: "open", token: "K1-JETBRAINS-SMOKE" },
  expected: {
    ui: ["kilo.tool-window.visible", "kilo.agent-manager.visible"],
    model: ["ide.split-mode", "ide.edt", "cli.ready", "plugin.both-classloaders"],
    terminalTranscriptToken: "K1-JETBRAINS-SMOKE",
  },
  requires: [],
  timeoutMs: 45 * 60_000,
}

try {
  const report = await run({
    manifest,
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
  console.log(`[jetbrains-e2e] smoke passed: ${join(artifactsDir, runId, "evidence.json")}`)
  console.log(JSON.stringify({ outcome: report.outcome, assertions: report.assertions.length }))
} catch (error) {
  const evidence = error instanceof RunError ? error.evidencePath : undefined
  console.error(`[jetbrains-e2e] smoke failed: ${error instanceof Error ? error.message : String(error)}`)
  if (evidence) console.error(`[jetbrains-e2e] evidence: ${evidence}`)
  process.exit(1)
}
