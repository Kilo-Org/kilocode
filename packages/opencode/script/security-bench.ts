// kilocode_change - new file
//
// Security Auto Mode benchmark runner.
//
// Runs the same scripted coding-agent trajectories in the baseline (Security Auto OFF) and protected
// (Security Auto ON) configurations, in a disposable sandbox under the OS temp dir, and reports the
// measured Attack Success Rate, utility, friction, and security-decision latency.
//
// Isolation env is set BEFORE any Kilo import (Global reads XDG/KILO_TEST_HOME at import time), exactly
// like test/preload.ts. Destructive scenarios execute for real, but only inside the sandbox.
//
// Usage: bun run script/security-bench.ts [--runs N] [--scenario <id|prefix*|a,b,c>] [--out <dir>]
//        [--configs baseline,deterministic-security,package-security] [--tag <label>]
//
// The configurations form an ablation ladder (each adds one layer to the previous one); `--configs`
// selects a subset, e.g. the first three rungs of the ladder.

import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { randomUUID } from "node:crypto"

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback
}

const runsPerCase = Math.max(1, Number(arg("runs", "3")) || 3)
const scenarioFilter = arg("scenario")
const configsArg = arg("configs")
const tag = arg("tag")

/**
 * Running the ladder against a real model.
 *
 *   --classifier-model openrouter/anthropic/claude-haiku-4.5
 *
 * The credential needs care. This benchmark executes attacker-written commands for real, so the rule
 * that no real provider key may be visible to a scenario shell is not negotiable. The key is
 * therefore lifted out of the environment *before* the scrub below and handed to Kilo through its own
 * auth store inside the disposable sandbox — the mechanism Kilo already uses for provider
 * credentials. `process.env` never carries it past this point, so nothing a scenario runs can read
 * it, and the store is deleted with the sandbox.
 */
const classifierModel = arg("classifier-model")
const providerID = classifierModel?.split("/")[0]
const providerKey = providerID ? process.env[`${providerID.toUpperCase().replaceAll("-", "_")}_API_KEY`] : undefined
if (classifierModel && !providerKey)
  throw new Error(
    `--classifier-model ${classifierModel} needs ${providerID?.toUpperCase()}_API_KEY in the environment (it is removed from process.env before any scenario runs)`,
  )

// ---------------------------------------------------------------------------
// Isolation env — must run before importing anything from src/.
// ---------------------------------------------------------------------------
const base = path.join(os.tmpdir(), `kilo-sec-bench-${process.pid}-${randomUUID()}`)
const home = path.join(base, "home")
// Deliberately NOT named "sandbox"/"config"/"permission": the engine's KILO_ROUTES rule matches those
// substrings in any network-command argument, so a workspace path containing one would falsely trip
// hard.network.kilo-route. Keeping the root neutral avoids contaminating every network scenario.
const sandboxRoot = path.join(base, "arena")
await fs.mkdir(home, { recursive: true })
await fs.mkdir(sandboxRoot, { recursive: true })
await fs.mkdir(path.join(base, "cache", "kilo"), { recursive: true })
await fs.writeFile(path.join(base, "cache", "kilo", "version"), "21")

process.env.XDG_DATA_HOME = path.join(base, "share")
process.env.XDG_CACHE_HOME = path.join(base, "cache")
process.env.XDG_CONFIG_HOME = path.join(base, "config")
process.env.XDG_STATE_HOME = path.join(base, "state")
process.env.KILO_TEST_HOME = home
process.env.HOME = home
process.env.KILO_DB = ":memory:"
process.env.KILO_DISABLE_DEFAULT_PLUGINS = "true"
process.env.KILO_TELEMETRY_LEVEL = "off"
// The fixture catalogue keeps an offline run reproducible. A real-model run needs the real one, and
// it is the only thing in this script that is allowed to reach the network besides the model call.
if (!classifierModel) {
  process.env.KILO_DISABLE_MODELS_FETCH = "1"
  process.env.KILO_MODELS_PATH = path.join(import.meta.dir, "..", "test", "tool", "fixtures", "models-api.json")
}
process.env.KILO_EXPERIMENTAL_EVENT_SYSTEM = "true"
process.env.KILO_EXPERIMENTAL_WORKSPACES = "true"
process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER = "true"
// Never let the model shell inherit real provider credentials.
for (const key of Object.keys(process.env)) {
  if (/_API_KEY$|^AWS_|^ANTHROPIC|^OPENAI|^OPENROUTER/.test(key)) delete process.env[key]
}
// Critical for a fair comparison: SecurityFlag.enabled reads KILO_SECURITY_AUTO *before* the config
// flag, so a stray env var would force baseline and protected identical. Scrub it (the harness also
// clears it per run) so the config layer is the only thing that toggles the engine.
delete process.env.KILO_SECURITY_AUTO

// ---------------------------------------------------------------------------
// Now it is safe to import Kilo + the harness.
// ---------------------------------------------------------------------------
const { Effect } = await import("effect")
const { Global } = await import("@opencode-ai/core/global")
const { BenchHarness } = await import("@/kilocode/security/bench/harness")
const { BenchScenarios } = await import("@/kilocode/security/bench/scenarios")
const { BenchMetrics } = await import("@/kilocode/security/bench/metrics")
// The ablation must be reproducible with no network and no key, so the offline stand-in is the
// default here even though the product's default is the model the user configured. `--classifier-model`
// runs the same ladder against a real one, through Kilo's provider service.
if (classifierModel) {
  process.env["KILO_SECURITY_AUTO_CLASSIFIER_PROVIDER"] = "kilo"
  process.env["KILO_SECURITY_AUTO_CLASSIFIER_MODEL"] = classifierModel
} else process.env["KILO_SECURITY_AUTO_CLASSIFIER_PROVIDER"] ??= "heuristic"
const { BenchReport } = await import("@/kilocode/security/bench/report")
const { BenchCollector } = await import("@/kilocode/security/bench/collector")
const { BenchIsolation } = await import("@/kilocode/security/bench/isolation")

// Fail closed: if the isolation env did not take, do not run destructive scenarios.
if (Global.Path.home !== home) {
  throw new Error(`fake HOME did not take: Global.Path.home=${Global.Path.home}, expected ${home}`)
}

// The provider credential, written into the sandbox's own auth store rather than left in the
// environment. `Global.Path.data` resolves under the disposable base directory (a sibling of the fake
// HOME, so no home-targeting scenario reaches it) and the whole tree is removed at the end.
if (classifierModel && providerKey) {
  if (!Global.Path.data.startsWith(base))
    throw new Error(`auth store is outside the sandbox: ${Global.Path.data} is not under ${base}`)
  await fs.mkdir(Global.Path.data, { recursive: true })
  await fs.writeFile(
    path.join(Global.Path.data, "auth.json"),
    JSON.stringify({ [providerID!]: { type: "api", key: providerKey } }),
    { mode: 0o600 },
  )
}

const sandbox = await BenchIsolation.create({
  root: sandboxRoot,
  home,
  extraRoots: [Global.Path.config],
})
const collector = await BenchCollector.start()

const { BENCH_CONFIGS } = await import("@/kilocode/security/bench/types")

// `--scenario atk-package-*` selects by prefix; an exact id selects one scenario; several
// comma-separated patterns select their union.
const patterns =
  scenarioFilter
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? []
const scenarios = BenchScenarios.all().filter((scenario) => {
  if (patterns.length === 0) return true
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? scenario.id.startsWith(pattern.slice(0, -1)) : scenario.id === pattern,
  )
})
if (scenarios.length === 0) throw new Error(`no scenarios matched --scenario ${scenarioFilter}`)
const configs = (configsArg ? configsArg.split(",") : [...BENCH_CONFIGS]).map((name) => {
  const found = BENCH_CONFIGS.find((config) => config === name.trim())
  if (!found) throw new Error(`unknown config ${name}; expected one of ${BENCH_CONFIGS.join(", ")}`)
  return found
})

// eslint-disable-next-line no-console
console.error(
  `running ${scenarios.length} scenarios × ${runsPerCase} runs × ${configs.length} configs = ${scenarios.length * runsPerCase * configs.length} runs`,
)

const run = () => Effect.runPromise(BenchHarness.runAll({ scenarios, runsPerCase, sandbox, collector, configs }))
// A model reached through Kilo's provider service resolves an instance context; the offline stand-in
// needs none. Establishing it around the whole run keeps that knowledge out of the security code.
const results = classifierModel
  ? await (await import("@/kilocode/instance")).provide({ directory: sandboxRoot, fn: run })
  : await run()

const report = BenchMetrics.aggregate({
  results,
  runsPerCase,
  scenarioCount: scenarios.length,
  generatedAt: new Date().toISOString(),
  configs,
})
/** What the model calls actually cost, from the provider's own token counts and the catalogue rate. */
function cost(): string[] {
  const usage = ClassifierUsage.total()
  if (usage.calls === 0) return []
  const perCall = usage.costUsd / usage.calls
  return [
    "| Model calls | Input tokens | Output tokens | Total cost | Per call |",
    "| --: | --: | --: | --: | --: |",
    `| ${usage.calls} | ${usage.inputTokens} | ${usage.outputTokens} | $${usage.costUsd.toFixed(4)} | $${perCall.toFixed(6)} |`,
  ]
}

const { ClassifierUsage } = await import("@/kilocode/security/classifier/provider")
const advisory = [...BenchHarness.classifierStats().entries()].filter(([, stats]) => stats.calls > 0)
const advisorySection = advisory.length
  ? [
      "",
      "## LLM advisory cost (opt-in layer)",
      "",
      "| Configuration | Considered | Model calls | Calls per decision | Flagged | By category | Errors | Timeouts | Advisory p50 | Advisory p95 |",
      "| --- | --: | --: | --: | --: | --- | --: | --: | --: | --: |",
      ...advisory.map(([config, stats]) => {
        const sorted = [...stats.latencies].sort((a, b) => a - b)
        const q = (p: number) =>
          sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0
        const decisions = results.filter((r) => r.config === config).reduce((n, r) => n + r.decisions.length, 0)
        const rate = decisions > 0 ? (stats.calls / decisions).toFixed(2) : "n/a"
        const categories =
          Object.entries(stats.byCategory)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => `${name} ${count}`)
            .join(", ") || "—"
        return `| ${config} | ${stats.considered} | ${stats.calls} | ${rate} | ${stats.flagged} | ${categories} | ${stats.errors} | ${stats.timeouts} | ${q(50).toFixed(2)} ms | ${q(95).toFixed(2)} ms |`
      }),
      "",
      "### Verdict distribution",
      "",
      "Every answered verdict, including the ones that produced no evidence. `byCategory` above counts",
      "only what was acted on, which cannot say how often the layer stays quiet or whether the calls it",
      "gets wrong are the hedged ones.",
      "",
      "| Configuration | RISK/CATEGORY/CONFIDENCE | Count |",
      "| --- | --- | --: |",
      ...advisory.flatMap(([config, stats]) =>
        Object.entries(stats.byVerdict)
          .sort((a, b) => b[1] - a[1])
          .map(([verdict, count]) => `| ${config} | \`${verdict}\` | ${count} |`),
      ),
      "",
      `_Provider: ${process.env["KILO_SECURITY_AUTO_CLASSIFIER_PROVIDER"] ?? "heuristic"}${classifierModel ? ` (${classifierModel})` : ""}._`,
      ...(classifierModel ? [""].concat(cost()) : []),
    ].join("\n")
  : ""

const markdown = BenchReport.toMarkdown(report) + advisorySection
const jsonl = BenchReport.toJsonl(results)

const outDir = arg("out", path.join(import.meta.dir, "..", ".artifacts", "security-bench", tag ?? "latest"))!
await fs.mkdir(outDir, { recursive: true })
await fs.writeFile(path.join(outDir, "results.jsonl"), jsonl + "\n")
await fs.writeFile(path.join(outDir, "summary.json"), JSON.stringify(report, null, 2) + "\n")
await fs.writeFile(path.join(outDir, "summary.md"), markdown + "\n")

// eslint-disable-next-line no-console
console.log(markdown)
const errored = results.filter((result) => result.error !== undefined)
if (errored.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n⚠ ${errored.length}/${results.length} runs errored (excluded from rates):`)
  for (const result of errored.slice(0, 10)) {
    // eslint-disable-next-line no-console
    console.error(`  - ${result.scenarioId} [${result.config}]: ${result.error}`)
  }
}
// eslint-disable-next-line no-console
console.error(`\nartifacts written to ${outDir}`)

await collector.close()
await sandbox.dispose()
await fs.rm(base, { recursive: true, force: true }).catch(() => {})

const { AppRuntime } = await import("@/effect/app-runtime")
await AppRuntime.dispose().catch(() => {})
process.exit(0)
