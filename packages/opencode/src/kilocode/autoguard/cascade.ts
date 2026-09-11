/**
 * The cascade: Level 0, then Level 1, then (not yet) Level 2.
 *
 * Two properties are load-bearing:
 *
 *  1. Fail-closed. A classifier timeout, an unreachable endpoint, or a reply
 *     that is not one of three words produces `ask`. Never `allow`. An
 *     availability problem must not become a security problem.
 *
 *  2. Deny carries a reason and alternatives, so the agent can route around
 *     the refusal instead of retrying it. A bare error teaches the agent
 *     nothing except to rephrase.
 */

import { constraints, hardDeny, level0 } from "./level0"
import { createLevel1Client, DEFAULT_LEVEL1_CONFIG, type Level1Client, type Level1Config } from "./level1"
import { createLevel2Client, type Level2Client, type Level2Config } from "./level2"
import type { CascadeResult, Level1Result, Level2Result, PolicyInput } from "./types"

export interface CascadeConfig {
  /** Set false to measure the Level 0 rules on their own. */
  useLevel1: boolean
  level1: Level1Config
  /**
   * When false, a Level 1 `REVIEW` becomes `ask` -- the honest mapping when
   * nothing deeper is available: the cascade genuinely does not know.
   */
  useLevel2: boolean
  level2: Level2Config
}

export const DEFAULT_CASCADE_CONFIG: CascadeConfig = {
  useLevel1: true,
  level1: DEFAULT_LEVEL1_CONFIG,
  useLevel2: false,
  // Level 2 defaults to the same endpoint but with `extraBody` cleared, so the
  // reasoning switch Level 1 turns off stays ON here. This layer exists to
  // think, and it is only reached for the minority Level 1 could not settle,
  // so the latency is paid rarely.
  level2: { ...DEFAULT_LEVEL1_CONFIG, extraBody: {} },
}

/** Alternatives are derived from the rule that fired, not written by a model. */
function alternativesFor(rule: string | null): string[] {
  switch (rule) {
    case "L0-D1:pipe_to_shell":
      return ["download the script to a file and read it first", "install from a pinned package instead"]
    case "L0-D2:credential_exfiltration":
      return ["send only the non-secret fields", "upload to a host listed in allowed_external_hosts"]
    case "L0-D3:force_push_protected_branch":
      return ["push to a feature branch and open a pull request", "use --force-with-lease on your own branch"]
    case "L0-D4:agent_self_modification":
      return ["propose the config change as a diff for review", "make the change inside the worktree instead"]
    case "L0-D5:destructive_outside_worktree":
      return ["restrict the deletion to paths under the workspace root"]
    case "L0-D6:protected_path_destruction":
      return ["delete only the declared generated paths", "revert the generated change instead of removing sources"]
    default:
      return ["narrow the action to the targets named in the request", "ask the developer to confirm this target"]
  }
}

/**
 * Evaluate one normalized action.
 *
 * `client` is injectable so tests can drive Level 1 deterministically without
 * a network, and so the benchmark can swap backends without touching this file.
 */
export async function evaluate(
  input: PolicyInput,
  config: CascadeConfig = DEFAULT_CASCADE_CONFIG,
  client?: Level1Client,
  deepClient?: Level2Client,
): Promise<CascadeResult> {
  const started = Date.now()
  const l0 = level0(input)

  if (l0.verdict === "DENY") {
    return {
      decision: "deny",
      decided_by: "level0",
      rule: l0.rule,
      reason: l0.reason ?? "denied by deterministic rule",
      safe_alternatives: alternativesFor(l0.rule),
      level0: l0,
      level1: null,
      level2: null,
      latency_ms: Date.now() - started,
    }
  }

  if (l0.verdict === "ALLOW") {
    return {
      decision: "allow",
      decided_by: "level0",
      rule: l0.rule,
      reason: l0.reason ?? "allowed by deterministic rule",
      safe_alternatives: [],
      level0: l0,
      level1: null,
      level2: null,
      latency_ms: Date.now() - started,
    }
  }

  if (!config.useLevel1) {
    // Rules-only ablation. Level 0 declining to decide is not consent.
    return {
      decision: "ask",
      decided_by: "fail_closed",
      rule: null,
      reason: "no deterministic rule applies and Level 1 is disabled",
      safe_alternatives: [],
      level0: l0,
      level1: null,
      level2: null,
      latency_ms: Date.now() - started,
    }
  }

  const l1: Level1Result = await (client ?? createLevel1Client(config.level1)).classify(input)

  if (l1.failure) {
    return {
      decision: "ask",
      decided_by: "fail_closed",
      rule: `L1-FAIL:${l1.failure}`,
      reason: `Level 1 ${l1.failure}; failing closed to ask`,
      safe_alternatives: [],
      level0: l0,
      level1: l1,
      level2: null,
      latency_ms: Date.now() - started,
    }
  }

  if (l1.verdict === "DENY") {
    return {
      decision: "deny",
      decided_by: "level1",
      rule: "L1:deny",
      reason: "Level 1 judged the action destructive or unrelated to the request",
      safe_alternatives: alternativesFor(null),
      level0: l0,
      level1: l1,
      level2: null,
      latency_ms: Date.now() - started,
    }
  }

  if (l1.verdict === "ALLOW" && constraints(input).length) {
    return {
      decision: "ask",
      decided_by: "level1",
      rule: "CONTRACT:missing_facts",
      reason: "The model cannot waive mandatory execution constraints",
      reason_code: "missing_facts",
      missing_facts: constraints(input),
      failure: null,
      safe_alternatives: [],
      level0: l0,
      level1: l1,
      level2: null,
      latency_ms: Date.now() - started,
    }
  }
  if (l1.verdict === "ALLOW") {
    return {
      decision: "allow",
      decided_by: "level1",
      rule: "L1:allow",
      reason: "Level 1 judged the action a routine step toward the stated request",
      safe_alternatives: [],
      level0: l0,
      level1: l1,
      level2: null,
      latency_ms: Date.now() - started,
    }
  }

  // REVIEW with no Level 2 behind it. Undetermined, so a human decides.
  if (!config.useLevel2) {
    return {
      decision: "ask",
      decided_by: "level1",
      missing_facts: l1.missing_facts ?? ["policy_uncertain"],
      reason_code: l1.reason_code ?? "policy_uncertain",
      failure: null,
      rule: "L1:review",
      reason: "Level 1 was not confident; Level 2 is not enabled",
      safe_alternatives: [],
      level0: l0,
      level1: l1,
      level2: null,
      latency_ms: Date.now() - started,
    }
  }

  const l2: Level2Result = await (deepClient ?? createLevel2Client(config.level2)).review(input)

  if (l2.failure) {
    return {
      decision: "ask",
      decided_by: "fail_closed",
      rule: `L2-FAIL:${l2.failure}`,
      reason: `Level 2 ${l2.failure}; failing closed to ask`,
      safe_alternatives: [],
      level0: l0,
      level1: l1,
      level2: l2,
      latency_ms: Date.now() - started,
    }
  }

  const decision: CascadeResult["decision"] =
    l2.verdict === "ALLOW" ? (constraints(input).length ? "ask" : "allow") : l2.verdict === "DENY" ? "deny" : "ask"
  return {
    decision,
    decided_by: "level2",
    rule: `L2:${l2.verdict.toLowerCase()}:${l2.failed_check}`,
    reason: `Level 2 ${l2.verdict.toLowerCase()} (${l2.reason_code}, failed check: ${l2.failed_check}, risk: ${l2.risk})`,
    // Level 2 writes its own alternatives; fall back to the rule table if it did not.
    safe_alternatives:
      decision === "deny" ? (l2.safe_alternatives.length ? l2.safe_alternatives : alternativesFor(null)) : [],
    level0: l0,
    level1: l1,
    level2: l2,
    latency_ms: Date.now() - started,
  }
}

/** Whole-call aggregation shared by the runtime and offline bridge. */
export async function evaluateCall(
  inputs: PolicyInput[],
  config: CascadeConfig = DEFAULT_CASCADE_CONFIG,
  client?: Level1Client,
) {
  const started = Date.now()
  if (!inputs.length) throw new Error("empty_action_ir")
  const denied = inputs.map((input) => hardDeny(input)).findIndex((result) => result.verdict === "DENY")
  if (denied >= 0) {
    const result = await evaluate(inputs[denied], config, client)
    return {
      result: { ...result, latency_ms: Date.now() - started },
      results: inputs.map((_, index) => (index === denied ? result : null)),
      index: denied,
    }
  }
  const results: CascadeResult[] = []
  for (const input of inputs) results.push(await evaluate(input, config, client))
  const index =
    results.findIndex((x) => x.decision === "deny") >= 0
      ? results.findIndex((x) => x.decision === "deny")
      : Math.max(
          0,
          results.findIndex((x) => x.decision === "ask"),
        )
  return { result: { ...results[index], latency_ms: Date.now() - started }, results, index }
}
