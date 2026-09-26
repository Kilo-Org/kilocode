/**
 * Security Auto Mode benchmark: shared types.
 *
 * The benchmark answers one question objectively: given the same coding-agent trajectory, does
 * turning Security Auto on change what actually happens on disk / on the wire, and at what cost to
 * legitimate work and to autonomy. Attack success is never inferred from model text; it is decided by
 * an observable side effect (a canary), or, for cases too dangerous to execute, by the deterministic
 * security decision alone (explicitly flagged as such).
 *
 * See docs/security-auto-mode-benchmark.md for the methodology this file encodes.
 */
import { Effect } from "effect"
import type { SecurityGate } from "@/kilocode/security/gate"

/**
 * The configurations under comparison, as an ablation ladder. Each step differs from the previous one
 * by exactly one layer, so the contribution of every layer is measurable on its own:
 * - `baseline`: Security Auto off (a maximally autonomous Kilo);
 * - `deterministic-security`: the deterministic ALLOW/ASK/DENY engine alone;
 * - `package-security`: + pre-install package provenance preflight;
 * - `stateful-egress`: + stateful sensitive-read → outbound-egress protection;
 * - `delegated-tool-security`: + delegated-authority classification of MCP / custom tools;
 * - `content-secret-detection`: + secret classification of ordinary workspace content;
 * - `executable-code-trust`: + trust boundary for repository-controlled executable code;
 * - `permissioned-extension-runtime`: + permissioned host process for approved extensions;
 * - `read-confined-extension-runtime`: + ambient reads confined to the extension's working set;
 * - `semantic-evidence`: + the semantic review of actions the deterministic layers left unsettled.
 *
 * The last rung is part of Security Auto Mode as shipped. It is a row of its own so its contribution
 * can be read directly against the row above it, which is identical in every other respect.
 */
export type BenchConfig =
  | "baseline"
  | "deterministic-security"
  | "package-security"
  | "stateful-egress"
  | "delegated-tool-security"
  | "content-secret-detection"
  | "executable-code-trust"
  | "permissioned-extension-runtime"
  | "read-confined-extension-runtime"
  | "semantic-evidence"

export const BENCH_CONFIGS: readonly BenchConfig[] = [
  "baseline",
  "deterministic-security",
  "package-security",
  "stateful-egress",
  "delegated-tool-security",
  "content-secret-detection",
  "executable-code-trust",
  "permissioned-extension-runtime",
  "read-confined-extension-runtime",
  "semantic-evidence",
]

export const CONFIG_LABELS: Record<BenchConfig, string> = {
  baseline: "Baseline",
  "deterministic-security": "Deterministic Security",
  "package-security": "+ Package Security",
  "stateful-egress": "+ Stateful Egress",
  "delegated-tool-security": "+ Delegated Tool Security",
  "content-secret-detection": "+ Content Secret Detection",
  "executable-code-trust": "+ Executable Code Trust",
  "permissioned-extension-runtime": "+ Permissioned Extension Runtime",
  "read-confined-extension-runtime": "+ Read-Confinement",
  "semantic-evidence": "+ Semantic Evidence",
}

export type ScenarioCategory =
  | "utility-read"
  | "utility-edit"
  | "utility-build"
  | "utility-vcs"
  | "utility-shell"
  | "utility-package"
  | "utility-network"
  | "utility-sensitive"
  | "utility-mcp"
  | "utility-content"
  | "utility-code"
  | "utility-extension"
  | "attack-destructive-filesystem"
  | "attack-sensitive-path"
  | "attack-shell-indirection"
  | "attack-encoded-execution"
  | "attack-malformed-shell"
  | "attack-policy-tampering"
  | "attack-prompt-injection"
  | "attack-exfiltration"
  | "attack-package-install"
  | "attack-uncovered-tool"
  | "attack-mcp-tool"
  | "attack-pre-gate"
  | "attack-extension-runtime"
  | "attack-extension-read"
  | "attack-workspace-secret"
  | "attack-goal-mismatch"
  | "attack-device"

/** Categories that make up the package-specific ASR. */
export const PACKAGE_ATTACK_CATEGORIES: readonly ScenarioCategory[] = ["attack-package-install"]
/** Categories that make up the exfiltration-specific ASR. */
export const EXFIL_ATTACK_CATEGORIES: readonly ScenarioCategory[] = ["attack-exfiltration", "attack-prompt-injection"]
/** Categories that make up the pre-gate (no tool call involved) ASR. */
export const PRE_GATE_ATTACK_CATEGORIES: readonly ScenarioCategory[] = ["attack-pre-gate"]
/** Categories that make up the extension-runtime ASR (what approved extension code can still do). */
export const RUNTIME_ATTACK_CATEGORIES: readonly ScenarioCategory[] = [
  "attack-extension-runtime",
  "attack-extension-read",
]
/** Categories that make up the ambient-read ASR (what an approved extension can still read directly). */
export const READ_ATTACK_CATEGORIES: readonly ScenarioCategory[] = ["attack-extension-read"]
/** Categories that make up the ordinary-workspace-secret ASR. */
export const WORKSPACE_SECRET_ATTACK_CATEGORIES: readonly ScenarioCategory[] = ["attack-workspace-secret"]
/** Categories that make up the MCP / custom-tool (delegated authority) ASR. */
export const AUTHORITY_ATTACK_CATEGORIES: readonly ScenarioCategory[] = ["attack-mcp-tool", "attack-uncovered-tool"]
/** Categories that make up the package-specific utility rate. */
export const PACKAGE_UTILITY_CATEGORIES: readonly ScenarioCategory[] = ["utility-package"]
/** Categories that make up the delegated-authority utility rate. */
export const AUTHORITY_UTILITY_CATEGORIES: readonly ScenarioCategory[] = ["utility-mcp"]
/** Categories that make up the content-classification utility rate (the false-positive surface). */
export const CONTENT_UTILITY_CATEGORIES: readonly ScenarioCategory[] = ["utility-content"]
/** Categories that make up the executable-code utility rate (plugins / custom tools that must load). */
export const CODE_UTILITY_CATEGORIES: readonly ScenarioCategory[] = ["utility-code", "utility-extension"]

/**
 * Who wants the dangerous action. The engine is intent-agnostic today; the field exists so paired
 * scenarios can measure whether that produces a false positive / UX conflict when a user explicitly
 * asked for the action (a trusted-intent case under the threat model in the benchmark docs).
 */
export type Intent = "agent-initiated" | "user-requested" | "n/a"

/**
 * How a scenario's success is decided.
 * - `side-effect`: a canary on the disposable filesystem or the local collector (the strong oracle).
 * - `decision-only`: the action is too dangerous to execute on the host (device wipe, ...), so success
 *   is judged by the security decision. Reported separately; never mixed into the side-effect ASR.
 * - `pre-gate`: the damage happens without any tool call — at module import, during plugin
 *   initialisation, inside a plugin hook, or through an HTTP surface. There is no trajectory to
 *   adjudicate, so the scenario runs a probe instead of tool steps. Counted in the side-effect ASR
 *   like any other observable damage, and broken out separately so it is never mistaken for a
 *   trajectory result.
 */
export type OracleKind = "side-effect" | "decision-only" | "pre-gate"

/** A single tool call the scripted agent attempts, in order. */
export interface TrajectoryStep {
  tool: string
  args: Record<string, unknown>
  /** Human note for the report; never affects execution. */
  note?: string
  /**
   * The trusted user answers a *hard ASK* raised by this step with "yes" (an interactive approval).
   * DENY is unaffected (it never reaches the prompt). Models the realistic case "the user let the agent
   * read .env for this task"; counted as a trusted-user approval in the friction breakdown.
   */
  approve?: boolean
}

/** Runtime handles a scenario factory receives to build its canaries and trajectory. */
export interface ScenarioContext {
  /** The disposable workspace (also the worktree root). Everything legitimate happens here. */
  workspace: string
  /** The disposable, fake HOME. Credential-store canaries live here; never the real home. */
  home: string
  /** The per-run root; the workspace is a child of it, so it doubles as a workspace ancestor. */
  runRoot: string
  /** The shared sandbox root; every disposable path is inside it. */
  sandbox: string
  /** Loopback exfiltration collector. */
  collector: { url: string; received(token: string): boolean }
  /** A directory prepended to PATH holding shims (a fake package manager). */
  binDir: string
  /** Kilo's global config directory (a disposable temp dir here). The engine treats it as protected. */
  kiloConfigDir: string
  /**
   * Whether the executable-code trust boundary is active for this run. Pre-gate
   * scenarios use it to run the loaders' real sequence for the configuration under test.
   */
  codeTrust: boolean
  /** Whether widget-initiated MCP Apps calls are permitted for this run. */
  mcpAppsAllowed: boolean
  /** Whether approved extensions run in the permissioned host for this run. */
  extensionRuntime: boolean
  /** Whether that host also confines what the extension may read directly. */
  extensionReadConfinement: boolean
  /** Build an absolute path guaranteed to sit inside the sandbox (throws otherwise). */
  path(...segments: string[]): string
}

export interface ScenarioInstance {
  /** Create canaries / seed files for one run. Runs before the trajectory, on a fresh run root. */
  setup: Effect.Effect<void>
  steps: TrajectoryStep[]
  /**
   * True when the attack's damaging side effect is observable now. Only meaningful for attack
   * scenarios with a side-effect oracle.
   */
  attackSucceeded?: Effect.Effect<boolean>
  /** True when the legitimate goal was achieved (utility scenarios, and safe-completion tails). */
  utilityCompleted?: Effect.Effect<boolean>
  /**
   * A `pre-gate` scenario's payload: the side effect that happens without a tool call. Runs instead of
   * `steps`, under the same per-run timeout and isolation guard.
   */
  probe?: Effect.Effect<void>
  /**
   * Installed as the plugin `tool.execute.before` hook for this run, so the scenario can measure what
   * a hook does at the real trigger site — outside the execution gate, whatever the configuration.
   */
  pluginHook?: Effect.Effect<void>
  /** Absolute paths the trajectory may touch; the isolation guard asserts each is in the sandbox. */
  guardedPaths: string[]
}

export interface Scenario {
  id: string
  category: ScenarioCategory
  kind: "utility" | "attack"
  intent: Intent
  oracle: OracleKind
  /** One-line description for the report. */
  description: string
  /** Non-deterministic in a real LLM run; the scripted driver is deterministic (see docs). */
  stochastic: boolean
  /** For attack scenarios: the security decision we expect fully protected Security Auto to reach. */
  expectedProtected?: "deny" | "hard-ask" | "soft-ask-or-allow"
  /** Cross-links a paired scenario (agent-initiated ↔ user-requested), for the intent analysis. */
  pairedWith?: string
  /**
   * What the user asked for this turn, in their own words. Recorded into session state before the
   * trajectory runs, exactly as the product records it from a real turn.
   *
   * Evidence about intent, never authority: a scenario whose goal names the dangerous action is still
   * adjudicated by the same rules, which is what `atk-ssh-write-user-requested` exists to demonstrate.
   */
  goal?: string
  /** The layer the scenario primarily exercises (for the per-layer breakdown). */
  layer?: "deterministic" | "packages" | "egress" | "tools" | "content" | "code" | "runtime" | "pre-gate" | "residual"
  build(ctx: ScenarioContext): Effect.Effect<ScenarioInstance>
}

/** One (scenario, config, run) observation. Machine-readable; carries no secrets or command text. */
export interface RunResult {
  scenarioId: string
  category: ScenarioCategory
  kind: "utility" | "attack"
  intent: Intent
  oracle: OracleKind
  config: BenchConfig
  run: number
  expectedProtected?: string
  layer?: Scenario["layer"]
  /** Security decisions the gate reached during the run (empty in baseline: the gate is off). */
  decisions: SecurityGate.Observation[]
  /** Attack side effect observed (null when not an attack / decision-only handled separately). */
  attackSuccess: boolean | null
  /** Utility goal achieved (null when the scenario has no utility goal). */
  utilitySuccess: boolean | null
  /** Auto-ALLOW decisions (no friction at all). */
  allows: number
  /** Hard asks that a human would have had to answer (autonomy-breaking friction). */
  asks: number
  /** Denies raised by the engine. */
  denies: number
  /** Soft asks (auto-approved under autonomy; friction only with a stricter permission policy). */
  softAsks: number
  /** Hard asks answered "yes" by the trusted user (steps marked `approve`). */
  approvals: number
  /** Tool calls whose side effect actually executed. */
  executed: number
  /** Tool calls blocked by the security layer (deny or hard ask under autonomy). */
  blocked: number
  durationMs: number
  /** Per-decision security latencies (ms), for percentile aggregation. */
  securityLatencies: number[]
  /** Set when the run itself errored (harness/tool failure), so one bad run cannot void the report. */
  error?: string
}
