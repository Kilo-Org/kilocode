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
  resources?: Resource[]
  uncertainty?: string[]
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
  catalog?: ResourceCatalog
  test_profile?: Partial<ExecutionProfile>
  audit_paths?: string[]
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
  forbidden?: string[]
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
  contract?: TaskContract
  ir?: ActionIR
  profile?: ExecutionProfile
  history?: ActionOutcome[]
}

/** The cascade's decision vocabulary, matching Kilo's `Rule.action`. */
export type Decision = "allow" | "deny" | "ask"

/** Level 0's verdict. `continue` means "not my call", not "safe". */
export type Level0Verdict = "ALLOW" | "DENY" | "CONTINUE"

/** Level 1's verdict. `REVIEW` routes to Level 2; it never prompts a human. */
export type Level1Verdict = "ALLOW" | "REVIEW" | "DENY"

/**
 * Level 2's verdict.
 *
 * `ASK` is a deliberate departure from classification-design.md §7, which gives
 * this layer only ALLOW and DENY. Half of what actually reaches Level 2 is
 * plausible but under-authorized -- the grant simply never covers this target --
 * and the right answer there is a human, not a guess. A binary would turn every
 * such case into an unsafe allow or a false block.
 */
export type Level2Verdict = "ALLOW" | "DENY" | "ASK"

export interface Level0Result {
  verdict: Level0Verdict
  /** Stable id of the rule that fired, for audit and per-rule metrics. */
  rule: string | null
  reason: string | null
}

export interface Level1Result {
  verdict: Level1Verdict
  /** Set when the model failed; the cascade then fails closed to `ask`. */
  failure: "timeout" | "transport" | "malformed" | "invalid_response" | null
  reason_code?: string
  missing_facts?: string[]
  raw_response: string | null
  latency_ms: number
}

export interface Level2Result {
  verdict: Level2Verdict
  /** Which of the three checks failed, or `none`. */
  failed_check: string
  reason_code: string
  risk: string
  /** Feeds structured deny-and-continue directly. */
  safe_alternatives: string[]
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
  level2: Level2Result | null
  latency_ms: number
  reason_code?: string
  missing_facts?: string[]
  failure?: "timeout" | "transport" | "invalid_response" | null
}

export interface Resource {
  raw: string
  key: string
  kind: "file" | "directory" | "url" | "reference"
  identity?: string
  exists?: boolean
  symlink?: boolean
}

export interface ResourceCatalog {
  source: string[]
  verification: string[]
  generated_output: string[]
}

export interface ExecutionProfile {
  id: string
  trusted_code: boolean
  runner: string[]
  cwd: string
  argv: string[]
  write_roots: string[]
  denied_paths: string[]
  network: "deny" | "proxy"
  allowed_hosts: string[]
  environment: Record<string, string>
  config_hash: string
}

export interface ActionIR {
  version: 1
  tool: string
  call_id: string
  cwd: string
  argv: string[][]
  actions: NormalizedAction[]
  fingerprint: string
  uncertainty: string[]
}

export interface ContractMessage {
  id: string
  text: string
}

export interface Grant {
  operation: string
  resource: Resource
  source: string
  evidence: string
  confirmed: "grammar" | "user"
}

export interface PendingApproval {
  id: string
  version: number
  fingerprint: string
  question: string
  candidates: Grant[]
  missing_facts: string[]
}

export interface TaskContract {
  schema_version: 1
  session_id: string
  workspace: string
  version: number
  expires: "session"
  active: boolean
  initial: ContractMessage
  clarifications: ContractMessage[]
  grants: Grant[]
  prohibitions: Grant[]
  catalog: ResourceCatalog
  pending: PendingApproval[]
  parent_id?: string
  parent_version?: number
  proposals: Grant[]
  extractor_failure: string | null
  configuration_hash?: string
  uncertainties?: ContractMessage[]
}

export interface ActionOutcome {
  call_id: string
  actions: NormalizedAction[]
  decision: Decision | null
  executed: boolean | null
  exit_code: number | null
  error: string | null
}

export interface AuditEvent {
  schema_version: "0.2"
  event:
    | "startup"
    | "proposed"
    | "policy_decided"
    | "waiting_user"
    | "approval_replied"
    | "execution_started"
    | "execution_finished"
    | "tool_finished"
  timestamp: string
  session_id: string
  call_id: string
  operation_index?: number
  policy_decision?: Decision | null
  [key: string]: unknown
}
