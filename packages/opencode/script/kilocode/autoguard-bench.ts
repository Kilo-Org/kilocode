#!/usr/bin/env bun
/**
 * Run the AutoGuard cascade over the action-policy benchmark and emit
 * prediction records the existing Python scorer already understands
 * (`benchmark/scripts/score_action_policy.py`). Reusing that scorer keeps the
 * numbers honest: nothing about how they are computed is new code written by
 * the same person who wrote the policy.
 *
 * This reads only `case.input`. It never opens labels.jsonl, and it never
 * executes a proposed action.
 *
 * Usage:
 *   bun run script/kilocode/autoguard-bench.ts \
 *     --cases ../../../carefully-skip-permissions/benchmark/datasets/action-policy/dev/cases.jsonl \
 *     --output /tmp/autoguard-cascade.jsonl \
 *     --mode cascade --view full_context --model qwen3.5-9b-4bit
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { evaluate, DEFAULT_CASCADE_CONFIG } from "../../src/kilocode/autoguard/cascade"
import { normalize } from "../../src/kilocode/autoguard/normalize"
import { DEFAULT_LEVEL1_CONFIG, type Level1View } from "../../src/kilocode/autoguard/level1"
import type { Decision, NormalizedAction, PolicyInput } from "../../src/kilocode/autoguard/types"

type Mode = "rules_only" | "cascade"

interface BenchCase {
  case_id: string
  input: {
    user_intent: string
    authority: PolicyInput["authority"]
    trusted_context: PolicyInput["trusted_context"]
    proposed_action: {
      raw_tool_call: { tool: string; arguments: Record<string, unknown> }
      normalized: NormalizedAction
    }
    recent_actions?: NormalizedAction[]
  }
}

function arg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]!
  if (fallback !== undefined) return fallback
  throw new Error(`missing required --${name}`)
}

/** Cascade vocabulary -> benchmark label vocabulary. */
const DECISION_MAP: Record<Decision, "ALLOW" | "ASK" | "DENY"> = { allow: "ALLOW", deny: "DENY", ask: "ASK" }

/** Rule id -> snake_case reason code the prediction schema accepts. */
function reasonCode(rule: string | null, decidedBy: string): string {
  if (!rule) return `${decidedBy}_no_rule`
  const tail = rule.includes(":") ? rule.split(":").pop()! : rule
  const code = tail.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return code || `${decidedBy}_unnamed`
}

async function main() {
  const casesPath = arg("cases")
  const outputPath = arg("output")
  const mode = arg("mode", "cascade") as Mode
  const view = arg("view", "full_context") as Level1View
  const model = arg("model", mode === "rules_only" ? "none" : DEFAULT_LEVEL1_CONFIG.model)
  const baseUrl = arg("base-url", DEFAULT_LEVEL1_CONFIG.baseUrl)
  const includeRaw = arg("include-raw", "true") === "true"
  const repeats = Number(arg("repeats", "1"))
  // By default the suite's curated `normalized` action is used, isolating the
  // policy decision from normalization. With --normalize, the action is
  // re-derived from `raw_tool_call` instead, which measures the whole path
  // production actually takes: parse, classify axes, then decide.
  const renormalize = process.argv.includes("--normalize")
  const limit = Number(arg("limit", "0"))

  const cases: BenchCase[] = readFileSync(casesPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as BenchCase)
    .filter((c) => c.case_id && c.input)
  const selected = limit > 0 ? cases.slice(0, limit) : cases

  const config = {
    ...DEFAULT_CASCADE_CONFIG,
    useLevel1: mode === "cascade",
    level1: { ...DEFAULT_LEVEL1_CONFIG, model, baseUrl, view, includeRaw },
  }

  writeFileSync(outputPath, "")
  let done = 0
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const item of selected) {
      // Use the curated normalized action: this suite deliberately isolates the
      // policy decision from normalization. Our own normalizer is exercised by
      // its unit tests and by the end-to-end trajectory suite instead.
      const curated = item.input.proposed_action.normalized
      const derived = renormalize
        ? normalize(item.input.proposed_action.raw_tool_call, item.input.trusted_context, curated.intent_provenance)[0]
        : undefined
      const policyInput: PolicyInput = {
        user_intent: item.input.user_intent,
        authority: item.input.authority,
        trusted_context: item.input.trusted_context,
        // Provenance stays curated even under --normalize: deriving it needs the
        // full conversation, not the one-line intent this suite carries, and
        // mixing that error in would make the normalizer look worse than it is.
        action: derived ? { ...derived, intent_provenance: curated.intent_provenance } : curated,
        raw: JSON.stringify(item.input.proposed_action.raw_tool_call.arguments),
        recent_actions: item.input.recent_actions,
      }

      const result = await evaluate(policyInput, config)
      const failed = result.level1?.failure ?? null
      const status = failed === "timeout" ? "timeout" : failed === "transport" ? "api_error" : "ok"

      appendFileSync(
        outputPath,
        JSON.stringify({
          case_id: item.case_id,
          view: (mode === "rules_only" ? "rules_only" : view) + (renormalize ? "_normalized" : ""),
          repeat_index: repeat,
          requested_model: model,
          prompt_version: "autoguard-level1-v1",
          seed: null,
          status,
          prediction: {
            decision: DECISION_MAP[result.decision],
            reason_code: reasonCode(result.rule, result.decided_by),
            rationale: result.reason,
            confidence: result.decided_by === "level0" ? 1 : 0.5,
          },
          raw_response_text: result.level1?.raw_response ?? null,
          error: failed,
          latency_ms: result.latency_ms,
          usage: null,
          provider: null,
          dry_run_request: null,
          timestamp_utc: new Date().toISOString(),
          // Diagnostics beyond the scorer's contract; it ignores extra keys.
          autoguard: { decided_by: result.decided_by, rule: result.rule, level1_verdict: result.level1?.verdict ?? null },
        }) + "\n",
      )
      done++
      if (done % 6 === 0) process.stderr.write(`  ${done}/${selected.length * repeats}\n`)
    }
  }
  process.stderr.write(`wrote ${done} records to ${outputPath}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
