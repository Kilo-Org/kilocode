/**
 * AutoGuard wired for the trajectory benchmark.
 *
 * The benchmark runner lives outside the agent process: it copies a fixture
 * into a temporary workspace, starts the agent, and compares the workspace
 * before and after. That tells it what happened, but not what was *attempted*
 * -- every tool call the agent tried and what AutoGuard decided about it is
 * visible only from inside this process.
 *
 * `createAutoGuardPlugin` already exposes the seam (`onDecision`, called for
 * every decision); nothing was plugged into it. This module fills it, writing
 * one JSON object per decision to `.autoguard-actions.jsonl` in the workspace,
 * in the shape `benchmark/schemas/trajectory-run.schema.json` defines for
 * `actions[]`. The runner picks the file up and drops it from its own
 * before/after snapshots so the log never counts as collateral damage.
 *
 * Both forms of the action are recorded: `arguments` exactly as the agent
 * passed them, and `normalized` as our normalizer derived it. That pair is the
 * gap the step-level `action-policy` suite cannot see, because there the
 * normalized action is curated rather than derived.
 *
 * Load it as a file plugin -- Tier 0, no file outside this directory changes:
 *
 *   {
 *     "plugin": ["file://<abs path>/bench-plugin.ts"]
 *   }
 *
 * First load is slow, and slow enough to look broken. A `file://` spec makes
 * Kilo install `@kilocode/plugin` next to the config so the plugin's own
 * imports resolve, and plugin loading blocks on that install
 * (`config.ts` -> `waitForDependencies`). On a cold npm cache it can exceed
 * four minutes, during which the CLI prints nothing at all. It is not a
 * deadlock: the install completes and every later run is fast. A benchmark
 * sweep should warm it once rather than let the first scenario pay for it and
 * be recorded as an agent timeout.
 *
 * Configure Level 1 through the environment (`AUTOGUARD_L1_BASE_URL`,
 * `AUTOGUARD_L1_MODEL`, ...). With Level 1 unconfigured the cascade fails
 * closed to `ask`, which the plugin treats as a stop -- so an unconfigured
 * endpoint produces a blocked-everything run, not a quietly permissive one.
 * Set `AUTOGUARD_BENCH_LEVEL` to `level0` to skip Level 1 entirely; that arm
 * needs no model at all.
 */

import { appendFileSync } from "node:fs"
import { join } from "node:path"
import type { Plugin } from "@kilocode/plugin"
import { createAutoGuardPlugin } from "./plugin"
import type { CascadeResult, PolicyInput } from "./types"

const LOG_NAME = ".autoguard-actions.jsonl"

/** Level 0 alone needs no model; the full cascade adds Level 1. */
function cascadeOverrides() {
  return process.env["AUTOGUARD_BENCH_LEVEL"] === "level0" ? { useLevel1: false } : {}
}

/**
 * Which stage actually decided, for the benchmark's `guard_level`.
 *
 * `CascadeResult.decided_by` cannot be used directly: the cascade reports
 * `fail_closed` for three different situations -- a genuine Level 1/2 failure
 * (`rule: "L1-FAIL:timeout"`), a Level 1 that answered `REVIEW` with no Level 2
 * behind it (`rule: "L1:review"`), and the rules-only ablation where no
 * classifier is configured at all (`rule: null`). Only the first is a failure.
 *
 * The benchmark counts `fail_closed` separately precisely to tell "the policy
 * asked because it broke" from "the policy asked because it judged", so
 * collapsing all three would make an unconfident-but-working classifier look
 * like a broken one -- and would hide a broken one behind a working one.
 * The `rule` field is what separates them.
 */
function guardLevel(result: CascadeResult): CascadeResult["decided_by"] {
  const rule = result.rule ?? ""
  if (rule.startsWith("L1-FAIL") || rule.startsWith("L2-FAIL")) return "fail_closed"
  if (rule.startsWith("L2:")) return "level2"
  if (rule.startsWith("L1:")) return "level1"
  if (rule.startsWith("L0-")) return "level0"
  return result.decided_by
}

export function createAutoGuardBenchPlugin(): Plugin {
  let sequence = 0

  return createAutoGuardPlugin({
    cascade: cascadeOverrides(),
    onDecision({ tool, result, input }: { tool: string; result: CascadeResult; input: PolicyInput }) {
      const record = {
        sequence: sequence++,
        tool,
        // The raw call as the agent wrote it. `input.raw` is the serialized
        // argument object the normalizer was handed.
        arguments: safeParse(input.raw),
        normalized: input.action,
        guard_decision: result.decision,
        guard_level: guardLevel(result),
        guard_reason_code: result.rule,
        guard_latency_ms: result.latency_ms,
        executed: result.decision === "allow",
      }
      try {
        appendFileSync(join(process.cwd(), LOG_NAME), JSON.stringify(record) + "\n")
      } catch {
        // Never let logging break the run being measured. A missing log shows
        // up as an empty `actions[]`, which the scorer already handles; a
        // crash here would corrupt the trajectory itself.
      }
    },
  })
}

function safeParse(raw: string | undefined): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { _unparsed: raw }
  }
}

export const AutoGuardBenchPlugin: Plugin = createAutoGuardBenchPlugin()
export default AutoGuardBenchPlugin
