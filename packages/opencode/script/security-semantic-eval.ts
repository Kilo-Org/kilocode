#!/usr/bin/env bun
// kilocode_change - new file
/**
 * Scores the semantic security layer against the paired corpus in `classifier/eval/semantic.ts`.
 *
 * Offline, no key, no network (the `heuristic` stand-in):
 *
 *   bun run script/security-semantic-eval.ts --provider heuristic
 *
 * The metadata-only baseline — how far the corpus can be passed *without reading the text*. Any real
 * result has to be read next to this one:
 *
 *   bun run script/security-semantic-eval.ts --provider baseline
 *
 * Against a real model, through Kilo's own provider service. Nothing here names a vendor: the model
 * is whatever `--model provider/id` resolves to in the Kilo catalogue, and its credentials come from
 * the same place Kilo gets them (config, auth store, or the provider's environment variable):
 *
 *   OPENROUTER_API_KEY=... bun run script/security-semantic-eval.ts \
 *     --provider kilo --model openrouter/google/gemini-2.5-flash-lite --set held-out
 *
 * Flags: `--set development|held-out|both`, `--sensitivity conservative|balanced|both`, `--json`,
 * `--out <file>`, `--repeat N`, `--concurrency N`.
 *
 * What is scored is the *layer*, not the raw model: every case runs through the real provider and the
 * real `policy()` mapping, so a verdict the policy would ignore counts as no escalation. A classifier
 * that flags everything behind a policy that ignores it is the same product as one that flags nothing.
 */
import { provide } from "@/kilocode/instance"
import {
  ClassifierUsage,
  HeuristicProvider,
  ModelProvider,
  kiloBackend,
  type ClassifierProvider,
} from "@/kilocode/security/classifier/provider"
import { MetadataBaseline } from "@/kilocode/security/classifier/eval/baseline"
import { SemanticEvidence } from "@/kilocode/security/classifier/layers"
import { FREEZE, INJECTION_GROUPS, type Group } from "@/kilocode/security/classifier/eval/semantic"
import { SETS, classifyAll, scorePass, slice, type Score } from "@/kilocode/security/classifier/eval/run"
import fs from "node:fs/promises"
import os from "node:os"

const argv = process.argv.slice(2)
const flag = (name: string, fallback?: string) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback
}
const asJson = argv.includes("--json")
const repeat = Number(flag("repeat", "1")) || 1
const model = flag("model")
const kind = (flag("provider", model ? "kilo" : "heuristic") ?? "heuristic").toLowerCase()
const outFile = flag("out")

const ALL_MODES: SemanticEvidence.Sensitivity[] = ["conservative", "balanced"]
const requestedMode = flag("sensitivity", "both")!
const modes = requestedMode === "both" ? ALL_MODES : ALL_MODES.filter((mode) => mode === requestedMode)
if (modes.length === 0) throw new Error("--sensitivity expects conservative, balanced or both")

const requestedSet = flag("set", "both")!
// `both` is the two scored corpora. The adversarial set answers a different question and is asked
// for by name, so a routine run never silently averages it into a recall figure.
const sets = Object.entries(SETS).filter(([name]) =>
  requestedSet === "both" ? name !== "adversarial" : name === requestedSet,
)
if (sets.length === 0) throw new Error(`--set expects ${Object.keys(SETS).join(", ")} or both`)
for (const [name, cases] of sets) if (cases.length === 0) throw new Error(`the ${name} set has no cases`)

function build(): ClassifierProvider {
  if (kind === "heuristic") return new HeuristicProvider()
  if (kind === "baseline") return new MetadataBaseline()
  if (kind === "kilo") return new ModelProvider(kiloBackend(model ? { model } : {}))
  throw new Error(`--provider expects heuristic, baseline or kilo (got ${kind})`)
}

const provider = build()
const pct = (value: number) => `${Math.round(value * 100)}%`
const quantile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
}

/**
 * The families, reported apart because they answer different questions.
 *
 * `injection` is the half where the two members of every pair are metadata-identical, so a classifier
 * that does not read the untrusted text scores exactly 50% there whatever it does. `goal-request`
 * varies the user's own words, which are trusted input — a metadata classifier is entitled to do well
 * on it, and saying so is the point of reporting it separately.
 */
const FAMILIES: Record<string, (group: string) => boolean> = {
  "prompt injection": (group) => INJECTION_GROUPS.includes(group as Group) && !group.startsWith("goal-"),
  "goal / content": (group) => group === "goal-content",
  "goal / request": (group) => group === "goal-request",
}

interface Row {
  set: string
  mode: string
  scored: Score
  latencyP50: number
  latencyP95: number
}

const rows: Row[] = []

async function run() {
  for (const [name, cases] of sets) {
    // One pass over the corpus, scored under each sensitivity. The setting only changes `policy()`,
    // which is pure, so asking the model twice would cost twice and prove nothing.
    let pass = await classifyAll(provider, cases)
    for (let attempt = 1; attempt < repeat; attempt++) pass = await classifyAll(provider, cases)
    for (const mode of modes) {
      const scored = scorePass(cases, pass, mode)
      rows.push({
        set: name,
        mode,
        scored,
        latencyP50: quantile(scored.latencies, 50),
        latencyP95: quantile(scored.latencies, 95),
      })
    }
  }
}

/**
 * Wait for the lazily imported provider graph.
 *
 * In the product the first calls after start deliberately fall through with no answer rather than
 * make a security decision wait on an import — the right trade there. In an evaluation it is a
 * measurement artefact that silently lowers recall, so the run starts only once a call has actually
 * reached a model.
 */
async function warm() {
  const [sample] = sets[0]![1]
  for (let attempt = 0; attempt < 40; attempt++) {
    const before = ClassifierUsage.total().calls
    await provider.classify(sample!.input, new AbortController().signal).catch(() => undefined)
    if (ClassifierUsage.total().calls > before) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  ClassifierUsage.reset()
}

// A model reached through Kilo's provider service needs an instance context; the offline providers do
// not care. Establishing it here keeps the security code free of any knowledge of how a script runs.
if (kind === "kilo")
  await provide({
    directory: os.tmpdir(),
    fn: async () => {
      await warm()
      await run()
    },
  })
else await run()

const usage = ClassifierUsage.total()
const perCall = usage.calls ? usage.costUsd / usage.calls : 0

const report = {
  provider: provider.name,
  frozen: FREEZE,
  repeat,
  usage: {
    ...usage,
    costPerCallUsd: perCall,
    costPer1000DecisionsUsd: perCall * 1000,
    note: "Cost is tokens reported by the provider times the catalogue rate. Multiply by the measured call rate for a per-decision figure.",
  },
  rows: rows.map((row) => ({
    set: row.set,
    mode: row.mode,
    overall: { ...row.scored.confusion, recall: row.scored.recall, falseEscalation: row.scored.falseEscalation },
    families: Object.fromEntries(
      Object.entries(FAMILIES).map(([family, keep]) => [family, slice(row.scored, (item) => keep(item.group))]),
    ),
    latencyP50: row.latencyP50,
    latencyP95: row.latencyP95,
    errors: row.scored.errors,
    missed: row.scored.outcomes.filter((item) => item.expected === "escalate" && !item.escalated).map((i) => i.id),
    falseAlarms: row.scored.outcomes.filter((item) => item.expected === "quiet" && item.escalated).map((i) => i.id),
  })),
}

if (outFile) await fs.writeFile(outFile, JSON.stringify(report, null, 2))

if (asJson) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2))
} else {
  const out: string[] = []
  out.push(`# Semantic layer eval — provider: ${provider.name}`)
  out.push("")
  out.push("| Set | Policy | Cases | TP | FP | FN | TN | Recall | False escalation | p50 | p95 |")
  out.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
  for (const row of rows) {
    const c = row.scored.confusion
    out.push(
      `| ${row.set} | ${row.mode} | ${row.scored.total} | ${c.tp} | ${c.fp} | ${c.fn} | ${c.tn} | ` +
        `${c.tp}/${row.scored.attacks} (${pct(row.scored.recall)}) | ${c.fp}/${row.scored.benign} (${pct(row.scored.falseEscalation)}) | ` +
        `${row.latencyP50.toFixed(0)} ms | ${row.latencyP95.toFixed(0)} ms |`,
    )
  }
  for (const row of rows) {
    out.push("")
    out.push(`## ${row.set} [${row.mode}]`)
    for (const [family, keep] of Object.entries(FAMILIES)) {
      const part = slice(row.scored, (item) => keep(item.group))
      if (part.total === 0) continue
      out.push(
        `  ${family.padEnd(18)} recall ${part.confusion.tp}/${part.attacks} (${pct(part.recall)})   ` +
          `false escalation ${part.confusion.fp}/${part.benign} (${pct(part.falseEscalation)})`,
      )
    }
    const missed = row.scored.outcomes.filter((item) => item.expected === "escalate" && !item.escalated)
    const alarms = row.scored.outcomes.filter((item) => item.expected === "quiet" && item.escalated)
    if (missed.length) out.push(`  missed: ${missed.map((item) => item.id).join(", ")}`)
    if (alarms.length) out.push(`  false alarms: ${alarms.map((item) => item.id).join(", ")}`)
    if (row.scored.errors) out.push(`  provider errors: ${row.scored.errors}`)
  }
  if (usage.calls > 0) {
    out.push("")
    out.push(
      `## cost\n  ${usage.calls} calls, ${usage.inputTokens} in / ${usage.outputTokens} out` +
        `${usage.reasoningTokens ? ` / ${usage.reasoningTokens} reasoning` : ""} tokens` +
        `\n  $${usage.costUsd.toFixed(5)} total, $${perCall.toFixed(6)} per call, $${(perCall * 1000).toFixed(3)} per 1000 calls`,
    )
  }
  // eslint-disable-next-line no-console
  console.log(out.join("\n"))
}
process.exit(0)
