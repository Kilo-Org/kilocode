export * as KiloAgentPlugin from "./agent.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import type { Permission } from "@opencode/schema/permission"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import path from "path"
import { Shell } from "../shell.js"
import { ToolOutput } from "../tool-output.js"

import PROMPT_ASK from "./agent/ask.txt"
import PROMPT_DEBUG from "./agent/debug.txt"
import PROMPT_ORCHESTRATOR from "./agent/orchestrator.txt"

// Kilo's v1 agent set on the v2 agent registry. This runs before the config plugins, so a user
// agent with the same ID merges over these built-ins and its fields and rules win, as in v1.

const build = Agent.ID.make("build")
const code = Agent.ID.make("code")
const general = Agent.ID.make("general")
const plan = Agent.ID.make("plan")

type Table = Record<string, Permission.Effect>

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

export const Plugin = define({
  id: "kilo.agent",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    // Read-only agents still need the files where long tool and shell output is stored.
    const output = [ToolOutput.DIRECTORY, Shell.DIRECTORY].map((dir) =>
      rule("external_directory", path.join(global.data, dir, "*"), "allow"),
    )
    const read = rules("read", { "*": "allow", "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" })

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
        item.permissions = [
          rule("*", "*", "deny"),
          ...rules("shell", readOnlyShell),
          ...read,
          ...["grep", "glob", "skill", "question", "webfetch", "websearch"].map((action) => rule(action, "*", "allow")),
          ...output,
          rule("edit", "*", "deny"),
          rule("subagent", "*", "deny"),
        ]
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
        item.permissions = [
          rule("*", "*", "deny"),
          ...["read", "grep", "glob", "question", "skill", "subagent", "webfetch", "websearch"].map((action) =>
            rule(action, "*", "allow"),
          ),
          ...output,
          rule("shell", "*", "deny"),
        ]
      })

      // Re-insert Plan last so the agent cycle keeps the v1 order: code, ask, debug, orchestrator, plan.
      const native = editor.get(plan)
      if (!native) return
      editor.remove(plan)
      editor.update(plan, (item) => {
        Object.assign(item, native)
        // Keep the native Plan directory, which the native Plan reminder names.
        const dirs = native.permissions.filter((entry) => entry.action === "edit" && entry.effect === "allow")
        item.description = "Plan mode. Can only edit plan files; all other filesystem mutations are denied."
        item.permissions.push(
          rule("*", "*", "deny"),
          ...["question", "skill", "subagent"].map((action) => rule(action, "*", "allow")),
          rule("subagent", general, "deny"),
          ...rules("shell", readOnlyShell),
          ...read,
          ...["grep", "glob", "webfetch", "websearch"].map((action) => rule(action, "*", "allow")),
          ...output,
          rule("edit", "*", "deny"),
          ...dirs.flatMap((dir) => [{ ...dir }, rule("external_directory", dir.resource, "allow")]),
        )
      })
    })
  }),
})

function rule(action: string, resource: string, effect: Permission.Effect) {
  return { action, resource, effect }
}

function rules(action: string, table: Table) {
  return Object.entries(table).map(([resource, effect]) => rule(action, resource, effect))
}
