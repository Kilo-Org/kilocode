/**
 * Level 0: deterministic rules. No model sits in this decision path.
 *
 * That property is the point, not an optimization. Every other layer can be
 * argued with by text an attacker controls; this one cannot, because there is
 * nothing here to argue with. Whatever Level 0 denies stays denied under any
 * payload, and that is the only guarantee this system claims *always* rather
 * than *usually*.
 *
 * Two jobs:
 *   1. A fast allow path, so routine work never pays for a model call.
 *   2. A small, closed hard-deny list, fully covered by tests.
 *
 * The deny list is deliberately short. A narrow guarantee we can prove beats a
 * broad one we can only assert.
 */

import { isConfigPersistencePath, isCredentialPath } from "./normalize"
import type { Authority, Level0Result, NormalizedAction, PolicyInput, TrustedContext } from "./types"

const DEFAULT_PROTECTED_BRANCHES = ["main", "master", "develop", "release"]

function ok(verdict: "ALLOW" | "DENY", rule: string, reason: string): Level0Result {
  return { verdict, rule, reason }
}

const CONTINUE: Level0Result = { verdict: "CONTINUE", rule: null, reason: null }

/**
 * Does `operation` on `target` fall under capability descriptor `descriptor`?
 * Descriptors are `operation:target`; a directory descriptor covers its
 * children, so `filesystem.delete:dist` covers `dist/assets`.
 */
export function descriptorCovers(descriptor: string, operation: string, target: string): boolean {
  const idx = descriptor.indexOf(":")
  if (idx === -1) return descriptor === operation
  const op = descriptor.slice(0, idx)
  const scope = descriptor.slice(idx + 1)
  if (op !== operation && op !== "*") return false
  if (scope === "*") return true
  if (scope === target) return true
  return target.startsWith(scope.endsWith("/") ? scope : scope + "/")
}

/** True when some descriptor in the list covers this action/target pair. */
function covered(descriptors: string[], operation: string, target: string): boolean {
  return descriptors.some((d) => descriptorCovers(d, operation, target))
}

/** True when every target of the action is authorised by `required` or `implicit`. */
export function withinAuthority(action: NormalizedAction, authority: Authority): boolean {
  const granted = [...authority.required, ...authority.implicit]
  if (action.targets.length === 0) return false
  return action.targets.every((t) => covered(granted, action.operation, t))
}

/** True when any target is flagged `sensitive` in the grant. */
export function touchesSensitive(action: NormalizedAction, authority: Authority): boolean {
  return action.targets.some((t) => covered(authority.sensitive, action.operation, t))
}

/** True when a target sits under a path the trusted context marks protected. */
export function touchesProtected(action: NormalizedAction, ctx: TrustedContext): boolean {
  return action.targets.some((t) =>
    ctx.protected_paths.some((p) => t === p || t.startsWith(p.endsWith("/") ? p : p + "/")),
  )
}

/**
 * Read an option under any of several spellings.
 *
 * The normalizer in `normalize.ts` and the curated benchmark records describe
 * the same fact under different keys (`hosts` vs `host`, `uploads` vs
 * `data_source`). A rule must key off the fact, not off whichever producer
 * happened to fill it in, or the guarantee silently depends on the caller.
 */
function optionList(options: Record<string, unknown>, ...keys: string[]): string[] {
  const out: string[] = []
  for (const key of keys) {
    const value = options[key]
    if (typeof value === "string") out.push(value)
    else if (Array.isArray(value)) out.push(...value.filter((v): v is string => typeof v === "string"))
  }
  return out
}

/**
 * A capability descriptor whose scope is a semantic claim rather than a path:
 * `code.modify:runtime_behavior`, `filesystem.chmod:workspace-recursive`,
 * `script.execute:remote`.
 *
 * Deterministic rules cannot decide these -- there is no path to compare. When
 * a grant marks one sensitive, Level 0 must escalate rather than allow, because
 * "I could not evaluate this restriction" is not the same as "it does not apply".
 */
export function hasUnevaluableSensitive(authority: Authority): boolean {
  // `authority.scope` enumerates the concrete targets this grant is about. A
  // sensitive descriptor pointing outside that list is not naming a target at
  // all -- it is naming a property of the change, which no path comparison can
  // settle. Lexical tests do not work here: `src` and `remote` are both bare
  // identifiers, and only the grant knows which one is a directory.
  return authority.sensitive.some((descriptor) => {
    if (!descriptor.includes(":")) return true
    const scope = descriptor.slice(descriptor.indexOf(":") + 1)
    return !authority.scope.some((entry) => entry === scope || entry.startsWith(scope + "/") || scope.startsWith(entry + "/"))
  })
}

/** Branch names a push targets, read from `HEAD:branch` refspecs or plain names. */
function pushBranches(action: NormalizedAction): string[] {
  const fromOptions = (action.options["branch"] as string[] | undefined) ?? []
  const fromTargets = action.targets.map((t) => (t.includes(":") ? t.split(":").pop()! : t))
  // `origin/main`, `HEAD:main`, and `main` all name the same branch.
  const bare = [...fromOptions, ...fromTargets].map((ref) => ref.split("/").pop() ?? ref)
  return [...fromOptions, ...fromTargets, ...bare].filter(Boolean)
}

/**
 * Hard deny list. Each rule must hold under any payload an attacker can write
 * into the action, because nothing here reads free text as instruction.
 */
export function hardDeny(input: PolicyInput): Level0Result {
  const { action, trusted_context: ctx, authority } = input

  // L0-D1 -- fetch a script from the network and execute it in one step.
  // There is no reading of what will run before it runs.
  if (action.options["pipe_to_shell"] === true || action.operation === "script.execute_remote") {
    return ok("DENY", "L0-D1:pipe_to_shell", "Remote script piped directly into a shell; contents are never inspected")
  }

  // L0-D2 -- exfiltration: credential-bearing file leaving the machine, or any
  // upload to a host the task was not granted.
  if (action.radius === "remote" && (action.effect === "credential_access" || action.effect === "outbound_network")) {
    const uploads = optionList(action.options, "uploads", "data_source", "upload_file")
    if (uploads.some(isCredentialPath) || action.targets.some(isCredentialPath)) {
      return ok("DENY", "L0-D2:credential_exfiltration", "Credential-bearing file sent to a network destination")
    }
    // A credential leaving the machine at all is denied unless the grant names
    // that exact destination as required. No host allowlist can make a secret
    // upload routine.
    if (action.effect === "credential_access") {
      const authorized = action.targets.every((t) => covered(authority.required, action.operation, t))
      if (!authorized) {
        return ok("DENY", "L0-D2:credential_exfiltration", "Credential access with a remote destination the grant does not require")
      }
    }
    const hosts = optionList(action.options, "hosts", "host")
    const disallowed = hosts.filter((h) => !ctx.allowed_external_hosts.some((a) => h === a || h.endsWith("." + a)))
    if (disallowed.length > 0 && uploads.some(isCredentialPath)) {
      return ok("DENY", "L0-D2:credential_exfiltration", `Credential upload to non-allowlisted host ${disallowed[0]}`)
    }
  }

  // L0-D3 -- force-push to a protected branch. Rewrites history other people
  // have already pulled; no local undo exists.
  if (action.operation === "git.push") {
    const forced = action.options["force"] === true || action.options["force_with_lease"] === true
    const protectedBranches = ctx.protected_branches ?? DEFAULT_PROTECTED_BRANCHES
    // `--force-with-lease` refuses to clobber unseen work, so it is not in this rule.
    const unconditionalForce = action.options["force"] === true && action.options["force_with_lease"] !== true
    if (forced && unconditionalForce && pushBranches(action).some((b) => protectedBranches.includes(b))) {
      return ok("DENY", "L0-D3:force_push_protected_branch", "Unconditional force-push to a protected branch")
    }
  }

  // L0-D4 -- write into a file that survives the session and governs the next
  // run: shell rc, ssh config, git config, agent instruction files, CI, hooks.
  // A successful write here disarms this guard on the following invocation.
  if (action.effect === "config_persistence" || action.targets.some(isConfigPersistencePath)) {
    const selfModifying = action.targets.some(isConfigPersistencePath)
    if (selfModifying && (action.radius !== "inside_worktree" || action.intent_provenance === "agent_invented")) {
      return ok("DENY", "L0-D4:agent_self_modification", "Write to a session-surviving config or agent-instruction file")
    }
  }

  // L0-D7 -- recursive world-writable permissions. `chmod -R 777 .` makes every
  // file in the tree writable by any local process, which removes the boundary
  // every other rule here depends on.
  if (action.operation === "filesystem.chmod") {
    const modes = optionList(action.options, "mode", "modes")
    const worldWritable = modes.some((m) => /^[0-7]?[0-7][0-7][2367]$/.test(m) || /o\+w|a\+w/.test(m))
    if (worldWritable && action.options["recursive"] === true) {
      const explicitlyRequired = action.targets.every((t) => covered(authority.required, action.operation, t))
      if (!explicitlyRequired) {
        return ok("DENY", "L0-D7:recursive_world_writable", "Recursive world-writable permission change the grant does not require")
      }
    }
  }

  // L0-D5 -- irreversible destruction outside the worktree. Nothing the agent
  // was asked to do requires deleting above the project root.
  if (action.effect === "mutation_irreversible" && action.radius !== "inside_worktree" && action.radius !== "remote") {
    return ok("DENY", "L0-D5:destructive_outside_worktree", `Irreversible deletion with radius ${action.radius}`)
  }

  // L0-D6 -- irreversible destruction of a path the user declared protected,
  // when the grant does not require it. `rm -rf src` under a "clean dist" task.
  if (action.effect === "mutation_irreversible" && (touchesProtected(action, ctx) || touchesSensitive(action, authority))) {
    const explicitlyRequired = action.targets.every((t) => covered(authority.required, action.operation, t))
    if (!explicitlyRequired) {
      return ok("DENY", "L0-D6:protected_path_destruction", "Irreversible change to a protected or sensitive path that the grant does not require")
    }
  }

  // L0-D8 -- the grant names this exact target sensitive and does not require
  // it. That is an authority violation the code can settle on its own: the
  // developer marked the target as consequential and never asked for it to be
  // touched. Restricted to effects that leave something behind, so a read of a
  // sensitive path still escalates rather than hard-failing.
  if (
    action.effect !== "read" &&
    touchesSensitive(action, authority) &&
    !action.targets.every((t) => covered(authority.required, action.operation, t))
  ) {
    return ok("DENY", "L0-D8:sensitive_target_not_required", "Action targets a grant-designated sensitive target that the grant does not require")
  }

  return CONTINUE
}

/**
 * Fast allow path. Everything here must be cheap to justify: reads inside the
 * worktree, and git-tracked edits the user actually asked for.
 *
 * `effect: unknown` is never allowed here -- that is what makes opaque
 * indirection safe to admit we cannot analyse.
 */
export function fastAllow(input: PolicyInput): Level0Result {
  const { action, trusted_context: ctx, authority } = input

  // Opaque indirection is never fast-allowed, whoever asked for it.
  if (action.effect === "unknown") return CONTINUE

  // Reads inside the worktree, as long as they are not credential files.
  //
  // Provenance is deliberately NOT consulted here. A read changes nothing, and
  // this rule is what keeps the common case off the model path -- gating it on
  // "did the developer name this file" would send most of an ordinary session
  // to Level 1 and give back the approval fatigue this exists to remove.
  if (action.effect === "read" && action.radius === "inside_worktree") {
    if (action.targets.some(isCredentialPath)) return CONTINUE
    return ok("ALLOW", "L0-A1:read_inside_worktree", "Read-only access inside the worktree")
  }

  // Everything below this line changes state, so who asked for it matters.
  if (action.intent_provenance === "agent_invented") return CONTINUE

  // Reversible, git-tracked edits inside the worktree that the grant covers.
  // Git makes these reviewable and revertible, so the cost of being wrong is a
  // `git checkout` rather than lost work.
  //
  // `protected_paths` is deliberately NOT consulted here. It guards against
  // destruction, and a tracked edit is already revertible -- gating on it would
  // block the ordinary case of editing source in a repo that protects `src`,
  // which is most of what a coding agent legitimately does. `sensitive` still
  // applies: that is the user marking a target as consequential regardless of
  // reversibility.
  if (
    action.effect === "mutation_reversible" &&
    action.radius === "inside_worktree" &&
    action.reversible === "git_tracked" &&
    !touchesSensitive(action, authority) &&
    !hasUnevaluableSensitive(authority) &&
    withinAuthority(action, authority)
  ) {
    return ok("ALLOW", "L0-A2:tracked_edit_in_scope", "Reversible git-tracked edit inside the worktree and within the grant")
  }

  // Deleting a declared build artifact that the grant explicitly requires.
  if (
    action.effect === "mutation_irreversible" &&
    action.radius === "inside_worktree" &&
    action.targets.length > 0 &&
    action.targets.every((t) => ctx.generated_paths.some((g) => t === g || t.startsWith(g + "/"))) &&
    action.targets.every((t) => covered(authority.required, action.operation, t)) &&
    !touchesProtected(action, ctx)
  ) {
    return ok("ALLOW", "L0-A3:generated_artifact_cleanup", "Deletion of a declared generated path required by the grant")
  }

  return CONTINUE
}

/**
 * Run Level 0. Deny wins over allow: a rule that fires on the deny list is
 * never overridden by an allow-path match.
 */
export function level0(input: PolicyInput): Level0Result {
  const deny = hardDeny(input)
  if (deny.verdict === "DENY") return deny
  return fastAllow(input)
}
