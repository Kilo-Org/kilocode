import path from "path"
import { createHash } from "crypto"
import { readFileSync, statSync } from "fs"
import { Cause, Effect, Exit } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Config } from "@/config/config"
import * as Permission from "@/permission"
import type * as Tool from "@/tool/tool"
import { ConfigProtection } from "@/kilocode/permission/config-paths"
import type { PermissionProvenance } from "@/kilocode/permission/provenance"
import { Decision } from "./decision"
import { SecurityDeniedError } from "./error"
import { SecurityEngine } from "./engine"
import { SecurityFlag } from "./flag"
import { SecurityKeys } from "./keys"
import { PathRisk } from "./path"
import { ShellNormalizer } from "./shell"
import { PackageMetadata } from "./package/metadata"
import { PackageOperation } from "./package/operation"
import { PackageRiskEvaluator } from "./package/evaluator"
import { SecuritySessionState } from "./state/store"
import { EgressGuard } from "./state/egress"
import { SecretContent } from "./state/content"
import { SemanticEvidence } from "./classifier/layers"
import { RiskExplanation } from "./classifier/explain"
import { defaultProvider as classifierProvider } from "./classifier/provider"
import { ToolAuthority } from "./tool/authority"
import { ToolCapability } from "./tool/capability"
import type {
  FileEffect,
  McpIdentity,
  NormalizedAction,
  NormalizedPath,
  SecurityContext,
  SecurityDecision,
  SecurityEvidence,
  ToolDescriptor,
  ToolInvocation,
  ToolProvenance,
} from "./types"

/**
 * Integration of the security engine with Kilo's permission and execution pipeline.
 *
 * - `evaluate` turns a permission request into a normalised action and asks the engine.
 * - `apply` folds the decision into the request that reaches `Permission.ask`: DENY never reaches
 *   it, a hard ASK forces an interactive prompt, ALLOW only lifts the default ask, a soft ASK leaves
 *   the existing rules in charge.
 * - `execute` wraps tool execution: tools without their own permission ask get an envelope ask, and
 *   a security denial becomes a structured non-fatal result.
 *
 * With the feature flag off every function is a pass-through and behaviour is unchanged.
 */
export namespace SecurityGate {
  const log = Log.create({ service: "security" })

  export interface Options {
    enabled: boolean
    sandboxed: boolean
    workspace: { directory: string; worktree: string }
    /**
     * Evidence layers above the deterministic engine. Absent means "engine only", so callers that
     * build options by hand keep that behaviour; {@link options} fills it from the global config
     * (all on by default).
     */
    layers?: SecurityFlag.Layers
    /** Tool capabilities the user vouches for, from the global config. */
    declarations?: ToolCapability.Declarations
  }

  export type Request = Omit<PermissionV1.Request, "id" | "tool" | "sessionID"> & {
    sessionID?: string
    /** Tool call the ask belongs to; lets the session-state layer link an ask to its execution. */
    tool?: { messageID: string; callID: string }
    /**
     * Identity and arguments of the tool call this ask belongs to. Deliberately
     * *not* part of `metadata`: the arguments stay in process and never reach the permission record,
     * client events, logs or audit. Absent when the mode or the tool layer is off.
     */
    security?: ToolInvocation
  }

  export interface Summary {
    decision: SecurityDecision["action"]
    hard: boolean
    reasonCode: SecurityDecision["reasonCode"]
    message: string
    rules: string[]
    /** One plain sentence for the person being asked. Presentation only. */
    explanation?: string
  }

  /**
   * Tools that never have side effects, and tools that call `ctx.ask` themselves before their side
   * effect: both need no envelope ask. Derived from the capability table so the classification lives
   * in exactly one place — a tool cannot be added to the table and forgotten here, or listed here
   * without a classification.
   */
  const READONLY = ToolCapability.READONLY
  const ASKING = ToolCapability.ASKING

  export const options = Effect.fn("SecurityGate.options")(function* (input: {
    config: Pick<Config.Interface, "getGlobal">
    sandboxed: boolean
    workspace: { directory: string; worktree: string }
  }) {
    const enabled = yield* SecurityFlag.enabled(input.config)
    const layers: SecurityFlag.Layers = enabled
      ? yield* SecurityFlag.layers(input.config)
      : { packages: false, egress: false, tools: false, content: false, code: false, runtime: false, classifier: false }
    const declarations = enabled && layers.tools ? yield* SecurityFlag.declarations(input.config) : []
    const result: Options = { enabled, sandboxed: input.sandboxed, workspace: input.workspace, layers, declarations }
    return result
  })

  /**
   * Build the security descriptor for a tool call. Called at each execution site, where the tool's
   * structural provenance is known; returns nothing when the mode or the tool layer is off, so a
   * disabled feature adds no field to any request.
   */
  export function describe(input: {
    tool: string
    provenance: ToolProvenance
    args: unknown
    options: Options
    mcp?: McpIdentity
    hints?: ToolDescriptor["hints"]
  }): ToolInvocation | undefined {
    if (!input.options.enabled || input.options.layers?.tools !== true) return undefined
    const args = typeof input.args === "object" && input.args !== null ? (input.args as Record<string, unknown>) : {}
    try {
      const descriptor = ToolCapability.resolve({
        tool: input.tool,
        provenance: input.provenance,
        declarations: input.options.declarations,
        ...(input.mcp ? { mcp: input.mcp } : {}),
        ...(input.hints ? { hints: input.hints } : {}),
      })
      return { descriptor, args }
    } catch {
      // Failing to classify is uncertainty, never permission: fall back to the most conservative
      // descriptor rather than dropping the layer (which would leave the call unclassified).
      return {
        descriptor: {
          tool: input.tool,
          provenance: "unknown",
          capabilities: [],
          source: "unknown",
          asks: false,
        },
        args,
      }
    }
  }

  /**
   * Provenance label for a tool *result* (§tool-result provenance). Audit only:
   * it records that the content in this result came from outside Kilo. No content is inspected,
   * rewritten or filtered, and nothing reads this label as policy today.
   *
   * Takes only the provenance, not the whole descriptor: a built-in tool can fetch content from
   * somewhere else (the MCP resource tools do), and there the label belongs to the *content*'s origin
   * rather than to the tool that went and got it.
   */
  export function resultProvenance(descriptor: Pick<ToolDescriptor, "provenance"> | undefined): string | undefined {
    if (!descriptor) return undefined
    switch (descriptor.provenance) {
      case "builtin":
        return undefined
      case "mcp-remote":
        return "remote-untrusted"
      case "mcp-local":
        return "mcp-untrusted"
      case "trusted-config":
        return "config-untrusted"
      case "plugin":
        return "plugin-untrusted"
      default:
        return "workspace-untrusted"
    }
  }

  export function summary(decision: SecurityDecision): Summary {
    return {
      decision: decision.action,
      hard: decision.hard,
      reasonCode: decision.reasonCode,
      message: decision.message,
      rules: [...new Set(decision.evidence.map((item) => item.rule))],
      ...(decision.explanation ? { explanation: decision.explanation } : {}),
    }
  }

  /**
   * Instrumentation seam for the benchmark / evaluation harness only. It observes decisions that the
   * gate has *already made*; it can neither change a decision nor be reached on the normal code path
   * (no observer is registered unless the harness installs one). Kept here rather than in the harness
   * so the measured security-decision latency is exactly the engine's, with no wrapper overhead.
   */
  export interface Observation {
    sessionID: string
    permission: string
    decision: SecurityDecision["action"]
    hard: boolean
    reasonCode: SecurityDecision["reasonCode"]
    rules: string[]
    /** Wall-clock cost of normalisation + engine evaluation, in milliseconds. */
    durationMs: number
    fromEnvelope: boolean
    /**
     * The semantic layer's verdict, when one contributed to this decision.
     *
     * A tally of verdicts says how the layer behaves in aggregate; this says which *decision* each one
     * changed, which is the only way to ask why a particular safe action was escalated. Reported, not
     * consulted: nothing downstream of the fold reads it.
     */
    advisory?: { category: string; risk: string; confidence: string }
  }

  let observer: ((observation: Observation) => void) | undefined

  /** Register a decision observer; returns a disposer that restores the previous one. */
  export function observe(fn: (observation: Observation) => void): () => void {
    const previous = observer
    observer = fn
    return () => {
      if (observer === fn) observer = previous
    }
  }

  function report(observation: Observation) {
    const current = observer
    if (!current) return
    try {
      current(observation)
    } catch {
      // An instrumentation failure must never affect a security decision or the tool run.
    }
  }

  function text(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : undefined
  }

  function fingerprint(value: string) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16)
  }

  function collect(request: Request, ctx: SecurityContext, env: PathRisk.Env): NormalizedPath[] {
    const meta = request.metadata ?? {}
    const found = new Set<string>()
    const add = (value: unknown, base: string) => {
      if (typeof value !== "string" || value.length === 0) return
      const clean = value.replace(/[\\/]\*$/, "")
      found.add(path.isAbsolute(clean) ? clean : path.resolve(base, clean))
    }
    const filepath = text(meta.filepath)
    if (filepath) {
      for (const part of filepath.includes(", ") ? filepath.split(", ") : [filepath]) add(part, ctx.workspace.worktree)
    }
    if (Array.isArray(meta.files)) {
      for (const file of meta.files) {
        if (typeof file !== "object" || file === null) continue
        add((file as Record<string, unknown>).filePath, ctx.workspace.worktree)
        add((file as Record<string, unknown>).movePath, ctx.workspace.worktree)
      }
    }
    // parentDir / directories only widen the permission pattern; the target is the file itself.
    if (found.size === 0) add(meta.parentDir, ctx.workspace.worktree)
    if (found.size === 0 && Array.isArray(meta.directories))
      for (const dir of meta.directories) add(dir, ctx.workspace.worktree)
    if (found.size === 0) for (const pattern of request.patterns) add(pattern, ctx.workspace.worktree)
    return [...found].map((value) => PathRisk.classify(value, ctx.cwd, env))
  }

  const normalize = Effect.fn("SecurityGate.normalize")(function* (
    request: Request,
    ctx: SecurityContext,
    env: PathRisk.Env,
  ) {
    const meta = request.metadata ?? {}
    const command = text(meta.command)
    if (request.permission === "sandbox_escalation") {
      return {
        kind: "permission",
        permission: request.permission,
        patterns: [...request.patterns],
      } satisfies NormalizedAction
    }
    if (command !== undefined && (request.permission === "bash" || request.permission === "external_directory")) {
      const normalized = yield* ShellNormalizer.normalize({
        command,
        cwd: text(meta.cwd) ?? ctx.cwd,
        shell: text(meta.shell) ?? "/bin/bash",
        env,
      })
      return { kind: "shell", permission: request.permission, command: normalized } satisfies NormalizedAction
    }
    const mcp = request.patterns.every((pattern) => pattern.startsWith("mcp:"))
    if (
      (request.permission === "edit" || request.permission === "read" || request.permission === "external_directory") &&
      !mcp
    ) {
      // A file tool's external_directory ask only says "the path is outside the workspace"; the
      // tool-specific edit/read ask that follows carries the real effect, so evaluate the boundary
      // crossing as a read and let the next ask apply the write rules.
      const effect: FileEffect = request.permission === "edit" ? "write" : "read"
      // The read tool lists the parent directory as a second pattern for rule matching; only the
      // first pattern is the file being read.
      const paths =
        request.permission === "read"
          ? collect({ ...request, patterns: request.patterns.slice(0, 1) }, ctx, env)
          : collect(request, ctx, env)
      return { kind: "file", permission: request.permission, effect, paths } satisfies NormalizedAction
    }
    return {
      kind: "permission",
      permission: request.permission,
      patterns: [...request.patterns],
    } satisfies NormalizedAction
  })

  const PROJECT_FILE_LIMIT = 256 * 1024

  /** Bounded, synchronous read of a project file (package.json, .npmrc) for the package preflight. */
  function projectFile(file: string): string | undefined {
    try {
      const stat = statSync(file)
      if (!stat.isFile() || stat.size > PROJECT_FILE_LIMIT) return undefined
      return readFileSync(file, "utf8")
    } catch {
      return undefined
    }
  }

  /**
   * Package provenance preflight. Runs only for shell actions that contain a recognised package
   * install / exec, after the deterministic rules, and only when they did not already deny.
   * Returns evidence for the engine's monotonic reducer; never fails (evaluator errors are uncertainty).
   */
  const packageEvidence = Effect.fn("SecurityGate.packageEvidence")(function* (
    action: NormalizedAction,
    base: SecurityDecision,
    ctx: SecurityContext,
  ) {
    if (action.kind !== "shell" || base.action === "deny") return [] as SecurityEvidence[]
    const operations = PackageOperation.collect(action.command)
    if (operations.length === 0) return [] as SecurityEvidence[]
    const result = yield* PackageRiskEvaluator.evaluate({
      operations,
      provider: PackageMetadata.provider(),
      readFile: projectFile,
      cwd: ctx.cwd,
    })
    return result.evidence
  })

  /** Evaluate a permission request. Never fails: any internal error is a hard ASK. */
  /**
   * The sanitized record an explanation is written from.
   *
   * It names the operand the decision is *about* — the one whose classification is least ordinary —
   * by base name only, plus the class of place it lives in. No command line, no directory, no
   * contents. A model shown this cannot disclose anything it was not shown.
   */
  /**
   * Run one synchronous evidence layer in isolation.
   *
   * A layer that throws — on malformed content, on a shape it did not expect, on a bug of its own —
   * contributes the engine-failure evidence and nothing else. The layers after it still run, and the
   * failure still folds in as a hard ASK. An exception inside the security subsystem can therefore
   * add friction and never remove any. Before this, the first layer to throw took every layer after
   * it down with it, and the whole evaluation with them.
   */
  function isolate(layer: string, produce: () => SecurityEvidence[]): SecurityEvidence[] {
    try {
      return produce()
    } catch (err) {
      log.error("layer failed", { layer, error: err instanceof Error ? err.name : "Error" })
      return [Decision.failed(err)]
    }
  }

  /** The same, for a layer that runs as an Effect: its `Exit` carries failures and defects alike. */
  function guarded(layer: string, exit: Exit.Exit<SecurityEvidence[], unknown>): SecurityEvidence[] {
    if (Exit.isSuccess(exit)) return exit.value
    const err = Cause.squash(exit.cause)
    log.error("layer failed", { layer, error: err instanceof Error ? err.name : "Error" })
    return [Decision.failed(err)]
  }

  function explanationFacts(
    decision: SecurityDecision,
    action: NormalizedAction,
    sessionID: string,
  ): RiskExplanation.Facts {
    const operands =
      action.kind === "shell"
        ? action.command.commands.flatMap((process) => process.operands)
        : action.kind === "file"
          ? action.paths.map((value) => ({ path: value, effect: action.effect }))
          : []
    // Prefer a labelled or non-workspace operand: that is what the decision is usually about. Then a
    // file being *read*, because an outbound command lists both what it sends and where it writes the
    // reply, and naming the reply file in a sentence about sending data is simply wrong — the notice
    // for a README-driven upload used to say `curl.out`.
    const chosen =
      operands.find((operand) => operand.path.labels.length > 0) ??
      operands.find((operand) => operand.path.relation !== "workspace") ??
      operands.find((operand) => operand.effect === "read") ??
      operands[0]
    const store =
      chosen && chosen.path.relation === "home-sensitive"
        ? chosen.path.canonical
            .split("/")
            .find((part) => part.startsWith(".") && part.length > 1)
            ?.slice(1)
            .toLowerCase()
        : undefined
    const semantic = decision.evidence.find((item) => item.rule.startsWith("advisory.semantic."))
    return {
      reasonCode: decision.reasonCode,
      decision: decision.action,
      hard: decision.hard,
      ...(chosen ? { subject: chosen.path.canonical.split("/").pop() ?? "", relation: chosen.path.relation } : {}),
      ...(store ? { store } : {}),
      network: action.kind === "shell" && action.command.commands.some((process) => process.network),
      readSecret: SecuritySessionState.hasSecretContext(sessionID),
      ...(typeof semantic?.attributes?.["category"] === "string" ? { semantic: semantic.attributes["category"] } : {}),
    }
  }

  export const evaluate = Effect.fn("SecurityGate.evaluate")(function* (input: {
    request: Request
    options: Options
    sessionID: string
    agent: string
  }) {
    const ctx: SecurityContext = {
      sessionID: input.sessionID,
      agent: input.agent,
      workspace: input.options.workspace,
      cwd: input.options.workspace.directory,
      home: Global.Path.home,
      sandbox: { enabled: input.options.sandboxed },
    }
    const layers = input.options.layers ?? {
      packages: false,
      egress: false,
      tools: false,
      content: false,
      code: false,
      runtime: false,
      classifier: false,
    }
    // Build the provider as soon as the layer is on, not at the first decision that wants a verdict:
    // constructing it starts the model graph loading, and until that finishes the layer answers
    // nothing. Safe either way — an unconfigured provider is `undefined` and nothing happens.
    if (layers.classifier) classifierProvider()
    const callID = input.request.tool?.callID
    const started = performance.now()
    /**
     * The strictest decision this evaluation actually reached, kept outside the scope that computes
     * it. Anything below can fail — a parser, a layer, a provider, a defect in code that has nothing
     * to do with the action — and the failure is then folded into what was already established
     * instead of replacing it. Without this, a DENY reached in the first line was still reversible
     * by a crash in the last one.
     */
    let reached: SecurityDecision | undefined
    const reach = (next: SecurityDecision) => {
      reached = next
      return next
    }
    const exit = yield* Effect.exit(
      Effect.gen(function* () {
        const env = PathRisk.env({ workspace: input.options.workspace, home: ctx.home })
        const action = yield* normalize(input.request, ctx, env)
        let decision = reach(SecurityEngine.evaluate(action, ctx))
        if (layers.packages) {
          const packages = yield* Effect.exit(packageEvidence(action, decision, ctx))
          decision = reach(SecurityEngine.extend(decision, guarded("packages", packages)))
        }
        if (layers.egress) {
          // Record what this call would read/taint, keyed by the tool call so it is committed only
          // when the call succeeds (see `execute`); fold the egress evidence in monotonically.
          const egress = isolate("egress", () => {
            const assessment = EgressGuard.assess({
              action,
              sessionID: input.sessionID,
              ...(layers.content ? { readFile: contentSource } : {}),
            })
            if (callID !== undefined) SecuritySessionState.recordPending(input.sessionID, callID, assessment.pending)
            return assessment.evidence
          })
          decision = reach(SecurityEngine.extend(decision, egress))
        }
        if (layers.tools && input.request.security) {
          // Delegated authority: what the tool is allowed to do, who wrote it, and what its arguments
          // touch. Folded through the same reducer, so it can only tighten earlier decisions.
          const invocation = input.request.security
          const authority = isolate("tools", () => {
            const assessment = ToolAuthority.assess({
              invocation,
              ctx,
              env,
              sessionID: input.sessionID,
              ...(layers.content ? { readFile: contentSource } : {}),
            })
            if (callID !== undefined) SecuritySessionState.recordPending(input.sessionID, callID, assessment.pending)
            return assessment.evidence
          })
          decision = reach(SecurityEngine.extend(decision, authority))
        }
        if (layers.classifier && SemanticEvidence.considers({ decision, action, sessionID: input.sessionID })) {
          // Last, and only for what the deterministic layers left unsettled. It travels through the
          // same monotone reducer as every other layer, which is what makes "the model cannot open
          // anything up" a property of the fold rather than a promise in a comment.
          const advisory = yield* Effect.exit(
            SemanticEvidence.assess({
              provider: classifierProvider(),
              summary: SemanticEvidence.summarize(action, input.sessionID),
              timeoutMs: SecurityFlag.classifierTimeoutMs(),
            }),
          )
          decision = reach(SecurityEngine.extend(decision, guarded("classifier", advisory)))
        }
        // The decision is final here. What follows is presentation: a sentence for whoever is about
        // to be asked. It reads the decision and writes nothing back into it.
        if (decision.action !== "allow") {
          const facts = explanationFacts(decision, action, input.sessionID)
          // A model is asked to improve the sentence only where a person is certain to read it: a
          // hard ask stops an unattended run, and a denial is reported back. A soft ask may be
          // satisfied by an existing permission rule without anyone ever seeing a prompt, and paying
          // a second remote call on every one of those buys latency and nothing else. The
          // deterministic sentence is written either way, so no decision loses its explanation.
          const shown = decision.hard || decision.action === "deny"
          // The person reading the notice is the person who typed the request, so their own words go
          // along as a language sample — redacted, bounded, and never the untrusted text.
          const goal = SecuritySessionState.goalOf(input.sessionID)
          // Presentation must never be able to move a decision, so it is not merely expected to
          // succeed — its failure is caught here and answered with the deterministic sentence. A
          // provider that throws synchronously used to escape as a defect, fail this whole scope,
          // and turn a DENY that had already been reached into a hard ask.
          const written = yield* Effect.exit(
            RiskExplanation.generate({
              provider: layers.classifier && shown ? classifierProvider() : undefined,
              facts,
              timeoutMs: SecurityFlag.classifierTimeoutMs(),
              ...(goal ? { request: SemanticEvidence.redact(goal) } : {}),
            }),
          )
          decision = {
            ...decision,
            explanation: Exit.isSuccess(written) ? written.value : RiskExplanation.template(facts),
          }
        }
        return decision
      }),
    )
    const durationMs = performance.now() - started
    const decision = Exit.isSuccess(exit) ? exit.value : Decision.failure(Cause.squash(exit.cause), reached)
    const advisory = decision.evidence.find((item) => item.attributes?.["advisory"] === true)?.attributes
    report({
      sessionID: input.sessionID,
      permission: input.request.permission,
      decision: decision.action,
      hard: decision.hard,
      reasonCode: decision.reasonCode,
      rules: [...new Set(decision.evidence.map((item) => item.rule))],
      durationMs,
      fromEnvelope: input.request.metadata?.[SecurityKeys.ENVELOPE] === true,
      ...(advisory
        ? {
            advisory: {
              category: String(advisory["category"]),
              risk: String(advisory["risk"]),
              confidence: String(advisory["confidence"]),
            },
          }
        : {}),
    })
    const command = text(input.request.metadata?.command)
    log.info("decision", {
      permission: input.request.permission,
      decision: decision.action,
      hard: decision.hard,
      reason: decision.reasonCode,
      rules: [...new Set(decision.evidence.map((item) => item.rule))].join(","),
      sandbox: input.options.sandboxed,
      ...(command ? { fingerprint: fingerprint(command) } : {}),
    })
    return decision
  })

  function liftable(rule: Permission.Rule) {
    const source = (rule as PermissionProvenance.SourcedRule).source
    return rule.action === "ask" && (source === undefined || source === "agent")
  }

  /**
   * Fold a decision into the request. The caller must have handled DENY already (it never reaches
   * `Permission.ask`). A hard ASK forces an interactive prompt that no saved or configured allow rule
   * can satisfy; ALLOW lifts only the default ask (built-in or unmatched) and leaves explicit user,
   * project and session rules untouched; a soft ASK changes nothing.
   */
  export function apply<T extends Request>(input: {
    request: T
    ruleset: Permission.Ruleset
    decision: SecurityDecision
  }): { request: T; ruleset: Permission.Ruleset } {
    const decision = input.decision
    const meta = { ...input.request.metadata, [SecurityKeys.META]: summary(decision) }
    if (decision.action === "ask" && decision.hard) {
      return {
        request: {
          ...input.request,
          metadata: { ...meta, [SecurityKeys.ASK]: true, [ConfigProtection.DISABLE_ALWAYS_KEY]: true },
        },
        ruleset: input.ruleset,
      }
    }
    if (decision.action !== "allow") return { request: { ...input.request, metadata: meta }, ruleset: input.ruleset }
    const lifted: PermissionProvenance.SourcedRule[] = input.request.patterns
      .filter((pattern) => liftable(Permission.evaluate(input.request.permission, pattern, input.ruleset)))
      .map((pattern) => ({ permission: input.request.permission, pattern, action: "allow", source: "security" }))
    return { request: { ...input.request, metadata: meta }, ruleset: [...input.ruleset, ...lifted] }
  }

  /**
   * Bounded, synchronous read used at *decision* time to classify content an action would send.
   * Smaller cap than {@link secretSource}: this runs before an outbound action, not after a
   * completed read.
   */
  function contentSource(file: string): string | undefined {
    try {
      const stat = statSync(file)
      if (!stat.isFile() || stat.size > 1024 * 1024) return undefined
      return readFileSync(file, "utf8")
    } catch {
      return undefined
    }
  }

  /** Read a file's contents to fingerprint its secret values, on a committed sensitive read. */
  function secretSource(file: string): string | undefined {
    try {
      const stat = statSync(file)
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return undefined
      return readFileSync(file, "utf8")
    } catch {
      return undefined
    }
  }

  /**
   * Where the text a completed call returned actually came from — who wrote the words, not what kind
   * of resource the path names.
   *
   * The deterministic layers never ask this. To the path classifier a project README, a dependency's
   * README and a saved web page are all "ordinary workspace content"; all three are written by
   * somebody who is not the user, and that is the only fact that matters for indirect injection.
   *
   * Returns nothing when the call's output cannot be attributed to a source. A bash command whose
   * read targets are unknown is not recorded: an unattributable excerpt would inflate the semantic
   * layer's call rate without telling it anything about provenance.
   */
  function ingestSource(input: {
    tool: string
    provenance: ToolProvenance | undefined
    candidates: { canonical: string }[]
  }): { source: SecuritySessionState.ContentSource; name: string } | undefined {
    if (input.provenance === "mcp-local" || input.provenance === "mcp-remote")
      return { source: "mcp", name: input.tool }
    if (input.tool === "webfetch" || input.tool === "websearch") return { source: "web", name: input.tool }
    // Exactly one: with several reads in one call the excerpt cannot be attributed to either.
    const only = input.candidates.length === 1 ? input.candidates[0].canonical : undefined
    if (only === undefined) {
      if (input.provenance === "workspace" || input.provenance === "plugin") return { source: "tool", name: input.tool }
      return undefined
    }
    const lower = only.toLowerCase()
    const name = only.split(/[\\/]/).at(-1) ?? only
    const source: SecuritySessionState.ContentSource = lower.includes("/node_modules/")
      ? "dependency"
      : lower.endsWith(".ipynb")
        ? "notebook"
        : lower.includes("/.kilocode/skills/") || name.toUpperCase() === "SKILL.MD"
          ? "skill"
          : lower.includes("/.github/workflows/") ||
              lower.includes("/.circleci/") ||
              /^(dockerfile|makefile|\.gitlab-ci\.yml|docker-compose\.ya?ml)$/i.test(name)
            ? "ci-config"
            : /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|h|cc|cpp|swift|kt|scala)$/i.test(lower)
              ? "source-comment"
              : "workspace-file"
    return { source, name }
  }

  /**
   * Classify the content a completed call actually returned. A session becomes
   * sensitive from *observed* content, never from a filename and never from a refused request, so this
   * runs only on the success path with the output the agent really received.
   *
   * Returns nothing when the content earns no label — including when classification fails, which
   * leaves whatever sensitivity the session already had untouched rather than clearing it.
   */
  function observeContent(input: {
    text: string | undefined
    tool: string
    sessionID: string
    callID: string
  }): SecuritySessionState.Observed | undefined {
    if (!input.text) return undefined
    const candidates = SecuritySessionState.pendingCandidates(input.sessionID, input.callID)
    // Only name the source file when the call read exactly one: with several, a per-file rule (skipping
    // structurally noisy files) could not be attributed correctly.
    const file = candidates.length === 1 ? candidates[0]!.canonical : undefined
    const result = SecretContent.classify(input.text, file ? { file } : {})
    if (result.labels.length === 0) return undefined
    return {
      labels: result.labels,
      values: result.values,
      kinds: [...new Set(result.findings.map((item) => item.kind))],
      source: `tool:${input.tool}`,
    }
  }

  /**
   * Execution gate. Tools that are not known to ask for permission themselves get an envelope ask so
   * they are evaluated (unclassified tools stay governed by the existing rules); a security denial
   * raised anywhere inside the tool becomes a structured, non-fatal result.
   *
   * When the egress layer is on it also commits the session-state observations recorded at ask time:
   * a tool that ran successfully really obtained what it read (so its values enter the session's
   * secret set), while a blocked or failed tool discards them — a credential the agent was refused
   * never becomes "secret context".
   */
  export function execute<A extends Tool.ExecuteResult, E, R>(
    input: { ctx: Tool.Context; tool: string; options: Options; invocation?: ToolInvocation },
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A | Tool.ExecuteResult, E, R> {
    if (!input.options.enabled) return effect
    const callID = input.ctx.callID
    const sessionID = input.ctx.sessionID
    // A tool that Kilo did not ship cannot be trusted to ask for permission on its own, and cannot be
    // trusted to report honestly that it was blocked. Both facts follow from provenance alone.
    const trusted = input.invocation === undefined || input.invocation.descriptor.provenance === "builtin"
    const settle = (committed: boolean, output?: string) =>
      Effect.sync(() => {
        if (callID === undefined) return
        if (committed && input.options.layers?.classifier && output) {
          // Remember *what the agent was told*, not just what it obtained. Bounded, attributed, and
          // recorded only on the success path — text from a refused call was never read. This is the
          // classifier's own input, so it is recorded whenever that layer is on: switching the
          // stateful egress protection off narrows what is guarded, it does not blind the classifier.
          const attributed = ingestSource({
            tool: input.tool,
            provenance: input.invocation?.descriptor.provenance,
            candidates: SecuritySessionState.pendingCandidates(sessionID, callID),
          })
          if (attributed) SecuritySessionState.recordIngested(sessionID, { ...attributed, excerpt: output })
        }
        if (!input.options.layers?.egress) return
        if (!committed) return SecuritySessionState.discard(sessionID, callID)
        const observed = input.options.layers.content
          ? observeContent({ text: output, tool: input.tool, sessionID, callID })
          : undefined
        SecuritySessionState.commit(sessionID, callID, secretSource, observed)
      })
    // Tool-id shadowing: a workspace or plugin tool may call itself `read` or `list`. The envelope is
    // skipped only for a genuine built-in, so borrowing a built-in's name buys nothing.
    const envelope =
      trusted && (READONLY.has(input.tool) || ASKING.has(input.tool))
        ? Effect.void
        : input.ctx.ask({
            permission: input.tool,
            patterns: ["*"],
            always: ["*"],
            metadata: { [SecurityKeys.ENVELOPE]: true },
          })
    return envelope.pipe(
      Effect.andThen(effect),
      Effect.tap((result) => {
        // A built-in tool may convert a denial into a structured blocked result rather than failing; a
        // blocked result means the side effect did not happen, so discard rather than commit. The same
        // marker from a tool Kilo did not ship is just tool-controlled text: honouring it would let a
        // custom tool read a credential and then declare itself blocked to erase the session's record.
        const security = (result.metadata as { security?: { status?: string } } | undefined)?.security
        const claimed = security?.status === "blocked" || result.title === "Blocked by security policy"
        const blocked = claimed && trusted
        return settle(!blocked, blocked ? undefined : result.output)
      }),
      Effect.catchCause((cause) => {
        const err = Cause.squash(cause)
        if (!SecurityDeniedError.isInstance(err)) return settle(false).pipe(Effect.andThen(Effect.failCause(cause)))
        log.info("blocked", { tool: input.tool, reason: err.reasonCode })
        return settle(false).pipe(Effect.as(err.result(input.tool)))
      }),
    )
  }

  /**
   * Execution gate for a delegated (MCP) call. Such a call asks for permission explicitly, so it gets
   * no envelope ask; what it gains here is the rest of the envelope's job: the session-state settle,
   * and turning a security denial into a structured result the agent can read instead of a defect
   * that ends the turn.
   */
  export function delegate<A, E, R>(
    input: {
      ctx: Tool.Context
      tool: string
      options: Options
      /** Text of the delegated result, for content classification. */
      output?: (value: A) => string | undefined
    },
    blocked: (error: SecurityDeniedError) => A,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> {
    if (!input.options.enabled) return effect
    const callID = input.ctx.callID
    const sessionID = input.ctx.sessionID
    const settle = (committed: boolean, output?: string) =>
      Effect.sync(() => {
        if (callID === undefined) return
        if (committed && input.options.layers?.classifier && output) {
          // Remember *what the agent was told*, not just what it obtained. Bounded, attributed, and
          // recorded only on the success path — text from a refused call was never read.
          // A delegated result is untrusted by construction: it was produced outside Kilo.
          SecuritySessionState.recordIngested(sessionID, { source: "mcp", name: input.tool, excerpt: output })
        }
        if (!input.options.layers?.egress) return
        if (!committed) return SecuritySessionState.discard(sessionID, callID)
        const observed = input.options.layers.content
          ? observeContent({ text: output, tool: input.tool, sessionID, callID })
          : undefined
        SecuritySessionState.commit(sessionID, callID, secretSource, observed)
      })
    return effect.pipe(
      Effect.tap((value) => settle(true, input.output?.(value))),
      Effect.catchCause((cause) => {
        const err = Cause.squash(cause)
        if (!SecurityDeniedError.isInstance(err)) return settle(false).pipe(Effect.andThen(Effect.failCause(cause)))
        log.info("blocked", { tool: input.tool, reason: err.reasonCode })
        return settle(false).pipe(Effect.as(blocked(err)))
      }),
    )
  }
}
