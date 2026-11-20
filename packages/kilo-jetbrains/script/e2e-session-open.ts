#!/usr/bin/env bun

/**
 * Run a K1 scenario for the JetBrains local and/or Cloud lane.
 *
 * Usage:
 *   KILO_E2E_CLOUD_REPO=../cloud bun script/e2e-session-open.ts --lane both
 *   bun script/e2e-session-open.ts --scenario prompt.stream --lane both --cloud-repo ../cloud
 *   bun script/e2e-session-open.ts --scenario prompt.stream --lane cloud --cloud-repo ../cloud --git-url https://github.com/octocat/Hello-World.git
 *
 * The Cloud local stack must already be running. This script uses the C1 fixture
 * provider, which is also the provider that creates the hosted workspace and stored
 * transcript for the cloud lane.
 *
 * For the headless cloud-agent/Linux runner, use script/e2e-headless.ts.
 */

import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { RunError, SCENARIO_IDS, type Lane, type ScenarioID } from "../../kilo-e2e/src/index"
import { runCell } from "./e2e-cell"

const root = resolve(import.meta.dir, "..")
const args = parse(Bun.argv.slice(2))
const cloud = resolve(args["cloud-repo"] ?? process.env.KILO_E2E_CLOUD_REPO ?? "../cloud")
const providerPath = join(cloud, "services/cloud-agent-next/test/e2e/fixture-provider.ts")
const artifactsDir = join(root, "build", "e2e")
// K1 prepare/cleanup forward the parent process environment to the provider, not run({ env }).
// Set it here so --git-url actually reaches the C1 fixture provider.
const gitUrl = args["git-url"] ?? process.env.E2E_GIT_URL
if (gitUrl) process.env.E2E_GIT_URL = gitUrl

if (!existsSync(providerPath)) {
  console.error(`[jetbrains-e2e] C1 fixture provider not found at ${providerPath}`)
  console.error(`[jetbrains-e2e] set --cloud-repo or KILO_E2E_CLOUD_REPO to the Kilo-Org/cloud checkout`)
  process.exit(2)
}

const scenarioArg = args.scenario ?? "session.open"
if (!(SCENARIO_IDS as readonly string[]).includes(scenarioArg)) {
  console.error(`[jetbrains-e2e] unknown scenario: ${scenarioArg} (expected ${SCENARIO_IDS.join(", ")})`)
  process.exit(2)
}
const scenario = scenarioArg as ScenarioID

const laneArg = args.lane
if (laneArg && laneArg !== "both" && laneArg !== "local" && laneArg !== "cloud") {
  console.error(`[jetbrains-e2e] unknown lane: ${laneArg}`)
  process.exit(2)
}
const lanes: Lane[] = !laneArg || laneArg === "both" ? ["local", "cloud"] : [laneArg]
const git = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" })
const kiloCommit = git.exitCode === 0 ? new TextDecoder().decode(git.stdout).trim() : null

let failed = false
for (const lane of lanes) {
  const runId = `jetbrains-${scenario.replaceAll(".", "-")}-${lane}-${Date.now()}`
  try {
    const report = await runCell({
      root,
      cloud,
      artifactsDir,
      runId,
      scenario,
      lane,
      kiloCommit,
    })
    console.log(`[jetbrains-e2e] ${lane} ${scenario} ${report.outcome}: ${join(artifactsDir, runId, "evidence.json")}`)
    if (report.outcome !== "passed") failed = true
  } catch (error) {
    failed = true
    const evidence = error instanceof RunError ? error.evidencePath : undefined
    console.error(
      `[jetbrains-e2e] ${lane} ${scenario} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    if (evidence) console.error(`[jetbrains-e2e] ${lane} evidence: ${evidence}`)
  }
}

process.exit(failed ? 1 : 0)

function parse(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`)
    const value = argv[++i]
    if (!value) throw new Error(`missing value for ${arg}`)
    values[arg.slice(2)] = value
  }
  return values
}
