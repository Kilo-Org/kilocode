// kilocode_change - new file
import { Permission } from "@/permission"
import { NamedError } from "@opencode-ai/shared/util/error"
import { Glob } from "@opencode-ai/shared/util/glob"
import { Truncate } from "../../tool"
import { Config } from "../../config"
import { Instance } from "../../project/instance"
import { makeRuntime } from "@/effect/run-service"
import { Global } from "@/global"
import { Telemetry } from "@kilocode/kilo-telemetry"
import z from "zod"
import path from "path"

import PROMPT_DEBUG from "../../agent/prompt/debug.txt"
import PROMPT_ORCHESTRATOR from "../../agent/prompt/orchestrator.txt"
import PROMPT_ASK from "../../agent/prompt/ask.txt"
import PROMPT_EXPLORE from "../../agent/prompt/explore.txt"

// Safe bash commands that don't need user approval.
// Only commands that cannot execute arbitrary code or subprocesses.
export const bash: Record<string, "allow" | "ask" | "deny"> = {
  "*": "ask",
  // read-only / informational
  "cat *": "allow",
  "head *": "allow",
  "tail *": "allow",
  "less *": "allow",
  "ls *": "allow",
  "tree *": "allow",
  "pwd *": "allow",
  "echo *": "allow",
  "wc *": "allow",
  "which *": "allow",
  "type *": "allow",
  "file *": "allow",
  "diff *": "allow",
  "du *": "allow",
  "df *": "allow",
  "date *": "allow",
  "uname *": "allow",
  "whoami *": "allow",
  "printenv *": "allow",
  "man *": "allow",
  // text processing
  "grep *": "allow",
  "rg *": "allow",
  "ag *": "allow",
  "sort *": "allow",
  "uniq *": "allow",
  "cut *": "allow",
  "tr *": "allow",
  "jq *": "allow",
  // file operations
  "touch *": "allow",
  "mkdir *": "allow",
  "cp *": "allow",
  "mv *": "allow",
  // compilers (no script execution)
  "tsc *": "allow",
  "tsgo *": "allow",
  // archive
  "tar *": "allow",
  "unzip *": "allow",
  "gzip *": "allow",
  "gunzip *": "allow",
}

// Read-only bash commands for ask/plan agents.
// Unknown commands are DENIED (not "ask") because these agents must never modify the filesystem.
export const readOnlyBash: Record<string, "allow" | "ask" | "deny"> = {
  "*": "deny",
  // read-only / informational
  "cat *": "allow",
  "head *": "allow",
  "tail *": "allow",
  "less *": "allow",
  "ls *": "allow",
  "tree *": "allow",
  "pwd *": "allow",
  "echo *": "allow",
  "wc *": "allow",
  "which *": "allow",
  "type *": "allow",
  "file *": "allow",
  "diff *": "allow",
  "du *": "allow",
  "df *": "allow",
  "date *": "allow",
  "uname *": "allow",
  "whoami *": "allow",
  "printenv *": "allow",
  "man *": "allow",
  // text processing (stdout only, no file modification)
  "grep *": "allow",
  "rg *": "allow",
  "ag *": "allow",
  "sort *": "allow",
  "uniq *": "allow",
  "cut *": "allow",
  "tr *": "allow",
  "jq *": "allow",
  // git — allowlist of read-only subcommands, deny everything else
  "git *": "deny",
  "git log *": "allow",
  "git show *": "allow",
  "git diff *": "allow",
  "git status *": "allow",
  "git blame *": "allow",
  "git rev-parse *": "allow",
  "git rev-list *": "allow",
  "git ls-files *": "allow",
  "git ls-tree *": "allow",
  "git ls-remote *": "allow",
  "git shortlog *": "allow",
  "git describe *": "allow",
  "git cat-file *": "allow",
  "git name-rev *": "allow",
  "git stash list *": "allow",
  "git tag -l *": "allow",
  "git branch --list *": "allow",
  "git branch -a *": "allow",
  "git branch -r *": "allow",
  "git remote -v *": "allow",
  // gh — require user approval since commands vary widely
  "gh *": "ask",
}

// Generate per-server MCP wildcard rules that allow MCP tools with user approval.
export function getMcpRules(cfg: Config.Info): Record<string, "allow" | "ask" | "deny"> {
  const rules: Record<string, "allow" | "ask" | "deny"> = {}
  for (const key of Object.keys(cfg.mcp ?? {})) {
    const sanitized = key.replace(/[^a-zA-Z0-9_-]/g, "_")
    rules[sanitized + "_*"] = "ask"
  }
  return rules
}

export interface KiloData {
  mcpRules: Record<string, "allow" | "ask" | "deny">
  defaultsPatch: Permission.Ruleset
}

// Prepare kilo-specific data derived from config. Call once per state initialization.
export function prepare(cfg: Config.Info): KiloData {
  const mcpRules = getMcpRules(cfg)
  const defaultsPatch = Permission.fromConfig({ bash, recall: "ask" })
  return { mcpRules, defaultsPatch }
}

// Map "build" config key to "code" for backward compatibility.
export function resolveKey(name: string): string {
  return name === "build" ? "code" : name
}

// Remap "build" → "code" in agent config entries for backward compat in the config loop.
export function preprocessConfig<T>(agentConfig: Record<string, T>): Record<string, T> {
  const result: Record<string, T> = {}
  for (const [key, value] of Object.entries(agentConfig)) {
    result[key === "build" ? "code" : key] = value
  }
  return result
}

// Set displayName and deprecated from options after config item is processed.
export function processConfigItem(item: {
  options: Record<string, unknown>
  displayName?: string
  deprecated?: boolean
}) {
  if (item.options?.displayName && typeof item.options.displayName === "string") {
    item.displayName = item.options.displayName
  }
}

// Returns experimental_telemetry config for generate calls.
export function telemetryOptions(cfg: Config.Info) {
  return {
    isEnabled: cfg.experimental?.openTelemetry !== false,
    recordInputs: false,
    recordOutputs: false,
    tracer: Telemetry.getTracer() ?? undefined,
    metadata: {
      userId: cfg.username ?? "unknown",
    },
  }
}

// Patch the base agents map in-place with all kilo-specific changes:
// - Rename build → code
// - Patch plan with readOnlyBash, mcpRules, .kilo paths
// - Patch explore with codebase_search and conditional prompt
// - Patch appropriate agents with semantic_search
// - Add debug, orchestrator, ask agents
export function patchAgents(
  agents: Record<
    string,
    {
      name: string
      displayName?: string
      description?: string
      deprecated?: boolean
      mode: "subagent" | "primary" | "all"
      native?: boolean
      hidden?: boolean
      topP?: number
      temperature?: number
      color?: string
      permission: Permission.Ruleset
      model?: { modelID: string; providerID: string }
      variant?: string
      prompt?: string
      options: Record<string, unknown>
      steps?: number
    }
  >,
  defaults: Permission.Ruleset,
  user: Permission.Ruleset,
  cfg: Config.Info,
  kilo: KiloData,
) {
  // Rename "build" → "code" for backward compatibility
  if (agents.build) {
    agents.code = {
      ...agents.build,
      name: "code",
      permission: Permission.merge(defaults, Permission.fromConfig({ semantic_search: "allow" }), user),
    }
    delete agents.build
  }

  // Patch plan mode
  if (agents.plan) {
    agents.plan = {
      ...agents.plan,
      description: "Plan mode. Only allows editing plan files; asks before editing anything else.",
      permission: Permission.merge(
        defaults,
        Permission.fromConfig({
          question: "allow",
          suggest: "allow", // kilocode_change
          plan_exit: "allow",
          bash: readOnlyBash,
          ...kilo.mcpRules,
          external_directory: {
            [path.join(Global.Path.data, "plans", "*")]: "allow",
          },
          edit: {
            "*": "ask",
            [path.join(".kilo", "plans", "*.md")]: "allow",
            [path.join(".opencode", "plans", "*.md")]: "allow",
            [path.relative(Instance.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
          },
          semantic_search: "allow",
        }),
        user,
      ),
    }
  }

  // Patch explore with codebase_search and conditional prompt
  if (agents.explore) {
    agents.explore = {
      ...agents.explore,
      permission: Permission.merge(
        defaults,
        Permission.fromConfig({
          "*": "deny",
          grep: "allow",
          glob: "allow",
          list: "allow",
          bash: "allow",
          webfetch: "allow",
          websearch: "allow",
          codesearch: "allow",
          codebase_search: "allow",
          semantic_search: "allow",
          read: "allow",
          external_directory: {
            "*": "ask",
            [Truncate.GLOB]: "allow",
          },
        }),
        user,
      ),
      prompt: cfg.experimental?.codebase_search
        ? `Prefer using the codebase_search tool for codebase searches — it performs intelligent multi-step code search and returns the most relevant code spans.\n\n${PROMPT_EXPLORE}`
        : PROMPT_EXPLORE,
    }
  }

  // Add debug agent
  agents.debug = {
    name: "debug",
    description: "Diagnose and fix software issues with systematic debugging methodology.",
    prompt: PROMPT_DEBUG,
    options: {},
    permission: Permission.merge(
      defaults,
      Permission.fromConfig({
        question: "allow",
        suggest: "allow", // kilocode_change
        plan_enter: "allow",
        semantic_search: "allow",
      }),
      user,
    ),
    mode: "primary",
    native: true,
  }

  // Add orchestrator agent
  agents.orchestrator = {
    name: "orchestrator",
    description: "Coordinate complex tasks by delegating to specialized agents in parallel.",
    prompt: PROMPT_ORCHESTRATOR,
    options: {},
    permission: Permission.merge(
      defaults,
      Permission.fromConfig({
        "*": "deny",
        read: "allow",
        grep: "allow",
        glob: "allow",
        list: "allow",
        question: "allow",
        suggest: "allow", // kilocode_change
        task: "allow",
        todoread: "allow",
        todowrite: "allow",
        webfetch: "allow",
        websearch: "allow",
        codesearch: "allow",
        codebase_search: "allow",
        external_directory: {
          [Truncate.GLOB]: "allow",
        },
      }),
      user,
      // Enforce bash deny after user so user config cannot re-enable shell
      Permission.fromConfig({
        bash: "deny",
      }),
    ),
    mode: "primary",
    native: true,
    deprecated: true,
  }

  // Add ask agent
  agents.ask = {
    name: "ask",
    description: "Get answers and explanations without making changes to the codebase.",
    prompt: PROMPT_ASK,
    options: {},
    permission: Permission.merge(
      defaults,
      user, // user before ask-specific so ask's deny+allowlist wins
      Permission.fromConfig({
        "*": "deny",
        bash: readOnlyBash,
        read: {
          "*": "allow",
          "*.env": "ask",
          "*.env.*": "ask",
          "*.env.example": "allow",
        },
        grep: "allow",
        glob: "allow",
        list: "allow",
        question: "allow",
        webfetch: "allow",
        websearch: "allow",
        codesearch: "allow",
        codebase_search: "allow",
        semantic_search: "allow",
        external_directory: {
          [Truncate.GLOB]: "allow",
        },
        ...kilo.mcpRules,
      }),
      user.filter((r: Permission.Rule) => r.action === "deny"), // re-apply user denies so explicit MCP blocks win over mcpRules
    ),
    mode: "primary",
    native: true,
  }
}

export const RemoveError = NamedError.create(
  "AgentRemoveError",
  z.object({
    name: z.string(),
    message: z.string(),
  }),
)

/**
 * Remove a custom agent by deleting its markdown source file and/or
 * removing it from legacy .kilocodemodes YAML files.
 * Scans all config directories for agent/mode .md files matching the name,
 * then also checks the .kilocodemodes files the ModesMigrator reads.
 */
export async function remove(name: string) {
  const { Agent } = await import("../../agent/agent")
  const agents = makeRuntime(Agent.Service, Agent.defaultLayer)
  const agent = await agents.runPromise((svc) => svc.get(name))
  if (!agent) throw new RemoveError({ name, message: "agent not found" })
  if (agent.native) throw new RemoveError({ name, message: "cannot remove native agent" })
  // Prevent removal of organization-managed agents
  if (agent.options?.source === "organization")
    throw new RemoveError({ name, message: "cannot remove organization agent — manage it from the cloud dashboard" })

  const { unlink, writeFile } = await import("fs/promises")
  let found = false

  // 1. Delete .md files from config directories
  const { Config } = await import("../../config")
  const dirs = await Config.directories()
  const patterns = ["{agent,agents}/**/" + name + ".md", "{mode,modes}/" + name + ".md"]
  for (const dir of dirs) {
    for (const pattern of patterns) {
      const matches = await Glob.scan(pattern, { cwd: dir, absolute: true, dot: true })
      for (const file of matches) {
        if (await Bun.file(file).exists()) {
          await unlink(file)
          found = true
        }
      }
    }
  }

  // 2. Remove from legacy .kilocodemodes YAML files (read by ModesMigrator)
  const { ModesMigrator } = await import("@/kilocode/modes-migrator")
  const { KilocodePaths } = await import("@/kilocode/paths")
  const os = await import("os")
  const matter = (await import("gray-matter")).default
  const home = os.default.homedir()
  const modesFiles = [
    path.join(KilocodePaths.vscodeGlobalStorage(), "settings", "custom_modes.yaml"),
    path.join(home, ".kilocode", "cli", "global", "settings", "custom_modes.yaml"),
    path.join(home, ".kilocodemodes"),
    path.join(Instance.directory, ".kilocodemodes"),
  ]

  for (const file of modesFiles) {
    const modes = await ModesMigrator.readModesFile(file)
    if (!modes.length) continue

    const filtered = modes.filter((m: { slug: string }) => m.slug !== name)
    if (filtered.length === modes.length) continue

    // Rewrite the file without the removed mode
    const yaml = matter
      .stringify("", { customModes: filtered })
      .replace(/^---\n/, "")
      .replace(/\n---\n?$/, "")
    await writeFile(file, yaml)
    found = true
  }

  if (!found) throw new RemoveError({ name, message: "no agent file found on disk" })

  await Instance.dispose()
}
