import path from "path"
import { ConfigProtection } from "@/kilocode/permission/config-paths"
import { SecurityDecision } from "./core"
import { SecurityManifest } from "./manifest"
import { SecurityDecisionRules as R } from "./rules"
import { SecurityReviewer } from "./reviewer"
import type { SecurityAuthority } from "./authority"
import type { SecurityDecisionTypes as T } from "./types"

/**
 * Kilo-side normalization for the deterministic security layer.
 *
 * Everything Kilo-specific happens here: reading the existing per-permission metadata, canonicalizing
 * paths without touching the filesystem, assembling the authority and containment facts, calling the
 * pure core and shaping the audit record. Raw chat, README text, tool output and MCP arguments never
 * reach this function, and nothing it produces echoes a command, path or diff.
 */
export namespace SecurityDecisionAdapter {
  const READS = new Set(["read", "grep", "glob", "notebook_read", "semantic_search", "repo_overview"])
  const EXECS = new Set(["bash", "interactive_terminal"])

  export type Request = Readonly<{
    source?: "builtin" | "mcp" | "unknown"
    permission: string
    patterns: readonly string[]
    metadata?: Record<string, unknown>
    sessionID: string
    callID?: string
  }>

  export type Context = Readonly<{
    workspace: string
    effective: "allow" | "ask" | "deny"
    humanOnly: boolean
    floor: SecurityAuthority.Floor
    containment: T.Containment & { probe_id?: string; checked_at?: number }
  }>

  export type Enforcement = "allow" | "ask_pending" | "reject" | "deny" | "blocked" | "error"

  /**
   * How the review itself ended.
   *
   * Deliberately not Codex's vocabulary: their reviewer can approve *or* deny, so "denied" is one of
   * its outcomes. Ours can only narrow an ask into an allow, so the two answers are `narrowed` and
   * `held` — declining to narrow is the default answer to the question, not a refusal.
   */
  export type TerminalStatus = "not_reviewed" | "in_progress" | "narrowed" | "held" | "timed_out" | "failed_closed"

  const TERMINAL: Record<SecurityReviewer.State, TerminalStatus> = {
    not_run: "not_reviewed",
    running: "in_progress",
    allow: "narrowed",
    keep_ask: "held",
    timeout: "timed_out",
    error: "failed_closed",
  }

  export type Audit = {
    schema: "kilo.security-decision/v1"
    policy_version: string
    rule_id: string
    reason: string
    decision: T.Decision
    reviewer: SecurityReviewer.Outcome
    /** Whether the reviewer's own evidence could not be bounded, as distinct from a metadata gap. */
    reviewer_truncated: boolean
    /** What this process is bound to: the model when there is one, else why there is not. */
    reviewer_binding: string
    reviewer_model?: string
    final_enforcement?: Enforcement
    enforcement_source?: string
    /** How the review ended, in this layer's own vocabulary. Set when the record is finalized. */
    terminal_status?: TerminalStatus
    authority_level: T.Authority
    authority_basis: "none" | "xdg_scope" | "hard_product"
    authority_conflict: boolean
    metadata_complete: boolean
    metadata_truncated: boolean
    containment: T.Containment & { probe_id?: string; checked_at?: number }
    requirements: readonly T.Requirement[]
    latency_ms: number
    callID?: string
    sessionID: string
  }

  export type Directive = Readonly<{
    decision: T.Decision
    rule_id: string
    reviewable: boolean
    /** Bounded context for the reviewer. Present only for a reviewable ask, never for a deny. */
    review?: SecurityReviewer.Request
    audit: Audit
  }>

  /**
   * Server-side feature flag. It lives in the process environment precisely so a project config,
   * which can arrive with a clone, cannot turn the layer off.
   */
  export function enabled(env: Record<string, string | undefined> = process.env) {
    const value = env["KILO_SECURITY_DECISION"]
    return value === "1" || value === "true"
  }

  /** Device nodes that discard or echo output rather than persisting a file. */
  const SINKS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty", "/dev/zero"])

  const OPERATIONS = new Set(["read", "update", "delete", "move"])

  function posix(value: string) {
    return value.replaceAll("\\", "/")
  }

  /**
   * Whether the path starts at a filesystem root rather than at the workspace.
   *
   * Paths are compared in posix form, and `path.posix.isAbsolute` says no to `C:/Users/me` — so a
   * Windows absolute path would be measured as workspace-relative and land inside the workspace by
   * arithmetic, whatever it actually names. A drive letter is a root on the platform that writes it,
   * so it is one here. UNC paths already begin with a separator and need no case of their own.
   */
  function rooted(value: string) {
    return path.posix.isAbsolute(value) || /^[A-Za-z]:\//.test(value)
  }

  /** Canonicalize a permission pattern into a path fact. No IO: the workspace is compared textually. */
  function classify(pattern: string, workspace: string, region: SecurityManifest.Region = "other"): T.PathFact {
    if (!pattern || pattern === "*") return { path: pattern, inWorkspace: true, class: "unknown" }
    const raw = posix(pattern)
    if (/^~[^/]+\//.test(raw)) return { path: raw, inWorkspace: false, class: "unknown" }
    // `~` is the home directory whichever shell expands it, so an unexpanded token must not be read
    // as a workspace-relative name: `tree ~/.ssh` and `tree /Users/me/.ssh` are the same action.
    if (raw === "~" || raw.startsWith("~/")) {
      const tail = path.posix.normalize(raw.slice(2))
      return { path: raw, inWorkspace: false, class: raw === "~" ? "ordinary" : pathClass(tail) }
    }
    const normalized = path.posix.normalize(raw)
    const absolute = rooted(normalized)
    const relative = absolute ? path.posix.relative(posix(workspace), normalized) : normalized
    const inWorkspace = !relative.startsWith("../") && relative !== ".." && !(absolute && relative === normalized)

    // `> /dev/null` is the canonical discard, not a device write, and nothing persists past the
    // process — so it is neither a root target nor a boundary crossing. Other device nodes stay root.
    if (SINKS.has(normalized)) return { path: normalized, inWorkspace: true, class: "ordinary" }
    if (normalized === "/" || normalized.startsWith("/dev/"))
      return { path: normalized, inWorkspace: false, class: "root" }

    const target = inWorkspace ? relative : normalized
    const cls = pathClass(target)
    return {
      path: target,
      inWorkspace,
      class: cls,
      ...(cls === "package_manifest" ? { region } : {}),
    }
  }

  /** Files whose whole content is a long-lived credential. Matched by name, never by heuristic. */
  const CREDENTIALS = new Set([
    ".dockercfg",
    ".git-credentials",
    ".htpasswd",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".terraformrc",
    "credentials",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "secrets.yaml",
    "secrets.yml",
    "service-account.json",
  ])

  /** Key and certificate stores, by extension. */
  const KEYSTORES = [".jks", ".key", ".keystore", ".p12", ".pem", ".pfx"]

  /** CI entrypoints and executable action definitions share the same mutation authority. */
  const CI = {
    files: new Set([".gitlab-ci.yml", "jenkinsfile", ".drone.yml", "bitbucket-pipelines.yml"]),
    directories: new Set([".circleci", ".buildkite"]),
    github: new Set(["workflows", "actions"]),
  }

  /**
   * Second segments the CI class needs before it recognises a `.github` directory.
   *
   * Taken from `CI.github` rather than restated, so a protected name added there is automatically a
   * name an ancestor can be asked about.
   */
  const SUBTREE_PROBES = [...CI.github]

  /** Operations that take a whole subtree away rather than changing one file inside it. */
  const SUBTREE_DESTRUCTIVE = new Set(["delete", "move"])

  /** Strictness order, used only to choose between several protected classes under one target. */
  const CLASS_RANK: Partial<Record<T.PathClass, number>> = {
    git_hook: 4,
    control_plane: 3,
    ci: 2,
    package_manifest: 2,
    sensitive: 1,
  }

  /**
   * The class an operation inherits from what lives underneath its target.
   *
   * Removing a directory removes everything in it, so an operation that takes a whole subtree away
   * is a mutation of the strictest thing inside that subtree. `.github` is the case that exposed
   * this: the CI class is spelled `.github/workflows`, the parent matched no pattern of its own, and
   * `rm -rf .github` — which deletes every workflow — was therefore classified as ordinary.
   *
   * It asks the classifier rather than carrying a second list of protected names, so the two cannot
   * disagree. Deliberately narrow in three ways. It applies only to subtree-destructive operations,
   * because reading or writing *inside* a directory takes nothing away and a read of the directory
   * itself takes nothing away either. It applies only to a target with no class of its own; one that
   * has a class is already held by the rule written for it, and inheriting on top of that would
   * quietly escalate, for example turning every `.git` removal into the hook rule's hard deny. And
   * it never applies to the workspace root, whose destruction is the destructive-filesystem question
   * in its own right rather than an inherited one.
   */
  function inherited(target: string, operation: string | undefined): T.PathClass | undefined {
    if (operation === undefined || !SUBTREE_DESTRUCTIVE.has(operation)) return undefined
    const normalized = posix(target).replace(/\/+$/, "")
    if (normalized === "" || normalized === "." || normalized === "/") return undefined
    let best: T.PathClass | undefined
    for (const probe of SUBTREE_PROBES) {
      const candidate = pathClass(path.posix.join(normalized, probe))
      if (candidate === "ordinary" || candidate === "unknown") continue
      if (!best || (CLASS_RANK[candidate] ?? 0) > (CLASS_RANK[best] ?? 0)) best = candidate
    }
    return best
  }

  /** Apply subtree inheritance to one already-classified fact. */
  function descend(fact: T.PathFact, operation: string): T.PathFact {
    if (fact.class !== "ordinary" || !fact.inWorkspace) return fact
    const cls = inherited(fact.path, fact.operation ?? operation)
    return cls ? { ...fact, class: cls } : fact
  }

  /**
   * Path classes are matched case-insensitively and with the directory itself included.
   *
   * Both halves close a spelling bypass rather than widening a class. `cp evil .git/hooks` writes
   * exactly what `cp evil .git/hooks/x` writes, so a pattern anchored on a trailing slash missed
   * every destination-shaped route into a protected directory; and on a case-insensitive filesystem
   * `.GIT/hooks/pre-commit` *is* the hook, so a case-sensitive match was a one-character bypass.
   * Over-matching a differently-cased directory on a case-sensitive filesystem can only tighten.
   */
  function pathClass(target: string): T.PathClass {
    const base = path.posix.basename(target)
    // Manifest names are matched exactly (`Cargo.toml`); credential and key names are matched
    // case-folded, because those are the ones a spelling change is used to slip past.
    const lower = base.toLowerCase()
    // A submodule hook is executable Git control plane just like the top-level hook directory.
    // Submodule names may contain path separators, so match the hook directory after the complete
    // `.git/modules/**` storage path instead of assuming one name segment.
    if (/(^|\/)\.git\/(?:hooks|modules\/.+\/hooks)(\/|$)/i.test(target)) return "git_hook"
    // Control plane: hook redirection, filter drivers and direnv all install code that later runs.
    // `.husky` and `.githooks` are where `core.hooksPath` points in a modern repository: a write
    // there installs a hook just as a write to `.git/hooks` does. They ask rather than deny, because
    // unlike `.git/hooks` these files are committed and edited by hand.
    if (
      /(^|\/)\.git(\/|$)/i.test(target) ||
      /(^|\/)\.husky(\/|$)/i.test(target) ||
      /(^|\/)\.githooks(\/|$)/i.test(target) ||
      lower === ".gitattributes" ||
      lower === ".envrc" ||
      // The agent's own control plane. A rule file, an agent or command definition, or the config
      // that names them is read into every later prompt for this repository, so a write there
      // installs standing instructions exactly the way a write to `.git/hooks` installs code — and
      // it needs no shell, no execute bit and no later `git` invocation to take effect. The
      // predicate is the one the config-edit prompt already uses, so the two cannot drift.
      ConfigProtection.isAgentControlPath(target)
    )
      return "control_plane"
    const segments = target.toLowerCase().split("/")
    if (CI.files.has(lower) || segments.some((segment, index) =>
      CI.directories.has(segment) || (segment === ".github" && CI.github.has(segments.at(index + 1) ?? "")),
    )) return "ci"
    if (SecurityManifest.is(base)) return "package_manifest"
    if (
      lower === ".env" ||
      lower.startsWith(".env.") ||
      CREDENTIALS.has(lower) ||
      KEYSTORES.some((extension) => lower.endsWith(extension)) ||
      /(^|\/)\.ssh(\/|$)/i.test(target) ||
      /(^|\/)\.aws(\/|$)/i.test(target) ||
      /(^|\/)\.kube(\/|$)/i.test(target) ||
      /(^|\/)\.docker(\/|$)/i.test(target) ||
      /(^|\/)\.gnupg(\/|$)/i.test(target)
    )
      return "sensitive"
    return "ordinary"
  }

  /** apply-patch reports a per-file operation; edit/write always write, reads always read. */
  function operation(request: Request): string {
    if (READS.has(request.permission)) return "read"
    if (EXECS.has(request.permission)) return "exec"
    if (request.permission === "external_directory") {
      return request.metadata?.["access"] === "read" ? "read" : "unknown"
    }
    const files = request.metadata?.["files"]
    if (Array.isArray(files)) {
      const types = files.map((file) => (file as { type?: unknown }).type).filter((t) => typeof t === "string")
      if (types.includes("delete")) return "delete"
      if (types.includes("move")) return "move"
      if (types.length > 0) return "update"
    }
    if (request.permission === "edit" || request.permission === "write" || request.permission === "notebook_edit")
      return "update"
    return "unknown"
  }

  /** Bound on how many commands of one sequence the layer will reason about. */
  const MAX_COMMANDS = 32

  type Normalized<A> = Readonly<{ value: A; truncated: boolean }>

  function unit(item: unknown): Normalized<T.ExecCommandFact> {
    if (!item || typeof item !== "object") return { value: {}, truncated: true }
    const value = item as {
      executable?: unknown
      argv?: unknown
      classified?: unknown
      ambient?: unknown
      pathed?: unknown
      assigns?: unknown
    }
    const argv = Array.isArray(value.argv)
      ? value.argv.filter((token): token is string => typeof token === "string")
      : []
    return {
      value: {
        ...(typeof value.executable === "string" ? { executable: value.executable } : {}),
        argv,
        classified: value.classified === true,
        ambient: value.ambient === true,
        pathed: value.pathed === true,
        assigns: value.assigns === true,
      },
      truncated:
        (value.executable !== undefined && typeof value.executable !== "string") ||
        (value.classified !== undefined && typeof value.classified !== "boolean") ||
        (value.ambient !== undefined && typeof value.ambient !== "boolean") ||
        (value.pathed !== undefined && typeof value.pathed !== "boolean") ||
        (value.assigns !== undefined && typeof value.assigns !== "boolean") ||
        (value.argv !== undefined && !Array.isArray(value.argv)) ||
        (Array.isArray(value.argv) && argv.length !== value.argv.length),
    }
  }

  function exec(request: Request): Normalized<T.ExecFact | undefined> {
    if (!EXECS.has(request.permission)) return { value: undefined, truncated: false }
    const facts = request.metadata?.["securityFacts"]
    // No facts at all is a plumbing gap, not an unparsed command: report it as missing metadata.
    if (!facts || typeof facts !== "object") return { value: undefined, truncated: false }
    const value = facts as {
      complete?: unknown
      truncated?: unknown
      composed?: unknown
      executable?: unknown
      argv?: unknown
      classified?: unknown
      ambient?: unknown
      pathed?: unknown
      assigns?: unknown
      decomposable?: unknown
      commands?: unknown
    }
    const argv = Array.isArray(value.argv) ? value.argv.filter((item): item is string => typeof item === "string") : []
    const list = Array.isArray(value.commands) ? value.commands : undefined
    const commands = list?.slice(0, MAX_COMMANDS).map(unit)
    return {
      value: {
        complete: value.complete === true,
        composed: value.composed === true,
        classified: value.classified === true,
        ambient: value.ambient === true,
        pathed: value.pathed === true,
        assigns: value.assigns === true,
        decomposable: value.decomposable === true,
        ...(commands ? { commands: commands.map((item) => item.value) } : {}),
        argv,
        ...(typeof value.executable === "string"
          ? { executable: value.executable, class: "known" as const }
          : { class: "unknown" as const }),
      },
      truncated:
        value.truncated === true ||
        (value.executable !== undefined && typeof value.executable !== "string") ||
        (value.classified !== undefined && typeof value.classified !== "boolean") ||
        (value.ambient !== undefined && typeof value.ambient !== "boolean") ||
        (value.pathed !== undefined && typeof value.pathed !== "boolean") ||
        (value.assigns !== undefined && typeof value.assigns !== "boolean") ||
        (value.argv !== undefined && !Array.isArray(value.argv)) ||
        (Array.isArray(value.argv) && argv.length !== value.argv.length) ||
        (value.commands !== undefined && !Array.isArray(value.commands)) ||
        (list !== undefined && list.length > MAX_COMMANDS) ||
        commands?.some((item) => item.truncated) === true,
    }
  }

  /**
   * Real targets resolved before the ask, index-aligned with `patterns`. An empty entry means the
   * resolution could not determine the target, which classifies as unknown and holds at ask; a
   * missing array means no resolution was attempted and the pattern itself stands.
   */
  function resolved(request: Request): Normalized<Array<string> | undefined> {
    const value = request.metadata?.["securityPaths"]
    if (value === undefined) return { value: undefined, truncated: false }
    if (!Array.isArray(value)) return { value: undefined, truncated: true }
    return {
      value: value.map((item) => (typeof item === "string" ? item : "")),
      truncated:
        value.length !== request.patterns.length || value.some((item) => typeof item !== "string" && item !== null),
    }
  }

  /** Permissions whose own patterns are concrete local paths rather than selectors or identifiers. */
  const PATTERNS = new Set(["edit", "read", "write"])

  /** Permissions that carry their concrete filesystem scope in metadata, not in `patterns`. */
  const FIELDS: Record<string, string> = {
    glob: "path",
    grep: "path",
    lsp: "filePath",
    notebook_edit: "path",
    notebook_execute: "path",
    notebook_read: "path",
    recall: "directory",
    repo_clone: "path",
    repo_overview: "path",
    semantic_search: "path",
  }

  type Targets = Readonly<{ value: readonly string[]; patterns: boolean; truncated: boolean }>

  function targets(request: Request): Targets {
    // `read` is also the permission used for MCP resources; those strings are URI-like capability
    // identifiers and must not be interpreted as local filesystem names.
    const resource =
      request.permission === "read" &&
      request.patterns.length > 0 &&
      request.patterns.every((pattern) => /^mcp:[^:]+:/.test(pattern))
    if (PATTERNS.has(request.permission) && !resource)
      return { value: request.patterns, patterns: true, truncated: false }

    if (request.permission === "external_directory") {
      const filepath = request.metadata?.["filepath"]
      if (typeof filepath === "string") return { value: [filepath], patterns: false, truncated: false }
      if (filepath !== undefined) return { value: [], patterns: false, truncated: true }
      const directories = request.metadata?.["directories"]
      if (Array.isArray(directories)) {
        const value = directories.filter((item): item is string => typeof item === "string")
        return { value, patterns: false, truncated: value.length !== directories.length }
      }
      if (directories !== undefined) return { value: [], patterns: false, truncated: true }
      return { value: request.patterns, patterns: true, truncated: false }
    }

    const key = FIELDS[request.permission]
    if (!key) return { value: [], patterns: false, truncated: false }
    const value = request.metadata?.[key]
    if (value === undefined || value === null || value === "") return { value: [], patterns: false, truncated: false }
    if (typeof value !== "string") return { value: [], patterns: false, truncated: true }
    return { value: [value], patterns: false, truncated: false }
  }

  /**
   * File effects the shell scan extracted, normalized into path facts so a shell route reaches the
   * same rules as `edit`/`write`/`read`. An effect without a path is a target the scan could not
   * determine: it becomes an `unknown` fact, which the core holds at ask.
   */
  function effects(request: Request, workspace: string): Normalized<T.PathFact[]> {
    const facts = request.metadata?.["securityFacts"]
    if (!facts || typeof facts !== "object") return { value: [], truncated: false }
    const list = (facts as { effects?: unknown }).effects
    if (list === undefined) return { value: [], truncated: false }
    if (!Array.isArray(list)) return { value: [], truncated: true }
    const out: T.PathFact[] = []
    let truncated = false
    for (const item of list) {
      if (!item || typeof item !== "object") {
        truncated = true
        continue
      }
      const value = item as { operation?: unknown; path?: unknown }
      if (typeof value.operation !== "string" || !OPERATIONS.has(value.operation)) {
        truncated = true
        continue
      }
      if (typeof value.path !== "string" || value.path.length === 0) {
        if (value.path !== undefined) truncated = true
        out.push({ path: "", inWorkspace: false, class: "unknown", operation: value.operation })
        continue
      }
      out.push({ ...classify(value.path, workspace), operation: value.operation })
    }
    return { value: out, truncated }
  }

  /**
   * Build systems whose arguments are labels rather than paths. In a label `//` is the *workspace*
   * root, not the filesystem root, and the tool resolves it there — `bazel build //...` never
   * reaches past the workspace however much the token looks absolute.
   */
  const LABEL_TOOLS = new Set(["bazel", "bazelisk", "buck", "buck2", "pants"])

  /**
   * The package a label names, workspace-relative, or undefined when the token is not a label. The
   * package is still classified from there: a label is re-anchored, never waved through.
   */
  function label(token: string) {
    // An optional repository or cell prefix (`@com_example//`, `cell//`), then the package, then
    // the target after `:`. The prefix is anchored and slash-free, so a real path never matches.
    const match = /^[A-Za-z0-9@._+-]*\/\/([^:]*)/.exec(token)
    return match ? match[1] : undefined
  }

  /**
   * Path facts read off the command line itself.
   *
   * The effect table only names files for executables the scan knows, so an unknown reader — `xxd`,
   * `strings`, `openssl` — reports no effect at all. Confinement cannot settle those: the sandbox
   * constrains writes and network, but the command's own output leaves it for the model context, so
   * an argument that *names* sensitive material has to become a fact of its own.
   *
   * Only notable arguments are reported. An ordinary in-workspace path is what every build and test
   * command carries and says nothing; a glob the classifier cannot resolve is not evidence of
   * sensitivity either, and a URL is not a path however much its tail looks like one.
   */
  function argvPaths(facts: T.ExecFact | undefined, workspace: string): T.PathFact[] {
    if (!facts) return []
    const out: T.PathFact[] = []
    for (const unit of facts.commands && facts.commands.length > 0 ? facts.commands : [facts]) {
      // Classified commands already carry per-target roles from the scanner.
      if (unit.classified === true) continue
      const labeled = unit.executable !== undefined && LABEL_TOOLS.has(unit.executable)
      // The executable's own name is not one of its arguments.
      for (const token of (unit.argv ?? []).slice(1)) {
        if (token.length === 0 || token.includes("://")) continue
        // A path-valued option carries its target inside the token (`--output=/etc/cron.d/job`), so
        // skipping every token that starts with `-` skipped the path along with the option name.
        const flag = token.startsWith("-") ? token.indexOf("=") : -1
        if (token.startsWith("-") && flag <= 0) continue
        const value = flag > 0 ? token.slice(flag + 1) : token
        if (value.length === 0 || value.includes("://")) continue
        // `@file` is how curl and friends spell "read this file", and `key=value` is how `dd` and
        // its relatives spell an operand: in both the reference is the tail, not the whole token.
        const operand = /^[A-Za-z_][A-Za-z0-9_]*=(.+)$/.exec(value)
        const named =
          (labeled ? label(value) : undefined) ?? (value.startsWith("@") ? value.slice(1) : (operand?.[1] ?? value))
        const fact = classify(named, workspace)
        if (fact.class === "ordinary" && fact.inWorkspace) continue
        // An unclassified executable does not prove read-only use of any named operand.
        // Mutation utilities may also read these operands; over-reporting writes only tightens.
        const mutation = new Set(["sed", "truncate", "tee", "dd", "sort", "install", "rsync", "tar", "unzip"])
        out.push({ ...fact, operation: mutation.has(unit.executable ?? "") ? "update" : "unknown" })
      }
    }
    return out
  }

  /** Provenance comes from trusted dispatch, never from the permission or tool name. */
  function delegated(request: Request) {
    return request.source === "mcp" || request.source === "unknown"
  }

  function toInput(request: Request, ctx: Context): T.Input {
    const kind = delegated(request) ? "mcp" : request.permission
    const normalized = exec(request)
    const facts = normalized.value
    const impact = EXECS.has(request.permission) ? effects(request, ctx.workspace) : { value: [], truncated: false }
    const target =
      kind === "mcp" || EXECS.has(request.permission)
        ? { value: [], patterns: false, truncated: false }
        : targets(request)
    const identity = target.patterns ? resolved(request) : { value: undefined, truncated: false }
    // Shell patterns are commands, not paths: its targets come from the scan's structured effects,
    // plus the notable paths its own command line names.
    const action = operation(request)
    const classified =
      kind === "mcp"
        ? []
        : EXECS.has(request.permission)
          ? [...impact.value, ...argvPaths(facts, ctx.workspace)]
          : (() => {
              // The diff is the only view of *what* changed, so the manifest region comes from it.
              const region = SecurityManifest.region(request.metadata?.["diff"])
              return target.value.map((pattern, index) =>
                classify(identity.value?.[index] ?? pattern, ctx.workspace, region),
              )
            })()
    const paths = classified.map((fact) => descend(fact, action))
    const complete = !EXECS.has(request.permission) || facts !== undefined
    return {
      version: 1,
      action: { kind, operation: action, paths, ...(facts ? { exec: facts } : {}) },
      baseline: {
        decision: ctx.floor.action === "deny" ? "ask" : ctx.floor.action,
        authority: ctx.floor.authority,
        humanOnly: ctx.humanOnly,
      },
      metadata: {
        complete,
        truncated: normalized.truncated || impact.truncated || target.truncated || identity.truncated,
      },
      containment: ctx.containment,
    }
  }

  function audit(
    request: Request,
    ctx: Context,
    result: T.Result,
    metadata: T.Input["metadata"],
    started: number,
    truncated = false,
  ): Audit {
    const attribution = SecurityReviewer.attributed()
    return {
      schema: "kilo.security-decision/v1",
      policy_version: R.POLICY_VERSION,
      rule_id: result.rule_id,
      reason: result.reason,
      decision: result.decision,
      reviewer: SecurityReviewer.SKIPPED,
      reviewer_truncated: truncated,
      reviewer_binding: attribution.reason,
      ...(attribution.model ? { reviewer_model: attribution.model } : {}),
      authority_level: ctx.floor.authority,
      authority_basis:
        ctx.floor.authority === "xdg_global" ? "xdg_scope" : ctx.floor.authority === "hard" ? "hard_product" : "none",
      authority_conflict: ctx.floor.conflict,
      metadata_complete: metadata.complete,
      metadata_truncated: metadata.truncated,
      containment: ctx.containment,
      requirements: result.requirements,
      latency_ms: Date.now() - started,
      ...(request.callID ? { callID: request.callID } : {}),
      sessionID: request.sessionID,
    }
  }

  export function evaluate(request: Request, ctx: Context): Directive {
    const started = Date.now()
    try {
      const input = toInput(request, ctx)
      const initial = SecurityDecision.decide(input)
      const prepared =
        initial.decision === "ask" && initial.reviewable
          ? SecurityReviewer.request({
              rule_id: initial.rule_id,
              kind: input.action.kind,
              operation: input.action.operation,
              ...(input.action.exec?.executable ? { executable: input.action.exec.executable } : {}),
              argv: input.action.exec?.argv,
              ...(input.action.exec?.commands ? { commands: input.action.exec.commands } : {}),
              paths: input.action.paths,
              containment: ctx.containment,
              // What the model said it was doing. Untrusted, model-authored context that makes the
              // reviewer's question answerable; it is never evidence and never relaxes a rule.
              ...(typeof request.metadata?.["description"] === "string"
                ? { task: request.metadata["description"] }
                : {}),
            })
          : undefined
      const metadata = { ...input.metadata, truncated: input.metadata.truncated || prepared?.truncated === true }
      const result = prepared?.truncated ? R.result(R.METADATA_INCOMPLETE) : initial
      return {
        decision: result.decision,
        rule_id: result.rule_id,
        reviewable: result.reviewable,
        ...(prepared?.request ? { review: prepared.request } : {}),
        audit: audit(request, ctx, result, metadata, started, prepared?.truncated === true),
      }
    } catch {
      // Anything unexpected in normalization, the core or the reviewer fails closed to ask.
      const result = R.result(R.INTERNAL_ERROR)
      return {
        decision: result.decision,
        rule_id: result.rule_id,
        reviewable: false,
        audit: {
          ...audit(
            { permission: "", patterns: [], sessionID: request.sessionID, callID: request.callID },
            ctx,
            result,
            { complete: false, truncated: false },
            started,
          ),
          metadata_complete: false,
        },
      }
    }
  }

  export function finalize(record: Audit, enforcement: Enforcement, source: string): Audit {
    return {
      ...record,
      final_enforcement: enforcement,
      enforcement_source: source,
      terminal_status: TERMINAL[record.reviewer.state],
    }
  }
}
