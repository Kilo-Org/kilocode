// kilocode_change - new file
import { Bus } from "@/bus"
import { AgentManagerEvent } from "@/kilocode/agent-manager/event"
import { InstanceState } from "@/effect/instance-state"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"
import * as fs from "fs"
import * as nodePath from "path"
import DESCRIPTION from "./agent-manager.txt"

const Task = Schema.Struct({
  prompt: Schema.optional(Schema.String).annotate({ description: "Initial prompt to send to the new session" }),
  name: Schema.optional(Schema.String).annotate({ description: "Short display name for the Agent Manager card" }),
  branchName: Schema.optional(Schema.String).annotate({ description: "Git branch name seed for worktree mode" }),
}).check(
  Schema.makeFilter((task: { prompt?: string; name?: string; branchName?: string }) =>
    task.prompt?.trim() || task.name?.trim() || task.branchName?.trim()
      ? undefined
      : "Each task must include prompt, name, or branchName",
  ),
)

export const Params = Schema.Struct({
  action: Schema.optional(Schema.String).annotate({
    description:
      'Action to perform. Use "overview" to inspect active worktrees, sessions, git stats, and PR badges (read-only). Omit or use "start" to create new Agent Manager sessions.',
  }),
  mode: Schema.optional(Schema.Literals(["worktree", "local"])).annotate({
    description: "Use worktree for isolated git worktrees, or local for same-directory Agent Manager sessions",
  }),
  versions: Schema.optional(Schema.Boolean).annotate({
    description:
      "Set true only when tasks are alternative versions of the same work to compare. Omit or false for independent sessions.",
  }),
  tasks: Schema.optional(Schema.Array(Task).check(Schema.isMinLength(1), Schema.isMaxLength(20))).annotate({
    description: "Agent Manager sessions to start (required when action is start)",
  }),
})

// ---------------------------------------------------------------------------
// Overview types
// ---------------------------------------------------------------------------

export interface SessionOverview {
  id: string
  createdAt: string
}

export interface GitStats {
  uncommittedFiles: number
  ahead: number
  behind: number
}

export interface PRBadge {
  number: number
  url?: string
  state?: string
}

export interface WorktreeOverview {
  id: string
  branch: string
  path: string
  parentBranch: string
  label?: string
  sessions: SessionOverview[]
  gitStats: GitStats | null
  pr: PRBadge | null
}

export interface OverviewResult {
  mainRoot: string
  worktrees: WorktreeOverview[]
  localSessions: SessionOverview[]
}

// ---------------------------------------------------------------------------
// Agent Manager state file shape (mirrors WorktreeStateManager)
// ---------------------------------------------------------------------------

interface StateWorktree {
  branch: string
  path: string
  parentBranch: string
  remote?: string
  createdAt: string
  groupId?: string
  label?: string
  prNumber?: number
  prUrl?: string
  prState?: string
  sectionId?: string
}

interface StateSession {
  worktreeId: string | null
  createdAt: string
}

interface StateFile {
  worktrees: Record<string, StateWorktree>
  sessions: Record<string, StateSession>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runGit(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  return result.stdout.toString().trimEnd()
}

function mainWorktreeRoot(cwd: string): string {
  const out = runGit(["worktree", "list", "--porcelain"], cwd)
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) return line.slice("worktree ".length).trim()
  }
  return cwd
}

function collectGitStats(wtPath: string, parent: string, remote?: string): GitStats | null {
  if (!fs.existsSync(wtPath)) return null
  try {
    const ref = remote ? `${remote}/${parent}` : parent
    const status = runGit(["status", "--short"], wtPath)
    const files = status ? status.split("\n").filter(Boolean).length : 0
    const counts = runGit(["rev-list", "--left-right", "--count", `HEAD...${ref}`], wtPath)
    const parts = counts.split("\t")
    const ahead = parseInt(parts[0] ?? "0", 10) || 0
    const behind = parseInt(parts[1] ?? "0", 10) || 0
    return { uncommittedFiles: files, ahead, behind }
  } catch {
    return null
  }
}

function readStateFile(root: string): StateFile | null {
  const file = nodePath.join(root, ".kilo", "agent-manager.json")
  try {
    const content = fs.readFileSync(file, "utf-8")
    return JSON.parse(content) as StateFile
  } catch {
    return null
  }
}

function buildOverview(dir: string): OverviewResult {
  const root = mainWorktreeRoot(dir)
  const state = readStateFile(root)

  if (!state) return { mainRoot: root, worktrees: [], localSessions: [] }

  const worktrees: WorktreeOverview[] = Object.entries(state.worktrees ?? {}).map(([id, wt]) => {
    const sessions: SessionOverview[] = Object.entries(state.sessions ?? {})
      .filter(([, s]) => s.worktreeId === id)
      .map(([sid, s]) => ({ id: sid, createdAt: s.createdAt }))

    const gitStats = collectGitStats(wt.path, wt.parentBranch, wt.remote)
    const pr: PRBadge | null = wt.prNumber
      ? { number: wt.prNumber, url: wt.prUrl, state: wt.prState }
      : null

    return {
      id,
      branch: wt.branch,
      path: wt.path,
      parentBranch: wt.parentBranch,
      label: wt.label,
      sessions,
      gitStats,
      pr,
    }
  })

  const localSessions: SessionOverview[] = Object.entries(state.sessions ?? {})
    .filter(([, s]) => s.worktreeId === null)
    .map(([id, s]) => ({ id, createdAt: s.createdAt }))

  return { mainRoot: root, worktrees, localSessions }
}

function formatOverview(result: OverviewResult): string {
  const lines: string[] = [
    "Agent Manager Overview",
    "======================",
    `Main workspace: ${result.mainRoot}`,
    `Worktrees: ${result.worktrees.length}`,
    `Local sessions: ${result.localSessions.length}`,
  ]

  if (result.worktrees.length > 0) {
    lines.push("")
    for (const wt of result.worktrees) {
      lines.push(`Worktree: ${wt.label ?? wt.branch}`)
      lines.push(`  id: ${wt.id}`)
      lines.push(`  branch: ${wt.branch}`)
      lines.push(`  parent: ${wt.parentBranch}`)
      lines.push(`  path: ${wt.path}`)
      if (wt.gitStats) {
        lines.push(
          `  git: ${wt.gitStats.uncommittedFiles} uncommitted file(s), ahead ${wt.gitStats.ahead} / behind ${wt.gitStats.behind} vs ${wt.parentBranch}`,
        )
      }
      if (wt.pr) {
        lines.push(`  PR: #${wt.pr.number} [${wt.pr.state ?? "unknown"}]${wt.pr.url ? " " + wt.pr.url : ""}`)
      }
      if (wt.sessions.length > 0) {
        lines.push(`  sessions (${wt.sessions.length}):`)
        for (const s of wt.sessions) {
          lines.push(`    - ${s.id}`)
        }
      } else {
        lines.push(`  sessions: none`)
      }
    }
  }

  if (result.localSessions.length > 0) {
    lines.push("")
    lines.push(`Local sessions (${result.localSessions.length}):`)
    for (const s of result.localSessions) {
      lines.push(`  - ${s.id}`)
    }
  }

  return lines.join("\n")
}

export const AgentManagerTool = Tool.define<typeof Params, Record<string, unknown>, Bus.Service, "agent_manager">(
  "agent_manager",
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          if (params.action === "overview") {
            const instance = yield* InstanceState.context
            const result = buildOverview(instance.directory)
            return {
              title: "Agent Manager Overview",
              output: formatOverview(result),
              metadata: result as unknown as Record<string, unknown>,
            }
          }

          if (!params.mode || !params.tasks) {
            return {
              title: "Error",
              output: 'agent_manager requires "mode" and "tasks" when action is "start".',
              metadata: {},
            }
          }

          yield* ctx.ask({
            permission: "agent_manager",
            patterns: [params.mode],
            always: [params.mode],
            metadata: { mode: params.mode, count: params.tasks.length },
          })

          const requestID = `am-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          yield* bus.publish(AgentManagerEvent.Start, {
            requestID,
            sessionID: ctx.sessionID,
            mode: params.mode,
            versions: params.versions,
            tasks: params.tasks,
          })

          return {
            title: `Requested ${params.tasks.length} Agent Manager ${params.mode === "worktree" ? "worktree" : "local"} session${params.tasks.length === 1 ? "" : "s"}`,
            output: [
              `Requested ${params.tasks.length} Agent Manager ${params.mode === "worktree" ? "worktree" : "local"} session${params.tasks.length === 1 ? "" : "s"}.`,
              `request_id: ${requestID}`,
              "The VS Code extension will create the sessions asynchronously and show progress in Agent Manager.",
            ].join("\n"),
            metadata: { requestID, count: params.tasks.length },
          }
        }),
    }
  }),
)
