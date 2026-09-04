/**
 * AutoGuard: shared vocabulary for the outgoing-action cascade.
 *
 * Field names deliberately mirror the benchmark dataset schema
 * (`benchmark/schemas/action-case.schema.json`, version 0.2) so that one record
 * serves three consumers without translation: the classifier input, the JSONL
 * audit log, and the labelled dataset. When those three drift apart, offline
 * scores stop predicting production behaviour.
 */

/** What kind of change the action makes to the world. */
export type Effect =
  | "read"
  | "mutation_reversible"
  | "mutation_irreversible"
  | "outbound_network"
  | "credential_access"
  | "package_install"
  | "config_persistence"
  | "infra_external"
  /** Opaque indirection (`./deploy.sh`, `npm run x`, `bash -c`). Never auto-allowed. */
  | "unknown"

/** How far from the worktree the action reaches. */
export type Radius = "inside_worktree" | "project_outside_worktree" | "user_home" | "system" | "remote"

/** How hard the action is to undo. */
export type Reversible = "git_tracked" | "local_untracked" | "remote_irreversible"

/**
 * Who wanted this action. The same command earns a different verdict depending
 * on whether the developer asked for it or the agent invented it.
 */
export type IntentProvenance = "user_explicit" | "user_implied" | "agent_invented"

/** A parsed action. The classifier never sees a raw shell string alone. */
export interface NormalizedAction {
  /** Dotted operation id, e.g. `filesystem.delete`, `git.push`, `network.http_post`. */
  operation: string
  /** Operands: paths, URLs, package names, refspecs. */
  targets: string[]
  effect: Effect
  radius: Radius
  reversible: Reversible
  intent_provenance: IntentProvenance
  /** Flags that change the effect: `recursive`, `force`, `remote_host`, ... */
  options: Record<string, unknown>
}

/** Facts about the environment that the agent cannot forge. */
export interface TrustedContext {
  workspace_root: string
  cwd: string
  environment_kind: string
  /** Paths the user has declared off-limits. */
  protected_paths: string[]
  /** Paths that are build output and safe to regenerate. */
  generated_paths: string[]
  /** Hosts the task is permitted to talk to. Empty means none. */
  allowed_external_hosts: string[]
  /** Branches that must never be force-pushed. Defaults to main/master. */
  protected_branches?: string[]
}

/**
 * What the user actually authorised, as capability descriptors of the form
 * `operation:target` (e.g. `filesystem.delete:dist`).
 */
export interface Authority {
  issuer: string
  scope: string[]
  capabilities: string[]
  expires: string
  /** Descriptors the task cannot be completed without. */
  required: string[]
  /** Descriptors a reasonable reading of the request covers. */
  implicit: string[]
  /** Descriptors that are in scope but carry outsized consequences. */
  sensitive: string[]
}

/** Everything the cascade is allowed to look at for one decision. */
export interface PolicyInput {
  user_intent: string
  authority: Authority
  trusted_context: TrustedContext
  action: NormalizedAction
  /** Raw call text, truncated before it reaches any model. */
  raw?: string
  /** Bounded, normalized history. Never a transcript. */
  recent_actions?: NormalizedAction[]
}

/** The cascade's decision vocabulary, matching Kilo's `Rule.action`. */
export type Decision = "allow" | "deny" | "ask"

/** Level 0's verdict. `continue` means "not my call", not "safe". */
export type Level0Verdict = "ALLOW" | "DENY" | "CONTINUE"

/** Level 1's verdict. `REVIEW` routes to Level 2; it never prompts a human. */
export type Level1Verdict = "ALLOW" | "REVIEW" | "DENY"

export interface Level0Result {
  verdict: Level0Verdict
  /** Stable id of the rule that fired, for audit and per-rule metrics. */
  rule: string | null
  reason: string | null
}

export interface Level1Result {
  verdict: Level1Verdict
  /** Set when the model failed; the cascade then fails closed to `ask`. */
  failure: "timeout" | "transport" | "malformed" | null
  raw_response: string | null
  latency_ms: number
}

export interface CascadeResult {
  decision: Decision
  /** Which level ended the evaluation. */
  decided_by: "level0" | "level1" | "level2" | "fail_closed"
  rule: string | null
  reason: string
  /** Non-empty on `deny`, so the agent can route around the refusal. */
  safe_alternatives: string[]
  level0: Level0Result
  level1: Level1Result | null
  latency_ms: number
}
