/**
 * Portable types for the deterministic security decision layer (Hackathon V1).
 *
 * This module and its siblings `rules.ts`/`core.ts` are the *pure* half of the layer: no IO,
 * no clock, no randomness, no Effect and no Kilo imports. Everything Kilo-specific lives in
 * `adapter.ts`, which normalizes permission metadata into these facts.
 */
export namespace SecurityDecisionTypes {
  /** `pass` means "no opinion" — it is not a strictness level. */
  export type Decision = "allow" | "ask" | "deny" | "pass"

  /** Authority backing the baseline decision. Undeterminable provenance is `unknown`, run as untrusted. */
  export type Authority = "hard" | "xdg_global" | "untrusted" | "unknown"

  /** Sensitivity class of a normalized path. `unknown` blocks any multi-target allow. */
  export type PathClass =
    | "ordinary"
    | "sensitive"
    | "git_hook"
    | "control_plane"
    | "ci"
    | "package_manifest"
    | "root"
    | "unknown"

  export type PathFact = Readonly<{
    path: string
    inWorkspace: boolean
    class: PathClass
    /** Which region of a structured file the change touches, when the adapter could determine it. */
    region?: "scripts" | "dependencies" | "other"
    /**
     * Operation for this target specifically. One shell command can read one file and write another,
     * so a fact may override the action-wide operation. Structured file tools leave it unset.
     */
    operation?: string
  }>

  /** One command of a sequence. A sequence of these is what a decomposable composed action is. */
  export type ExecCommandFact = Readonly<{
    executable?: string
    argv?: readonly string[]
    /** Whether the executable's own file semantics are known to the scan. */
    classified?: boolean
    /** Whether the command can expose values inherited from the process environment. */
    ambient?: boolean
    /**
     * Whether the executable was named by a path instead of resolved on `PATH`. The name then
     * describes a file the command line chose, so it cannot buy a name-based fast path.
     */
    pathed?: boolean
    /**
     * Whether the run rewrites the environment its own names resolve in — a prefix assignment, an
     * `export`, an alias or a function definition. A bare name proves nothing once this holds.
     */
    assigns?: boolean
  }>

  export type ExecFact = Readonly<{
    /** Whether the shell scan recovered the full AST (fail-closed to false). */
    complete: boolean
    /** Pipelines, substitutions, heredocs and other composition the scan observed. */
    composed: boolean
    executable?: string
    /** The parsed command line, bounded. Present only for a single, fully recovered command. */
    argv?: readonly string[]
    /** Whether the executable's own file semantics are known to the scan. */
    classified?: boolean
    /** Whether the command can expose values inherited from the process environment. */
    ambient?: boolean
    /**
     * Whether the composition is pure sequencing over fully recovered commands. A composed action
     * is judged command by command only when this holds; otherwise it stays opaque.
     */
    decomposable?: boolean
    /** The recovered commands, in source order. Present only when the scan could name them all. */
    commands?: readonly ExecCommandFact[]
    /** See `ExecCommandFact.pathed`. */
    pathed?: boolean
    /** See `ExecCommandFact.assigns`. */
    assigns?: boolean
    class: "known" | "unknown"
  }>

  export type RemoteFact = Readonly<{
    scheme?: string
    host?: string
    port?: number
    /** Whether the destination is an exact, bounded, public host. */
    bounded: boolean
  }>

  export type Containment = Readonly<{
    sandbox: "off" | "unavailable" | "unknown" | "operational" | "failed"
    network: "allow" | "deny" | "proxy"
    destinations: readonly string[]
    escalated: boolean
    /**
     * Whether the execution profile grants write access beyond its own built-in roots. A configured
     * extra writable path is exactly the case where a proven sandbox still does not bound the call,
     * so it is reported as a fact rather than a path.
     */
    widened?: boolean
  }>

  export type Requirement = "sandbox" | "restricted_network"

  export type Input = Readonly<{
    version: 1
    action: Readonly<{
      kind: string
      operation: string
      paths: readonly PathFact[]
      exec?: ExecFact
      remote?: RemoteFact
    }>
    baseline: Readonly<{ decision: "allow" | "ask"; authority: Authority; humanOnly: boolean }>
    metadata: Readonly<{ complete: boolean; truncated: boolean }>
    containment: Containment
  }>

  export type Result = Readonly<{
    decision: Decision
    reason: string
    rule_id: string
    requirements: readonly Requirement[]
    reviewable: boolean
  }>
}
