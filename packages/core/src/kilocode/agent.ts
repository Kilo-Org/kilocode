export * as KiloAgentPlugin from "./agent.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Global } from "@opencode/util/global"
import { Effect, Option, Stream } from "effect"
import path from "path"
import { Permission } from "../permission.js"
import { Shell } from "../shell.js"
import { ToolOutput } from "../tool-output.js"
import { Wildcard } from "../util/wildcard.js"

import AGENT_SWITCH from "./agent/agent-switch.txt"
import PROMPT_ASK from "./agent/ask.txt"
import PROMPT_DEBUG from "./agent/debug.txt"
import PROMPT_ORCHESTRATOR from "./agent/orchestrator.txt"

// Kilo's v1 agent set on the v2 agent registry. This runs before the config plugins, so a user
// agent with the same ID merges over these built-ins and its fields and rules win, as in v1.

const build = Agent.ID.make("build")
const code = Agent.ID.make("code")
const general = Agent.ID.make("general")
const plan = Agent.ID.make("plan")

type Table = Record<string, Permission.Rule["effect"]>

const readable: Table = {
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
  "grep *": "allow",
  "rg *": "allow",
  "ag *": "allow",
  "sort *": "allow",
  "uniq *": "allow",
  "cut *": "allow",
  "tr *": "allow",
  "jq *": "allow",
}

// Default shell rules for agents that may change the workspace: ask before a command unless it
// only reads or does simple file housekeeping.
const shell: Table = {
  "*": "ask",
  ...readable,
  "touch *": "allow",
  "mkdir *": "allow",
  "cp *": "allow",
  "mv *": "allow",
  "tsc *": "allow",
  "tsgo *": "allow",
  "tar *": "allow",
  "unzip *": "allow",
  "gzip *": "allow",
  "gunzip *": "allow",
}

const readOnlyShell: Table = {
  "*": "deny",
  ...readable,
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
  "gh *": "ask",
  "gh pr view *": "allow",
  "gh pr list *": "allow",
  "gh pr status *": "allow",
  "gh pr diff *": "allow",
  "gh pr checks *": "allow",
  "gh issue view *": "allow",
  "gh issue list *": "allow",
  "gh issue status *": "allow",
  "gh repo view *": "allow",
  "gh run list *": "allow",
  "gh run view *": "allow",
  "gh release list *": "allow",
  "gh release view *": "allow",
  "gh search *": "allow",
  // Defense in depth on top of the allowlist: these catch an allowed command that still writes a
  // file, chains another command, or runs an arbitrary program. `*` matches any run of characters.
  "*\n*": "deny",
  "*<(*": "deny",
  "*|*": "deny",
  "*;*": "deny",
  "*&*": "deny",
  "*$(*": "deny",
  "*`*": "deny",
  "*>*": "deny",
  "sort -o *": "deny",
  "sort * -o *": "deny",
  "sort *--output*": "deny",
  "sort *--compress-program*": "deny",
  "sort *--files0-from*": "deny",
  "rg *--pre *": "deny",
  "rg *--pre=*": "deny",
  "rg *--hostname-bin*": "deny",
  "ag *--pager*": "deny",
  "man *-P*": "deny",
  "man *--pager*": "deny",
  "man *-H*": "deny",
}

// Collects the global config rules: config appends them to every agent, and no config names this
// agent. The ceiling plugin reads it after config and removes it.
const probe = Agent.ID.make("kilo-config-permissions")

export const Plugin = define({
  id: "kilo.agent",
  effect: Effect.fn(function* (ctx) {
    const guard = guards(yield* Global.Service)
    // Agents that exist before user config. Only their catch-all edit rule describes them reliably.
    const builtins = new Set<string>()

    yield* ctx.agent.transform((editor) => {
      // v1 renamed the native build agent to code. The TUI shows the title-cased ID, so this shows "Code".
      const source = editor.get(build)
      editor.update(code, (item) => {
        if (source) Object.assign(item, structuredClone(source))
        item.name = Agent.Name.make("Code")
        item.permissions.push(...rules("shell", shell))
      })
      editor.default(code)
      const codeInfo = editor.get(code)
      // v1 resolved `build` to `code`. A hidden copy keeps sessions, commands and clients that still
      // name `build` working as Code without a second Code entry in the agent list.
      editor.update(build, (item) => {
        if (codeInfo) Object.assign(item, structuredClone(codeInfo))
        item.hidden = true
      })

      if (editor.get(general)) editor.update(general, (item) => item.permissions.push(...rules("shell", shell)))

      editor.update(Agent.ID.make("ask"), (item) => {
        item.name = Agent.Name.make("Ask")
        item.description = "Get answers and explanations without making changes to the codebase."
        item.system = PROMPT_ASK
        item.mode = "primary"
        item.permissions = structuredClone(guard.ask)
      })

      editor.update(Agent.ID.make("debug"), (item) => {
        item.name = Agent.Name.make("Debug")
        item.description = "Diagnose and fix software issues with systematic debugging methodology."
        item.system = PROMPT_DEBUG
        item.mode = "primary"
        item.permissions = structuredClone(codeInfo?.permissions ?? [])
      })

      editor.update(Agent.ID.make("orchestrator"), (item) => {
        item.name = Agent.Name.make("Orchestrator")
        item.description = "Coordinate complex tasks by delegating to specialized agents in parallel."
        item.system = PROMPT_ORCHESTRATOR
        item.mode = "primary"
        item.permissions = structuredClone(guard.orchestrator)
      })

      builtins.clear()
      for (const agent of editor.list()) builtins.add(agent.id)

      editor.update(probe, (item) => {
        item.mode = "subagent"
        item.hidden = true
        item.permissions = []
      })

      // Re-insert Plan last so the agent cycle keeps the v1 order: code, ask, debug, orchestrator, plan.
      const native = editor.get(plan)
      if (!native) return
      editor.remove(plan)
      editor.update(plan, (item) => {
        Object.assign(item, native)
        item.description = "Plan mode. Can only edit plan files; all other filesystem mutations are denied."
        item.permissions = structuredClone(guard.plan)
      })
    })

    // Earlier turns show what the previous agent could do. Tell the model once per switch which
    // agent is active now and whether it may change files. A new session has no previous agent.
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event): event is SessionEvent.AgentSelected => event.type === "session.agent.selected"),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const prior = event.data.previous
          if (!prior || prior === event.data.agent) return
          const current = (yield* ctx.agent.get({ agentID: event.data.agent })).data
          // A removed agent has no name anymore; fall back to its ID.
          const previous = Option.getOrUndefined(yield* Effect.option(ctx.agent.get({ agentID: prior })))
          const capability = !builtins.has(current.id)
            ? "Use the tools according to this agent's configured permissions; the permission system reports what is allowed."
            : Permission.evaluate("edit", "*", current.permissions).effect !== "deny"
              ? "This agent may modify files and run commands within its configured permissions."
              : "This agent cannot modify files or run mutating commands. If a request needs implementation, suggest switching to an agent that can."
          const text = AGENT_SWITCH.trim()
            .replaceAll("${prior}", () => previous?.data.name ?? prior)
            .replaceAll("${current}", () => current.name)
            .replaceAll("${capability}", () => capability)
          yield* ctx.session.synthetic({ sessionID: event.data.sessionID, text, resume: false })
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to add agent switch reminder", { sessionID: event.data.sessionID, cause }),
          ),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

// Runs after the config plugins. v1 reapplied the read-only limits after global config rules
// (#12053), so a broad global allow cannot open shell, edit or delegation in Ask and Plan, or shell in
// Orchestrator. Rules configured for one agent by ID still come last, which keeps them the opt-in.
export const Ceiling = define({
  id: "kilo.agent.ceiling",
  effect: Effect.fn(function* (ctx) {
    const guard = guards(yield* Global.Service)
    yield* ctx.agent.transform((editor) => {
      const global = editor.get(probe)?.permissions ?? []
      editor.remove(probe)
      for (const [id, base, ceiling] of [
        ["ask", guard.ask, seal(guard.ask, global)],
        ["plan", guard.plan, seal(guard.plan, global)],
        ["orchestrator", guard.orchestrator, [...guard.orchestrator, ...global, rule("shell", "*", "deny")]],
      ] as const) {
        const agent = editor.get(id)
        // Leave an agent alone when config replaced the Kilo built-in with its own definition.
        if (!agent || !starts(agent.permissions, [...base, ...global])) continue
        editor.update(id, (item) => {
          item.permissions = [...structuredClone(ceiling), ...item.permissions.slice(base.length + global.length)]
        })
      }
    })
  }),
})

/** Kilo rules for the agents whose limits config must not widen. */
function guards(global: Global.Interface) {
  // Read-only agents still need the files where long tool and shell output is stored.
  const output = [ToolOutput.DIRECTORY, Shell.DIRECTORY].map((dir) =>
    rule("external_directory", path.join(global.data, dir, "*"), "allow"),
  )
  const read = rules("read", { "*": "allow", "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" })
  // The native Plan directory, which the native Plan reminder names.
  const plans = path.join(global.home, ".opencode", "plan", "*")
  const allow = (...actions: string[]) => actions.map((action) => rule(action, "*", "allow"))
  return {
    ask: [
      rule("*", "*", "deny"),
      ...rules("shell", readOnlyShell),
      ...read,
      ...allow("grep", "glob", "skill", "question", "webfetch", "websearch"),
      ...output,
      rule("edit", "*", "deny"),
      rule("subagent", "*", "deny"),
    ],
    plan: [
      rule("*", "*", "deny"),
      ...allow("question", "skill", "subagent"),
      rule("subagent", general, "deny"),
      ...rules("shell", readOnlyShell),
      ...read,
      ...allow("grep", "glob", "webfetch", "websearch"),
      ...output,
      rule("external_directory", plans, "allow"),
      rule("edit", "*", "deny"),
      rule("edit", plans, "allow"),
    ],
    orchestrator: [
      rule("*", "*", "deny"),
      ...allow("read", "grep", "glob", "question", "skill", "subagent", "webfetch", "websearch"),
      ...output,
      rule("shell", "*", "deny"),
    ],
  }
}

/**
 * The v1 read-only ceiling: the guard again after the global rules. Global rules still tune the
 * guard's own tools by exact name and keep their denies, but shell and edit return to the guard,
 * and delegation and tools outside the guard stay denied.
 */
function seal(guard: Permission.Rule[], global: readonly Permission.Rule[]) {
  const sealed = (entry: Permission.Rule) => entry.action === "shell" || entry.action === "edit"
  const tunable = [
    ...new Set(guard.filter((entry) => entry.action !== "*" && !sealed(entry)).map((entry) => entry.action)),
  ]
  return [
    ...guard.filter((entry) => !sealed(entry)),
    ...global.flatMap((entry) =>
      tunable.filter((action) => Wildcard.match(action, entry.action)).map((action) => ({ ...entry, action })),
    ),
    ...guard.filter((entry) => sealed(entry) || (entry.action === "subagent" && entry.effect === "deny")),
    ...global.filter((entry) => entry.effect === "deny"),
  ]
}

function starts(rules: readonly Permission.Rule[], prefix: readonly Permission.Rule[]) {
  return prefix.every(
    (entry, index) =>
      rules[index]?.action === entry.action &&
      rules[index]?.resource === entry.resource &&
      rules[index]?.effect === entry.effect,
  )
}

function rule(action: string, resource: string, effect: Permission.Rule["effect"]) {
  return { action, resource, effect }
}

function rules(action: string, table: Table) {
  return Object.entries(table).map(([resource, effect]) => rule(action, resource, effect))
}
