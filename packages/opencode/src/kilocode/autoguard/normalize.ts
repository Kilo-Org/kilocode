import { split as splitGlob } from "../tool/glob-pattern"
import path from "node:path"
import os from "node:os"
import { parsePatch } from "../../patch"
import { canonical, inside, resource, tracked, digest } from "./resources"
import { segments, tokens, opaque, testArguments, readArguments } from "./argv"
import type { ActionIR, Effect, IntentProvenance, NormalizedAction, Radius, Resource, TrustedContext } from "./types"

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

export const splitSegments = segments
export const tokenize = tokens
export function isOpaque(command: string): boolean {
  return (
    opaque(command) ||
    /\bbase64\s|^(npm|yarn|pnpm)\s+(run|test|build)\b/.test(command) ||
    /^(?:bash|sh|zsh|env|sudo|eval|exec|source|cd|\.\/|python\S*\s+(?!-m\s+(?:pytest|unittest)\b))/.test(command)
  )
}
export function isPipeToShell(command: string): boolean {
  if (!command.includes("|")) return false
  const parts = segments(command)
  return parts.some((x) => /^(curl|wget)\b/.test(x)) && parts.some((x) => /^(sh|bash|zsh|python3?)\b/.test(x))
}
export function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname
  } catch {
    return null
  }
}
export function classifyRadius(target: string, ctx: TrustedContext): Radius {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return "remote"
  const absolute = canonical(target, ctx.cwd)
  if (inside(canonical(ctx.workspace_root, ctx.cwd), absolute)) return "inside_worktree"
  if (inside(os.homedir(), absolute)) return "user_home"
  return /^\/(?:private\/)?(etc|usr|bin|sbin|var|opt|System|Library)(\/|$)/.test(absolute)
    ? "system"
    : "project_outside_worktree"
}
function widest(resources: Resource[], ctx: TrustedContext): Radius {
  const order: Radius[] = ["inside_worktree", "project_outside_worktree", "user_home", "system", "remote"]
  return resources.reduce<Radius>((current, item) => {
    const next = item.kind === "reference" ? "inside_worktree" : classifyRadius(item.key, ctx)
    return order.indexOf(next) > order.indexOf(current) ? next : current
  }, "inside_worktree")
}
function action(
  operation: string,
  targets: string[],
  effect: Effect,
  ctx: TrustedContext,
  options: Record<string, unknown> = {},
  kind?: Resource["kind"],
): NormalizedAction {
  try {
    const resources = targets.map((target) => resource(target, ctx, kind))
    const radius = widest(resources, ctx)
    const keys = resources.map((item) => item.key)
    const credential = resources.some((r) => isCredentialPath(r.key) || isCredentialPath(r.raw))
    const persistence =
      operation === "config.modify" ||
      resources.some((r) => isConfigPersistencePath(r.key) || isConfigPersistencePath(r.raw))
    const next =
      credential && effect === "read"
        ? "credential_access"
        : persistence && effect !== "read"
          ? "config_persistence"
          : effect
    return {
      operation,
      targets: keys,
      resources,
      effect: next,
      radius,
      intent_provenance: "agent_invented",
      options,
      reversible:
        radius === "remote"
          ? "remote_irreversible"
          : effect === "mutation_reversible" && keys.length > 0 && keys.every((x) => tracked(x, ctx))
            ? "git_tracked"
            : "local_untracked",
      uncertainty: [],
    }
  } catch (err) {
    return unknown(operation, err instanceof Error ? err.message : "unresolvable_target", options)
  }
}
function unknown(operation: string, reason: string, options: Record<string, unknown> = {}): NormalizedAction {
  return {
    operation,
    targets: [],
    resources: [],
    effect: "unknown",
    radius: "inside_worktree",
    reversible: "local_untracked",
    intent_provenance: "agent_invented",
    options,
    uncertainty: [reason],
  }
}
function shell(segment: string, ctx: TrustedContext): NormalizedAction {
  const argv = tokens(segment)
  const verb = argv[0] ?? ""
  if (!verb || isOpaque(segment)) return unknown("script.execute", "opaque_shell", { argv })
  const test = testArguments(argv, ctx.cwd)
  if (test) return action("test.run", test.targets, "unknown", ctx, test.options)
  if (/^(pytest|py\.test|python3?)$/.test(verb)) return unknown("test.run", "unsupported_test_arguments", { argv })
  if (/^(cat|head|tail|ls|rg|grep|wc)$/.test(verb)) {
    const parsed = readArguments(argv)
    return parsed
      ? action(
          verb === "ls" ? "filesystem.list" : /^(rg|grep)$/.test(verb) ? "filesystem.search" : "filesystem.read",
          parsed.targets,
          "read",
          ctx,
          { ...parsed.options, argv },
        )
      : unknown("filesystem.read", "unsupported_read_arguments", { argv })
  }
  if (verb === "rm") {
    const targets: string[] = []
    const options: Record<string, unknown> = { argv }
    let positional = false
    for (const value of argv.slice(1)) {
      if (!positional && value === "--") {
        positional = true
        continue
      }
      if (!positional && value.startsWith("-")) {
        if (!/^-[rfRiv]+$|^--(recursive|force|verbose)$/.test(value))
          return unknown("filesystem.delete", "unsupported_delete_arguments", options)
        if (/r|R|--recursive/.test(value)) options.recursive = true
        if (/f|--force/.test(value)) options.force = true
        continue
      }
      if (/[*?\[\]]/.test(value)) return unknown("filesystem.delete", "unexpanded_glob", options)
      targets.push(value)
    }
    return targets.length
      ? action("filesystem.delete", targets, "mutation_irreversible", ctx, options)
      : unknown("filesystem.delete", "missing_target", options)
  }
  if (verb === "git") {
    const sub = argv[1] ?? ""
    const targets = argv.slice(2).filter((x) => !x.startsWith("-"))
    const options = {
      argv,
      force: argv.some((x) => x === "--force" || x === "-f" || x.startsWith("+")),
      force_with_lease: argv.some((x) => x.startsWith("--force-with-lease")),
      hard: argv.includes("--hard"),
      branch: targets.map((x) => (x.includes(":") ? x.slice(x.lastIndexOf(":") + 1) : x)),
    }
    if (sub === "push")
      return {
        ...action("git.push", targets, "infra_external", ctx, options, "reference"),
        radius: "remote",
        reversible: "remote_irreversible",
      }
    // Configured git helpers may execute code. These are not plain filesystem reads.
    return unknown(`git.${sub}`, "git_execution_requires_profile", options)
  }
  if (verb === "curl" || verb === "wget") {
    const uploads: string[] = []
    for (let i = 1; i < argv.length; i++) {
      const value = argv[i]
      if (/^(-d|--data|--data-binary|--data-raw|-T|--upload-file)$/.test(value) && argv[i + 1])
        uploads.push(argv[++i].replace(/^@/, ""))
      const match = value.match(/^(?:--data(?:-binary|-raw)?=|-d)(@.+)$|^(?:--upload-file=|-T)(.+)$/)
      if (match) uploads.push((match[1] ?? match[2]).replace(/^@/, ""))
    }
    const urls = argv.filter((x) => /^https?:\/\//.test(x))
    const result = action(
      uploads.length ? "network.http_post" : "network.http_get",
      [...urls, ...uploads],
      uploads.some(isCredentialPath) ? "credential_access" : "outbound_network",
      ctx,
      { argv, uploads: uploads.map((x) => canonical(x, ctx.cwd)), hosts: urls.map(hostOf).filter(Boolean) },
    )
    return {
      ...result,
      radius: "remote",
      reversible: "remote_irreversible",
      uncertainty: ["network_effects_not_fully_resolved"],
    }
  }
  if (verb === "chmod") {
    const mode = argv.find((x) => /^[0-7]{3,4}$|^[ugoa]+[+=-][rwxXst]+$/.test(x))
    return action(
      "filesystem.chmod",
      argv.slice(1).filter((x) => !x.startsWith("-") && x !== mode),
      "mutation_irreversible",
      ctx,
      { argv, mode, recursive: argv.includes("-R") || argv.includes("--recursive") },
    )
  }
  return unknown(`shell.${verb}`, "unsupported_command", { argv })
}
export interface RawToolCall {
  tool: string
  arguments: Record<string, unknown>
  callID?: string
}

export function normalize(
  call: RawToolCall,
  ctx: TrustedContext,
  provenance: IntentProvenance = "agent_invented",
): NormalizedAction[] {
  const args = call.arguments
  const finish = (values: NormalizedAction[]) => values.map((value) => ({ ...value, intent_provenance: provenance }))
  try {
    if (call.tool === "bash" || call.tool === "shell") {
      const command = typeof args.command === "string" ? args.command : ""
      const cwd = typeof args.workdir === "string" ? canonical(args.workdir, ctx.cwd) : ctx.cwd
      const context = { ...ctx, cwd }
      if (isPipeToShell(command))
        return finish([
          { ...unknown("script.execute_remote", "pipe_to_shell", { pipe_to_shell: true }), radius: "remote" },
        ])
      if (opaque(command)) return finish([unknown("script.execute", "unsupported_shell_syntax")])
      const parts = segments(command)
      if (!parts.length) return finish([unknown("script.execute", "empty_command")])
      return finish(parts.map((part) => shell(part, context)))
    }
    if (call.tool === "apply_patch") {
      if (typeof args.patchText !== "string") return finish([unknown("code.modify", "missing_patch")])
      const parsed = parsePatch(args.patchText)
      const values = parsed.hunks.flatMap((hunk) => {
        if (hunk.type === "delete") return [action("filesystem.delete", [hunk.path], "mutation_irreversible", ctx)]
        if (hunk.type === "update" && hunk.move_path)
          return [
            action("filesystem.delete", [hunk.path], "mutation_irreversible", ctx, { move: true }),
            action("code.modify", [hunk.move_path], "mutation_reversible", ctx, { create: true, move: true }),
          ]
        return [action("code.modify", [hunk.path], "mutation_reversible", ctx, { create: hunk.type === "add" })]
      })
      return finish(values.length ? values : [unknown("code.modify", "empty_patch")])
    }
    if (/^(edit|write|read)$/.test(call.tool)) {
      const target = args.filePath ?? args.path
      if (typeof target !== "string" || !target.trim())
        return finish([unknown(`filesystem.${call.tool}`, "missing_target")])
      return finish([
        action(
          call.tool === "read" ? "filesystem.read" : isProjectConfigPath(target) ? "config.modify" : "code.modify",
          [target],
          call.tool === "read" ? "read" : "mutation_reversible",
          ctx,
        ),
      ])
    }
    if (/^(grep|glob|list)$/.test(call.tool)) {
      if (args.path != null && typeof args.path !== "string")
        return finish([unknown("filesystem.search", "invalid_target")])
      if (call.tool !== "list" && typeof args.pattern !== "string")
        return finish([unknown("filesystem.search", "missing_pattern")])
      const absolute = call.tool === "glob" ? splitGlob(String(args.pattern)) : undefined
      const target = absolute?.dir ?? path.resolve(ctx.cwd, typeof args.path === "string" ? args.path : ".")
      return finish([
        action(
          `filesystem.${call.tool}`,
          [target],
          "read",
          ctx,
          { pattern: absolute?.pattern ?? args.pattern },
          call.tool === "grep" ? undefined : "directory",
        ),
      ])
    }
    if (call.tool === "skill")
      return finish([
        action("skill.read", [String(args.name ?? "")], "read", ctx, { shell_disabled: true }, "reference"),
      ])
    if (["todowrite", "todoread", "question"].includes(call.tool))
      return finish([action("session.coordinate", [], "read", ctx, { grants_authority: false })])
    if (call.tool === "task") return finish([action("task.delegate", [], "unknown", ctx, { inherits_contract: true })])
    return finish([unknown(`tool.${call.tool}`, "unsupported_tool")])
  } catch (err) {
    return finish([unknown(`tool.${call.tool}`, err instanceof Error ? err.message : "invalid_call")])
  }
}

export function normalizeCall(call: RawToolCall, ctx: TrustedContext): ActionIR {
  const actions = normalize(call, ctx)
  const cwd =
    typeof call.arguments.workdir === "string"
      ? canonical(call.arguments.workdir, ctx.cwd)
      : canonical(ctx.cwd, ctx.workspace_root)
  const argv = actions.map((item) => (Array.isArray(item.options.argv) ? (item.options.argv as string[]) : []))
  return {
    version: 1,
    tool: call.tool,
    call_id: call.callID ?? "offline",
    cwd,
    argv,
    actions,
    fingerprint: digest({
      tool: call.tool,
      cwd,
      actions: actions.map(({ resources: _resources, ...item }) => item),
      payload: /^(edit|write|apply_patch)$/.test(call.tool) ? digest(call.arguments) : undefined,
    }),
    uncertainty: actions.flatMap((item) => item.uncertainty ?? []),
  }
}
