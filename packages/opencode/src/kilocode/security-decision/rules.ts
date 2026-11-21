import type { SecurityDecisionTypes } from "./types"

/**
 * Rule catalog for the deterministic security layer.
 *
 * `reason` is deliberately the catalog constant itself: the spec forbids echoing any command,
 * path or content into the model-facing text, so the only safe reason is the stable rule id.
 */
export namespace SecurityDecisionRules {
  export const POLICY_VERSION = "kilo.security-decision/v1" as const

  export type Entry = Readonly<{
    id: string
    decision: SecurityDecisionTypes.Decision
    /** Whether the (deferred) reviewer stage may upgrade this ask to allow. */
    reviewable: boolean
    requirements: readonly SecurityDecisionTypes.Requirement[]
  }>

  function entry(
    id: string,
    decision: SecurityDecisionTypes.Decision,
    reviewable = false,
    requirements: readonly SecurityDecisionTypes.Requirement[] = [],
  ): Entry {
    return { id, decision, reviewable, requirements }
  }

  /** `pass` — the layer has no security opinion and the existing pipeline decides. */
  export const NO_OPINION = entry("SEC.V1.NO_OPINION", "pass")

  /** Proven, exact, platform-aware capability: the only cases allowed to deny on the soft path. */
  export const DESTRUCTIVE_ROOT = entry("SEC.V1.DESTRUCTIVE_ROOT", "deny")
  export const GIT_HOOK_WRITE = entry("SEC.V1.GIT_HOOK_WRITE", "deny")

  /**
   * Repository control plane. These files do not execute themselves, but writing them installs code
   * that later runs — `core.hooksPath`, filter drivers, direnv. They ask rather than deny: a human
   * routinely edits `.gitattributes`, and the shell route cannot see `git config`, so denying here
   * would open a new route asymmetry instead of closing one.
   */
  export const CONTROL_PLANE_WRITE = entry("SEC.V1.CONTROL_PLANE_WRITE", "ask")

  /** Ambiguity, incompleteness and authority boundaries: ask, never deny. */
  export const AMBIGUOUS_OPERATION = entry("SEC.V1.AMBIGUOUS_OPERATION", "ask")
  export const METADATA_INCOMPLETE = entry("SEC.V1.METADATA_INCOMPLETE", "ask")
  export const EXEC_INCOMPLETE = entry("SEC.V1.EXEC_INCOMPLETE", "ask")
  export const EXEC_COMPOSED = entry("SEC.V1.EXEC_COMPOSED", "ask")
  /** Shell expansion can expose inherited credentials even when the surrounding command is inert. */
  export const AMBIENT_ENVIRONMENT = entry("SEC.V1.AMBIENT_ENVIRONMENT", "ask")
  export const UNKNOWN_TARGET = entry("SEC.V1.UNKNOWN_TARGET", "ask")
  export const SENSITIVE_BOUNDARY = entry("SEC.V1.SENSITIVE_BOUNDARY", "ask")
  export const CI_AUTHORITY = entry("SEC.V1.CI_AUTHORITY", "ask")
  export const PACKAGE_EXECUTION = entry("SEC.V1.PACKAGE_EXECUTION", "ask")
  export const DELEGATED_OPAQUE = entry("SEC.V1.DELEGATED_OPAQUE", "ask")
  /** The XDG user-global floor is stricter than what the merged ruleset resolved. */
  export const AUTHORITY_FLOOR = entry("SEC.V1.AUTHORITY_FLOOR", "ask")

  /** Adapter, core or reviewer failure — always fails closed to ask. */
  export const INTERNAL_ERROR = entry("SEC.V1.INTERNAL_ERROR", "ask")

  /**
   * Fetching an external package. The name is chosen by the model, so allowing it without a human
   * is what makes a hallucinated or squatted name reach the machine. Never reviewable: the reviewer
   * sees only the command line, which is exactly the evidence that cannot tell the two apart.
   */
  export const DEPENDENCY_INSTALL = entry("SEC.V1.DEPENDENCY_INSTALL", "ask")

  /**
   * The command steers the host itself, or hands the work to a privileged daemon or a remote
   * machine. The sandbox confines the calling process, not the launchd job it registers, not the
   * container daemon that mounts the filesystem for it and not the host at the other end of an ssh
   * connection — so confinement is not evidence here, and neither is a judgement about the command
   * line, because the capability is the program itself.
   */
  export const HOST_CONTROL = entry("SEC.V1.HOST_CONTROL", "ask")

  /**
   * A change to the repository itself — staging, committing, moving refs, discarding work, or
   * writing git configuration. Reversibility varies from trivial to none (`reset --hard`,
   * `clean -fd`), the shape is fully recognized, and nothing a reviewer can see distinguishes the
   * safe case from the destructive one. So it is a deterministic human boundary, not a judgement.
   */
  export const REPO_MUTATION = entry("SEC.V1.REPO_MUTATION", "ask")

  /** A write to a dependency manifest or lockfile: the same new-dependency boundary, declared. */
  export const DEPENDENCY_MANIFEST_WRITE = entry("SEC.V1.DEPENDENCY_MANIFEST_WRITE", "ask")

  /**
   * Operational confinement is useful evidence, but the current sandbox still permits ambient
   * reads and writes to built-in Kilo roots. Keep an unclassified command at a human ask until the
   * containment capability proves the full boundary this decision would require.
   */
  export const CONTAINED_EXEC = entry("SEC.V1.CONTAINED_EXEC", "ask", false, ["sandbox", "restricted_network"])

  /** Soft ambiguity a human routinely resolves: reviewable once a reviewer exists. */
  export const DESTRUCTIVE_FS = entry("SEC.V1.DESTRUCTIVE_FS", "ask", true)

  /**
   * A shell action the parser fully recovered that produced no confident file effect. A complete
   * parse is not proof of safety — `sed -i`, `git push --force` and `npm publish` all parse cleanly.
   * It is reviewable precisely because a narrow, bounded judgement is what it needs.
   */
  export const UNCLASSIFIED_EXEC = entry("SEC.V1.UNCLASSIFIED_EXEC", "ask")

  export function result(rule: Entry): SecurityDecisionTypes.Result {
    return {
      decision: rule.decision,
      reason: rule.id,
      rule_id: rule.id,
      requirements: rule.requirements,
      reviewable: rule.reviewable,
    }
  }
}
