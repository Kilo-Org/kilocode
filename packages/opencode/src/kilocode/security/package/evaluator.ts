import path from "path"
import { Effect } from "effect"
import { evidence as makeEvidence } from "../decision"
import type { SecurityEvidence } from "../types"
import { PackageMetadata } from "./metadata"
import { PackageOperation } from "./operation"
import { PackageSimilarity } from "./similarity"

/**
 * Turns package operations plus registry metadata into structured security evidence.
 *
 * The evaluator does not own a policy of its own: it emits {@link SecurityEvidence} that the existing
 * engine folds into its monotonic reducer (DENY > ASK > ALLOW), so it can only tighten a decision.
 * Every conclusion is backed by named signals of three kinds:
 * - deterministic: facts read from the command line or the registry record (age, scripts, source);
 * - heuristic: adoption and look-alike names, which suggest but do not prove;
 * - uncertainty: what could not be established (metadata unavailable, unparsable operand).
 * Uncertainty never resolves to ALLOW: "the registry did not answer" is a reason to ask, not to proceed.
 *
 * Thresholds are internal to this module; evidence messages carry the observed facts (published 3
 * days ago, 12 weekly downloads, declares postinstall) rather than the cut-offs.
 */
export namespace PackageRiskEvaluator {
  export const THRESHOLDS = {
    /** A package created more recently than this is "new". */
    newPackageDays: 30,
    /** A release published more recently than this on an established package is "fresh". */
    newVersionDays: 7,
    /** Weekly downloads below this count as low adoption. */
    lowAdoptionWeekly: 500,
    establishedDays: 180,
    establishedWeekly: 1_000,
    matureDays: 365,
    matureWeekly: 10_000,
    /** Direct dependencies assessed for a manifest install; the rest are reported as unassessed. */
    maxManifestDependencies: 40,
    /** Registry lookups per evaluation; beyond this the remainder is reported as unassessed. */
    maxLookups: 48,
  } as const

  export type SignalKind = "deterministic" | "heuristic" | "uncertainty"

  export type SignalId =
    | "metadata-unavailable"
    | "not-found"
    | "ambiguous-spec"
    | "version-unresolved"
    | "age-unknown"
    | "adoption-unknown"
    | "unassessed-dependencies"
    | "non-registry-source"
    | "registry-override"
    | "manifest-lifecycle"
    | "new-package"
    | "new-version"
    | "lifecycle-scripts"
    | "no-repository"
    | "deprecated"
    | "low-adoption"
    | "similar-name"
    | "fresh-release"

  export interface Signal {
    id: SignalId
    kind: SignalKind
    /** Human readable fact, e.g. "published 3 days ago". Never contains thresholds. */
    detail: string
    data?: Record<string, string | number | boolean>
  }

  export type Tier = "new" | "young" | "established" | "mature" | "unknown"

  export interface Verdict {
    action: "allow" | "ask" | "deny"
    hard: boolean
    reasonCode: SecurityEvidence["reasonCode"]
    rule: string
    message: string
  }

  export interface Assessment {
    name: string
    requested?: string
    resolvedVersion?: string
    via: "explicit" | "manifest" | "exec"
    manager: PackageOperation.Manager
    tier: Tier
    signals: Signal[]
    verdict: Verdict
  }

  export interface Input {
    operations: PackageOperation.Operation[]
    provider: PackageMetadata.Provider
    now?: () => Date
    /** Reads a project file (package.json, .npmrc); undefined when absent / unreadable. */
    readFile?: (file: string) => string | undefined
    /** Fallback working directory for manifest reads when the process cwd is unknown. */
    cwd?: string
  }

  export interface Result {
    assessments: Assessment[]
    evidence: SecurityEvidence[]
    lookups: number
  }

  const DAY = 86_400_000

  function daysAgo(now: Date, iso: string | undefined): number | undefined {
    if (!iso) return undefined
    const time = Date.parse(iso)
    if (Number.isNaN(time)) return undefined
    return Math.max(0, Math.floor((now.getTime() - time) / DAY))
  }

  function plural(count: number, unit: string) {
    return `${count} ${unit}${count === 1 ? "" : "s"}`
  }

  function age(days: number) {
    if (days < 60) return `${plural(days, "day")} ago`
    if (days < 730) return `${plural(Math.floor(days / 30), "month")} ago`
    return `${plural(Math.floor(days / 365), "year")} ago`
  }

  function tierOf(ageDays: number | undefined, downloads: number | undefined): Tier {
    if (ageDays === undefined) return "unknown"
    if (ageDays < THRESHOLDS.newPackageDays) return "new"
    if (downloads === undefined) return ageDays < THRESHOLDS.establishedDays ? "young" : "unknown"
    if (ageDays >= THRESHOLDS.matureDays && downloads >= THRESHOLDS.matureWeekly) return "mature"
    if (ageDays >= THRESHOLDS.establishedDays && downloads >= THRESHOLDS.establishedWeekly) return "established"
    return "young"
  }

  function trusted(tier: Tier) {
    return tier === "established" || tier === "mature"
  }

  function attributes(assessment: Assessment): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {
      package: assessment.name,
      manager: assessment.manager,
      via: assessment.via,
      tier: assessment.tier,
      signals: assessment.signals.map((signal) => signal.id).join(","),
    }
    if (assessment.resolvedVersion) out.version = assessment.resolvedVersion
    return out
  }

  function toEvidence(assessment: Assessment): SecurityEvidence {
    const verdict = assessment.verdict
    return makeEvidence({
      rule: verdict.rule,
      source: verdict.action === "allow" ? "default" : verdict.hard ? "hard" : "default",
      action: verdict.action,
      reasonCode: verdict.reasonCode,
      message: verdict.message,
      attributes: attributes(assessment),
    })
  }

  interface Context {
    now: Date
    provider: PackageMetadata.Provider
    budget: { lookups: number }
  }

  /** Assess one registry package: lookup, signals, verdict. Never fails. */
  function assess(
    ctx: Context,
    input: {
      name: string
      requested?: string
      via: Assessment["via"]
      manager: PackageOperation.Manager
      /** Code of this package runs during the operation (install scripts enabled, or exec). */
      executes: boolean
      /** The operation would run lifecycle scripts if the package declares them. */
      lifecycleEnabled: boolean
    },
  ): Effect.Effect<Assessment> {
    return Effect.gen(function* () {
      const signals: Signal[] = []
      const base = { name: input.name, requested: input.requested, via: input.via, manager: input.manager }
      const label = input.via === "exec" ? "Running" : "Installing"

      if (ctx.budget.lookups >= THRESHOLDS.maxLookups) {
        signals.push({ id: "unassessed-dependencies", kind: "uncertainty", detail: "lookup budget exhausted" })
        return {
          ...base,
          tier: "unknown",
          signals,
          verdict: {
            action: "ask",
            hard: true,
            reasonCode: "PACKAGE_UNVERIFIED",
            rule: "hard.pkg.unverified",
            message: `${input.name} could not be checked against the registry (too many packages in one command).`,
          },
        } satisfies Assessment
      }
      ctx.budget.lookups += 1
      const looked = yield* ctx.provider.lookup(input.name).pipe(Effect.exit)
      if (looked._tag === "Failure") {
        signals.push({ id: "metadata-unavailable", kind: "uncertainty", detail: "registry metadata unavailable" })
        return {
          ...base,
          tier: "unknown",
          signals,
          verdict: {
            action: "ask",
            hard: true,
            reasonCode: "PACKAGE_UNVERIFIED",
            rule: "hard.pkg.unverified",
            message: `${input.name} could not be verified: the registry metadata is unavailable.`,
          },
        } satisfies Assessment
      }
      const meta = looked.value
      if (!meta.found) {
        signals.push({ id: "not-found", kind: "deterministic", detail: "not published in the registry" })
        return {
          ...base,
          tier: "unknown",
          signals,
          verdict: {
            action: "ask",
            hard: true,
            reasonCode: "PACKAGE_UNVERIFIED",
            rule: "hard.pkg.not-found",
            message: `${input.name} is not published in the registry; the dependency name may be wrong or invented.`,
          },
        } satisfies Assessment
      }

      const ageDays = daysAgo(ctx.now, meta.createdAt)
      const resolved = PackageMetadata.resolve(meta, input.requested)
      const version = resolved.version ? meta.versions[resolved.version] : undefined
      const versionAgeDays = daysAgo(ctx.now, version?.publishedAt)
      const downloads = meta.weeklyDownloads
      const tier = tierOf(ageDays, downloads)
      const facts: string[] = []

      if (ageDays === undefined)
        signals.push({ id: "age-unknown", kind: "uncertainty", detail: "creation date unknown" })
      else if (tier === "new") {
        signals.push({
          id: "new-package",
          kind: "deterministic",
          detail: `published ${age(ageDays)}`,
          data: { ageDays },
        })
        facts.push(`was published ${age(ageDays)}`)
      }
      if (!resolved.resolved)
        signals.push({
          id: "version-unresolved",
          kind: "uncertainty",
          detail: `requested version "${input.requested}" could not be resolved statically`,
        })
      if (downloads === undefined)
        signals.push({ id: "adoption-unknown", kind: "uncertainty", detail: "download statistics unavailable" })
      const lowAdoption = downloads !== undefined && downloads < THRESHOLDS.lowAdoptionWeekly
      if (lowAdoption) {
        signals.push({
          id: "low-adoption",
          kind: "heuristic",
          detail: `${downloads} weekly downloads`,
          data: { downloads },
        })
        facts.push(`has ${downloads} weekly downloads`)
      }
      const scripts = version?.scripts ?? []
      const declaresScripts = scripts.length > 0
      if (declaresScripts) {
        signals.push({
          id: "lifecycle-scripts",
          kind: "deterministic",
          detail: `declares ${scripts.join(", ")}`,
          data: { scripts: scripts.join(",") },
        })
        facts.push(`declares ${scripts.length === 1 ? "an install script" : "install scripts"} (${scripts.join(", ")})`)
      }
      const similar = trusted(tier) ? undefined : PackageSimilarity.similar(input.name)
      if (similar) {
        signals.push({
          id: "similar-name",
          kind: "heuristic",
          detail: `resembles ${similar.target} (${similar.kind})`,
          data: { target: similar.target, kind: similar.kind },
        })
        facts.push(`resembles the well-known package ${similar.target}`)
      }
      const noRepository = !meta.repository && !trusted(tier)
      if (noRepository) {
        signals.push({ id: "no-repository", kind: "deterministic", detail: "no repository listed" })
        facts.push("lists no source repository")
      }
      if (version?.deprecated)
        signals.push({ id: "deprecated", kind: "deterministic", detail: "version is deprecated" })
      const freshRelease = trusted(tier) && versionAgeDays !== undefined && versionAgeDays < THRESHOLDS.newVersionDays
      if (freshRelease) {
        signals.push({
          id: "fresh-release",
          kind: "heuristic",
          detail: `version ${resolved.version} published ${age(versionAgeDays)}`,
          data: { versionAgeDays: versionAgeDays! },
        })
      }
      if (
        !trusted(tier) &&
        versionAgeDays !== undefined &&
        versionAgeDays < THRESHOLDS.newVersionDays &&
        tier !== "new"
      )
        signals.push({
          id: "new-version",
          kind: "deterministic",
          detail: `version ${resolved.version} published ${age(versionAgeDays)}`,
          data: { versionAgeDays },
        })

      // Code of this package runs now: an exec always does, an install only when scripts are declared
      // and enabled. That is the deterministic reason that turns suspicion into a refusal.
      const executes = input.via === "exec" || (declaresScripts && input.lifecycleEnabled)
      const suspicious = tier === "new" || lowAdoption || similar !== undefined || noRepository
      const uncertain = signals.some((signal) => signal.kind === "uncertainty")
      const describe = facts.length > 0 ? `${input.name} ${facts.join(", ")}` : input.name

      const verdict = ((): Verdict => {
        if (executes && (tier === "new" || (lowAdoption && (similar !== undefined || noRepository)))) {
          return {
            action: "deny",
            hard: true,
            reasonCode: "PACKAGE_LIFECYCLE",
            rule: "hard.pkg.unvetted-execution",
            message: `${describe}; ${label.toLowerCase()} it would execute code of a package that is not established.`,
          }
        }
        if (executes && (suspicious || (freshRelease && declaresScripts))) {
          return {
            action: "ask",
            hard: true,
            reasonCode: "PACKAGE_LIFECYCLE",
            rule: "hard.pkg.lifecycle",
            message: `${describe}; ${label.toLowerCase()} it would execute its code.`,
          }
        }
        if (suspicious) {
          return {
            action: "ask",
            hard: true,
            reasonCode: "PACKAGE_PROVENANCE",
            rule: "hard.pkg.provenance",
            message: `${describe}.`,
          }
        }
        if (uncertain && input.via === "exec") {
          return {
            action: "ask",
            hard: true,
            reasonCode: "PACKAGE_UNVERIFIED",
            rule: "hard.pkg.unverified",
            message: `${input.name} could not be fully verified before execution.`,
          }
        }
        return {
          action: "allow",
          hard: false,
          reasonCode: "PACKAGE_INSTALL",
          rule: "default.pkg.assessed",
          message: `${input.name} is an ${tier === "mature" ? "established, widely used" : tier === "established" ? "established" : "assessed"} package.`,
        }
      })()

      return {
        ...base,
        resolvedVersion: resolved.version,
        tier,
        signals,
        verdict,
      } satisfies Assessment
    })
  }

  /** `registry=` / `@scope:registry=` / `ignore-scripts=` from a project-level `.npmrc`. */
  export function npmrc(text: string): { registries: string[]; ignoreScripts: boolean } {
    const registries: string[] = []
    let ignoreScripts = false
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/[#;].*$/, "").trim()
      const match = line.match(/^(@[^:=\s]+:)?registry\s*=\s*(.+)$/)
      if (match) registries.push(match[2]!.trim())
      if (/^ignore-scripts\s*=\s*true$/.test(line)) ignoreScripts = true
    }
    return { registries, ignoreScripts }
  }

  const DEFAULT_REGISTRIES = new Set(["registry.npmjs.org", "registry.yarnpkg.com", "registry.npmmirror.com"])

  function hostOf(url: string) {
    try {
      return new URL(url.includes("://") ? url : `https://${url}`).host.toLowerCase()
    } catch {
      return url
    }
  }

  interface Manifest {
    dependencies: { name: string; spec: string }[]
    unreadable: boolean
  }

  function manifest(readFile: Input["readFile"], cwd: string | undefined): Manifest {
    if (!readFile || !cwd) return { dependencies: [], unreadable: cwd === undefined }
    const text = readFile(path.join(cwd, "package.json"))
    if (text === undefined) return { dependencies: [], unreadable: false }
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const out: Manifest["dependencies"] = []
      for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
        const section = parsed[key]
        if (!section || typeof section !== "object") continue
        for (const [name, spec] of Object.entries(section as Record<string, unknown>)) {
          if (typeof spec === "string") out.push({ name, spec })
        }
      }
      return { dependencies: out, unreadable: false }
    } catch {
      return { dependencies: [], unreadable: true }
    }
  }

  /** Evaluate every operation. Never fails: an internal error becomes uncertainty evidence (hard ASK). */
  export function evaluate(input: Input): Effect.Effect<Result> {
    return Effect.gen(function* () {
      const ctx: Context = {
        now: (input.now ?? (() => new Date()))(),
        provider: input.provider,
        budget: { lookups: 0 },
      }
      const assessments: Assessment[] = []
      const evidence: SecurityEvidence[] = []

      for (const op of input.operations) {
        const cwd = op.cwd ?? input.cwd
        const rc = input.readFile && cwd ? input.readFile(path.join(cwd, ".npmrc")) : undefined
        const project = rc === undefined ? undefined : npmrc(rc)
        const lifecycleEnabled = op.lifecycle === "enabled" && !(project?.ignoreScripts ?? false)
        const attrs = { manager: op.manager, operation: op.kind }

        if (op.confidence === "ambiguous") {
          evidence.push(
            makeEvidence({
              rule: "hard.pkg.ambiguous",
              source: "hard",
              action: "ask",
              reasonCode: "PACKAGE_UNVERIFIED",
              message: "The package operation cannot be read statically.",
              attributes: { ...attrs, reasons: op.ambiguity.join("; ") },
            }),
          )
        }
        if (op.registry && !DEFAULT_REGISTRIES.has(op.registry.host)) {
          evidence.push(
            makeEvidence({
              rule: "hard.pkg.registry-override",
              source: "hard",
              action: "ask",
              reasonCode: "PACKAGE_PROVENANCE",
              message: `The command redirects the package registry to ${op.registry.host}.`,
              attributes: { ...attrs, registry: op.registry.host, origin: op.registry.origin },
            }),
          )
        }
        const foreign = project?.registries.map(hostOf).filter((host) => !DEFAULT_REGISTRIES.has(host)) ?? []
        if (foreign.length > 0) {
          evidence.push(
            makeEvidence({
              rule: "hard.pkg.npmrc-registry",
              source: "hard",
              action: "ask",
              reasonCode: "PACKAGE_PROVENANCE",
              message: `The project's .npmrc redirects the package registry to ${foreign.join(", ")}.`,
              attributes: { ...attrs, registry: foreign.join(","), origin: "npmrc" },
            }),
          )
        }

        const targets: {
          name: string
          requested?: string
          via: Assessment["via"]
        }[] = []

        if (op.kind === "install-manifest") {
          const found = manifest(input.readFile, cwd)
          if (lifecycleEnabled && (found.dependencies.length > 0 || found.unreadable)) {
            evidence.push(
              makeEvidence({
                rule: "default.pkg.manifest-lifecycle",
                source: "default",
                action: "ask",
                reasonCode: "PACKAGE_LIFECYCLE",
                message: found.unreadable
                  ? "Installing from the manifest runs the install scripts of every dependency; the manifest could not be read."
                  : `Installing from the manifest runs the install scripts of every dependency (${found.dependencies.length} direct).`,
                attributes: { ...attrs, dependencies: found.dependencies.length, unreadable: found.unreadable },
              }),
            )
          }
          const limit = found.dependencies.slice(0, THRESHOLDS.maxManifestDependencies)
          if (found.dependencies.length > limit.length) {
            evidence.push(
              makeEvidence({
                rule: "default.pkg.unassessed",
                source: "default",
                action: "ask",
                reasonCode: "PACKAGE_UNVERIFIED",
                message: `${found.dependencies.length - limit.length} dependencies were not assessed.`,
                attributes: { ...attrs, unassessed: found.dependencies.length - limit.length },
              }),
            )
          }
          for (const dep of limit) {
            const spec = dep.spec.trim()
            if (/^(workspace:|link:|file:|portal:|patch:)/i.test(spec) || /^(\.{1,2}[\\/]|\/)/.test(spec)) continue
            if (
              /^(git\+|git:|github:|gitlab:|bitbucket:|gist:|ssh:|https?:)/i.test(spec) ||
              /^[\w.-]+\/[\w.-]+(#.*)?$/.test(spec)
            ) {
              evidence.push(
                makeEvidence({
                  rule: "hard.pkg.manifest-source",
                  source: "hard",
                  action: "ask",
                  reasonCode: "PACKAGE_PROVENANCE",
                  message: `Dependency ${dep.name} is fetched from a non-registry source.`,
                  attributes: { ...attrs, package: dep.name, source: "git-or-url" },
                }),
              )
              continue
            }
            if (/^npm:/i.test(spec)) {
              const target = PackageOperation.parseSpec(spec.slice(4))
              if (target.name) targets.push({ name: target.name, requested: target.version, via: "manifest" })
              continue
            }
            targets.push({ name: dep.name, requested: spec, via: "manifest" })
          }
        } else {
          for (const spec of op.packages) {
            const via: Assessment["via"] = op.kind === "exec" ? "exec" : "explicit"
            if (spec.source === "file") continue
            if (spec.source === "unknown") continue // already reported as ambiguous
            if (spec.source === "git" || spec.source === "url") {
              evidence.push(
                makeEvidence({
                  rule: "hard.pkg.source",
                  source: "hard",
                  action: "ask",
                  reasonCode: "PACKAGE_PROVENANCE",
                  message: `${spec.name ?? "The package"} is fetched from a ${spec.source === "git" ? "git" : "URL"} source, not the registry.`,
                  attributes: { ...attrs, package: spec.name ?? spec.raw.slice(0, 64), source: spec.source },
                }),
              )
              continue
            }
            const name = spec.source === "alias" ? spec.target : spec.name
            if (!name) continue
            targets.push({ name, requested: spec.version, via })
          }
        }

        const unique = new Map<string, (typeof targets)[number]>()
        for (const target of targets) unique.set(`${target.name}@${target.requested ?? ""}`, target)
        const results = yield* Effect.forEach(
          [...unique.values()],
          (target) =>
            assess(ctx, {
              name: target.name,
              requested: target.requested,
              via: target.via,
              manager: op.manager,
              executes: target.via === "exec" || lifecycleEnabled,
              lifecycleEnabled,
            }),
          { concurrency: 4 },
        )
        for (const assessment of results) {
          assessments.push(assessment)
          evidence.push(toEvidence(assessment))
        }
      }

      return { assessments, evidence, lookups: ctx.budget.lookups } satisfies Result
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed<Result>({
          assessments: [],
          evidence: [
            makeEvidence({
              rule: "hard.pkg.evaluator-failure",
              source: "hard",
              action: "ask",
              reasonCode: "PACKAGE_UNVERIFIED",
              message: "The package check could not be completed.",
              attributes: { error: String(cause).slice(0, 80) },
            }),
          ],
          lookups: 0,
        }),
      ),
    )
  }
}
