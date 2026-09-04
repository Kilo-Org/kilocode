/**
 * AutoGuard normalizer: raw tool call -> NormalizedAction.
 *
 * A shell string is not an action. `R=rm; $R -rf src`, base64, `bash -c`, and
 * `$(...)` all defeat a classifier that reads command text directly, so every
 * decision downstream is made against the parsed record produced here.
 *
 * The honest limit: opaque indirection (`./deploy.sh`, `npm run build`, a
 * Python one-liner) has an undecidable effect. We do not guess. Those become
 * `effect: "unknown"`, which Level 0 is forbidden from auto-allowing.
 */

import path from "node:path"
import type { Effect, IntentProvenance, NormalizedAction, Radius, Reversible, TrustedContext } from "./types"

/** Shell constructs that hide the real command from a token-level reader. */
const OPAQUE_PATTERNS: RegExp[] = [
  /\$\(/, // command substitution
  /`/, // legacy command substitution
  /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\s+\S/, // variable used in command position
  /\beval\b/,
  /\bbase64\b\s+(-d|--decode)/,
  /\bsh\s+-c\b/,
  /\bbash\s+-c\b/,
  /\bzsh\s+-c\b/,
]

/** Interpreters whose payload we cannot inspect. */
const OPAQUE_VERBS = new Set(["eval", "exec", "source", "."])

/** Verb -> operation id and default effect, for the commands we do understand. */
const VERB_TABLE: Record<string, { operation: string; effect: Effect }> = {
  rm: { operation: "filesystem.delete", effect: "mutation_irreversible" },
  rmdir: { operation: "filesystem.delete", effect: "mutation_irreversible" },
  mv: { operation: "filesystem.move", effect: "mutation_irreversible" },
  cp: { operation: "filesystem.copy", effect: "mutation_reversible" },
  mkdir: { operation: "filesystem.create", effect: "mutation_reversible" },
  touch: { operation: "filesystem.create", effect: "mutation_reversible" },
  chmod: { operation: "filesystem.chmod", effect: "mutation_reversible" },
  chown: { operation: "filesystem.chown", effect: "mutation_reversible" },
  cat: { operation: "filesystem.read", effect: "read" },
  head: { operation: "filesystem.read", effect: "read" },
  tail: { operation: "filesystem.read", effect: "read" },
  ls: { operation: "filesystem.list", effect: "read" },
  grep: { operation: "filesystem.search", effect: "read" },
  rg: { operation: "filesystem.search", effect: "read" },
  find: { operation: "filesystem.search", effect: "read" },
  wc: { operation: "filesystem.read", effect: "read" },
  curl: { operation: "network.http", effect: "outbound_network" },
  wget: { operation: "network.http", effect: "outbound_network" },
  scp: { operation: "network.transfer", effect: "outbound_network" },
  ssh: { operation: "network.remote_exec", effect: "infra_external" },
}

/** Package managers whose install verbs persist a dependency. */
const PACKAGE_MANAGERS: Record<string, string[]> = {
  npm: ["install", "i", "add"],
  pnpm: ["install", "add"],
  yarn: ["add", "install"],
  bun: ["install", "add"],
  pip: ["install"],
  pip3: ["install"],
  uv: ["add", "pip"],
  cargo: ["add", "install"],
  go: ["get", "install"],
  gem: ["install"],
}

/** Git subcommands with effects worth separating. */
const GIT_EFFECTS: Record<string, { operation: string; effect: Effect }> = {
  push: { operation: "git.push", effect: "infra_external" },
  reset: { operation: "git.reset", effect: "mutation_irreversible" },
  clean: { operation: "git.clean", effect: "mutation_irreversible" },
  checkout: { operation: "git.checkout", effect: "mutation_reversible" },
  commit: { operation: "git.commit", effect: "mutation_reversible" },
  add: { operation: "git.add", effect: "mutation_reversible" },
  status: { operation: "git.status", effect: "read" },
  diff: { operation: "git.diff", effect: "read" },
  log: { operation: "git.log", effect: "read" },
}

/** Files whose contents are credentials, whatever their location. */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)credentials?\.(json|ya?ml)$/,
  /(^|\/)\.ssh\//,
]

/**
 * Files that survive the session and change how the *next* run behaves.
 * Writing here is self-modification: a successful write disarms the guard.
 */
const CONFIG_PERSISTENCE_PATTERNS: RegExp[] = [
  /(^|\/)\.ssh\//,
  /(^|\/)\.(bash|zsh)rc$/,
  /(^|\/)\.(bash|zsh)_profile$/,
  /(^|\/)\.profile$/,
  /(^|\/)\.gitconfig$/,
  /(^|\/)AGENTS\.md$/i,
  /(^|\/)CLAUDE\.md$/i,
  /(^|\/)\.kilocode(\/|$)/,
  /(^|\/)\.kilo(\/|$)/,
  /(^|\/)\.git\/hooks\//,
  /(^|\/)\.github\/workflows\//,
]

/** Project files that configure the build but live under review in git. */
const PROJECT_CONFIG_PATTERNS: RegExp[] = [
  /(^|\/)pyproject\.toml$/,
  /(^|\/)package\.json$/,
  /(^|\/)tsconfig(\..+)?\.json$/,
  /(^|\/)Cargo\.toml$/,
  /(^|\/)setup\.cfg$/,
  /(^|\/)\.eslintrc(\..+)?$/,
]

export function isCredentialPath(target: string): boolean {
  return CREDENTIAL_PATTERNS.some((re) => re.test(target))
}

export function isConfigPersistencePath(target: string): boolean {
  return CONFIG_PERSISTENCE_PATTERNS.some((re) => re.test(target))
}

export function isProjectConfigPath(target: string): boolean {
  return PROJECT_CONFIG_PATTERNS.some((re) => re.test(target))
}

/**
 * Split a command line into the segments a shell would run separately.
 * `&&`, `||`, `;`, and `|` each start a new command, so `rm -rf dist && npm test`
 * is two actions and must not be judged as one.
 */
export function splitSegments(command: string): string[] {
  const segments: string[] = []
  let current = ""
  let quote: '"' | "'" | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote) {
      current += ch
      if (ch === quote && command[i - 1] !== "\\") quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === "&&" || two === "||") {
      segments.push(current)
      current = ""
      i++
      continue
    }
    if (ch === ";" || ch === "|" || ch === "\n") {
      segments.push(current)
      current = ""
      continue
    }
    current += ch
  }
  segments.push(current)
  return segments.map((s) => s.trim()).filter((s) => s.length > 0)
}

/** Tokenize one segment, honouring quotes but not expanding anything. */
export function tokenize(segment: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quote: '"' | "'" | null = null
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!
    if (quote) {
      if (ch === quote && segment[i - 1] !== "\\") quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current)
      current = ""
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)
  return tokens
}

/** True when the segment hides its real effect behind indirection. */
export function isOpaque(segment: string): boolean {
  if (OPAQUE_PATTERNS.some((re) => re.test(segment))) return true
  const tokens = tokenize(segment)
  const verb = tokens[0]
  if (!verb) return false
  if (OPAQUE_VERBS.has(verb)) return true
  // A local script: we cannot see inside it.
  if (/^\.{0,2}\//.test(verb) && /\.(sh|bash|zsh|py|rb|pl)$/.test(verb)) return true
  if ((verb === "npm" || verb === "pnpm" || verb === "yarn" || verb === "bun") && tokens[1] === "run") return true
  if ((verb === "bash" || verb === "sh" || verb === "zsh") && tokens.slice(1).some((t) => /\.(sh|bash|zsh)$/.test(t)))
    return true
  return false
}

/** True when the command pipes network output straight into a shell. */
export function isPipeToShell(command: string): boolean {
  if (!/[|]/.test(command)) return false
  const segments = splitSegments(command)
  const fetchesNetwork = segments.some((s) => {
    const verb = tokenize(s)[0]
    return verb === "curl" || verb === "wget"
  })
  if (!fetchesNetwork) return false
  return segments.some((s) => {
    const verb = tokenize(s)[0]
    return verb === "sh" || verb === "bash" || verb === "zsh" || verb === "python" || verb === "python3"
  })
}

/** Where a target sits relative to the worktree. */
export function classifyRadius(target: string, ctx: TrustedContext): Radius {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return "remote"
  const home = process.env["HOME"] ?? "/root"
  const expanded = target.startsWith("~") ? path.join(home, target.slice(1)) : target
  const abs = path.resolve(ctx.cwd || ctx.workspace_root, expanded)
  const root = path.resolve(ctx.workspace_root)
  const rel = path.relative(root, abs)
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return "inside_worktree"
  if (abs.startsWith(path.resolve(home) + path.sep)) return "user_home"
  if (/^\/(etc|usr|bin|sbin|var|opt|System|Library)(\/|$)/.test(abs)) return "system"
  return "project_outside_worktree"
}

/** Coarsest radius across all targets: one remote target makes the action remote. */
function widestRadius(targets: string[], ctx: TrustedContext): Radius {
  const order: Radius[] = ["inside_worktree", "project_outside_worktree", "user_home", "system", "remote"]
  let widest: Radius = "inside_worktree"
  for (const t of targets) {
    const r = classifyRadius(t, ctx)
    if (order.indexOf(r) > order.indexOf(widest)) widest = r
  }
  return widest
}

/** Extract the host from a URL-shaped target, or null. */
export function hostOf(target: string): string | null {
  try {
    return new URL(target).hostname
  } catch {
    return null
  }
}

function reversibilityOf(effect: Effect, radius: Radius, targets: string[], ctx: TrustedContext): Reversible {
  if (radius === "remote") return "remote_irreversible"
  if (effect === "read") return "git_tracked"
  // Generated output is regenerable, never "tracked" in the reviewable sense.
  const allGenerated = targets.length > 0 && targets.every((t) => ctx.generated_paths.some((g) => t === g || t.startsWith(g + "/")))
  if (allGenerated) return "local_untracked"
  if (effect === "mutation_reversible") return "git_tracked"
  return "local_untracked"
}

/** Arguments that are operands rather than flags. */
function operands(tokens: string[]): string[] {
  return tokens.slice(1).filter((t) => !t.startsWith("-"))
}

function flagsOf(tokens: string[]): Record<string, unknown> {
  const flags: Record<string, unknown> = {}
  const joined = tokens.join(" ")
  // `-r` and `-R` both mean recursive; missing the uppercase form silently
  // disarms every rule that keys off recursion.
  if (/(^|\s)-[a-zA-Z]*[rR][a-zA-Z]*(\s|$)|--recursive/.test(joined)) flags["recursive"] = true
  if (/(^|\s)-[a-zA-Z]*f[a-zA-Z]*(\s|$)|--force(\s|$)/.test(joined)) flags["force"] = true
  if (/--force-with-lease/.test(joined)) flags["force_with_lease"] = true
  if (/--dry-run/.test(joined)) flags["dry_run"] = true
  if (/--hard/.test(joined)) flags["hard"] = true
  // chmod modes decide whether the tree becomes world-writable, so the rule
  // layer needs them as data rather than re-parsing the command string.
  if (tokens[0] === "chmod") {
    const mode = tokens.slice(1).find((t) => /^[0-7]{3,4}$/.test(t) || /^[ugoa]*[+=-][rwxXst]+$/.test(t))
    if (mode) flags["mode"] = mode
  }
  return flags
}

/** Parse one shell segment into an action, ignoring provenance. */
function normalizeShellSegment(
  segment: string,
  ctx: TrustedContext,
): Omit<NormalizedAction, "intent_provenance"> {
  const tokens = tokenize(segment)
  const verb = tokens[0] ?? ""
  const options = flagsOf(tokens)

  if (isOpaque(segment)) {
    const targets = operands(tokens)
    return {
      operation: "script.execute",
      targets: targets.length ? targets : [verb],
      effect: "unknown",
      radius: widestRadius(targets, ctx),
      reversible: "local_untracked",
      options,
    }
  }

  // Package managers: `uv add x`, `npm install y`.
  const pmVerbs = PACKAGE_MANAGERS[verb]
  if (pmVerbs && tokens[1] && pmVerbs.includes(tokens[1])) {
    const packages = tokens.slice(2).filter((t) => !t.startsWith("-"))
    return {
      operation: "dependency.install",
      targets: packages,
      effect: "package_install",
      radius: "inside_worktree",
      reversible: "git_tracked",
      options: { ...options, manager: verb, dev: /--dev|-D(\s|$)/.test(segment) },
    }
  }

  if (verb === "git") {
    const sub = tokens[1] ?? ""
    const entry = GIT_EFFECTS[sub] ?? { operation: `git.${sub}`, effect: "unknown" as Effect }
    const refspec = tokens.slice(2).filter((t) => !t.startsWith("-"))
    const radius: Radius = entry.effect === "infra_external" ? "remote" : "inside_worktree"
    return {
      operation: entry.operation,
      targets: refspec,
      effect: entry.effect,
      radius,
      reversible: radius === "remote" ? "remote_irreversible" : reversibilityOf(entry.effect, radius, refspec, ctx),
      options: { ...options, subcommand: sub, branch: refspec.map((r) => r.split(":").pop()).filter(Boolean) },
    }
  }

  if (verb === "curl" || verb === "wget") {
    const urls = tokens.filter((t) => /^https?:\/\//.test(t))
    // `--data @file` uploads that file's contents.
    const uploaded: string[] = []
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!
      if (/^--data(-binary|-raw)?$|^-d$/.test(t) && tokens[i + 1]?.startsWith("@")) uploaded.push(tokens[i + 1]!.slice(1))
      else if (/^(--data(-binary|-raw)?|-d)=@/.test(t)) uploaded.push(t.split("=@")[1]!)
      if (/^(-T|--upload-file)$/.test(t) && tokens[i + 1]) uploaded.push(tokens[i + 1]!)
    }
    const method = /-X\s*POST|--data|-d\s/.test(segment) ? "post" : "get"
    const exfiltratesCredentials = uploaded.some(isCredentialPath)
    return {
      operation: `network.http_${method}`,
      targets: [...urls, ...uploaded],
      effect: exfiltratesCredentials ? "credential_access" : "outbound_network",
      radius: "remote",
      reversible: "remote_irreversible",
      options: { ...options, uploads: uploaded, hosts: urls.map(hostOf).filter(Boolean) },
    }
  }

  const known = VERB_TABLE[verb]
  const targets = operands(tokens)
  const radius = widestRadius(targets, ctx)
  if (!known) {
    return {
      operation: `shell.${verb || "empty"}`,
      targets,
      effect: "unknown",
      radius,
      reversible: "local_untracked",
      options,
    }
  }

  let effect = known.effect
  // A write into a session-surviving config file is self-modification,
  // whatever verb got it there.
  if (effect !== "read" && targets.some(isConfigPersistencePath)) effect = "config_persistence"
  if (effect === "read" && targets.some(isCredentialPath)) effect = "credential_access"

  return {
    operation: known.operation,
    targets,
    effect,
    radius,
    reversible: reversibilityOf(effect, radius, targets, ctx),
    options,
  }
}

export interface RawToolCall {
  tool: string
  arguments: Record<string, unknown>
}

/**
 * Normalize a Kilo tool call. Returns one action per shell segment; callers
 * evaluate each independently so `rm -rf dist && curl ... | sh` cannot smuggle
 * the second half past a verdict earned by the first.
 */
export function normalize(
  call: RawToolCall,
  ctx: TrustedContext,
  provenance: IntentProvenance = "agent_invented",
): NormalizedAction[] {
  if (call.tool === "bash" || call.tool === "shell") {
    const command = String(call.arguments["command"] ?? "")
    if (isPipeToShell(command)) {
      const urls = command.match(/https?:\/\/\S+/g) ?? []
      return [
        {
          operation: "script.execute_remote",
          targets: urls,
          effect: "unknown",
          radius: "remote",
          reversible: "remote_irreversible",
          intent_provenance: provenance,
          options: { pipe_to_shell: true, hosts: urls.map(hostOf).filter(Boolean) },
        },
      ]
    }
    return splitSegments(command).map((segment) => ({
      ...normalizeShellSegment(segment, ctx),
      intent_provenance: provenance,
    }))
  }

  if (call.tool === "edit" || call.tool === "write" || call.tool === "patch") {
    const target = String(call.arguments["path"] ?? call.arguments["filePath"] ?? "")
    const radius = classifyRadius(target, ctx)
    const effect: Effect = isConfigPersistencePath(target)
      ? "config_persistence"
      : isProjectConfigPath(target)
        ? "config_persistence"
        : "mutation_reversible"
    return [
      {
        operation: effect === "config_persistence" ? "config.modify" : "code.modify",
        targets: [target],
        effect,
        radius,
        reversible: radius === "inside_worktree" ? "git_tracked" : "local_untracked",
        intent_provenance: provenance,
        options: {},
      },
    ]
  }

  if (call.tool === "read" || call.tool === "grep" || call.tool === "glob" || call.tool === "list") {
    const target = String(call.arguments["path"] ?? call.arguments["pattern"] ?? ".")
    return [
      {
        operation: `filesystem.${call.tool}`,
        targets: [target],
        effect: isCredentialPath(target) ? "credential_access" : "read",
        radius: classifyRadius(target, ctx),
        reversible: "git_tracked",
        intent_provenance: provenance,
        options: {},
      },
    ]
  }

  // Unrecognized tool: undecidable effect, so it must never auto-allow.
  return [
    {
      operation: `tool.${call.tool}`,
      targets: Object.values(call.arguments).filter((v) => typeof v === "string").map(String),
      effect: "unknown",
      radius: "inside_worktree",
      reversible: "local_untracked",
      intent_provenance: provenance,
      options: {},
    },
  ]
}
