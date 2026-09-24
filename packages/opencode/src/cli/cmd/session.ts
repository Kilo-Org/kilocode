import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status" // kilocode_change
import { Wakeup } from "@/kilocode/wakeup" // kilocode_change
import { futureDueFor, mergeScheduled } from "@/kilocode/session/scheduled" // kilocode_change
import { SessionID } from "../../session/schema"
import { UI } from "../ui"
import { Locale } from "@/util/locale"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { NotFoundError } from "@/storage/storage"
import { EOL } from "os"
import path from "path"
import { which } from "@opencode-ai/core/util/which"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = which("less")
  if (lessOnPath) {
    if (Filesystem.stat(lessOnPath)?.size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.KILO_GIT_BASH_PATH) {
    const less = path.join(Flag.KILO_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  const git = which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) => yargs.command(SessionListCommand).command(SessionDeleteCommand).demandCommand(),
  async handler() {},
})

export const SessionDeleteCommand = effectCmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs) =>
    yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.session.delete")(function* (args) {
    const svc = yield* Session.Service
    const sessionID = SessionID.make(args.sessionID)
    yield* svc
      .remove(sessionID)
      .pipe(Effect.catchIf(NotFoundError.isInstance, () => fail(`Session not found: ${args.sessionID}`)))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
  }),
})

export const SessionListCommand = effectCmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs) =>
    yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      // kilocode_change start
      .option("all", {
        alias: "a",
        describe: "list sessions from all projects",
        type: "boolean",
        default: false,
      })
      .option("search", {
        alias: "s",
        describe: "filter sessions by title",
        type: "string",
      }),
  // kilocode_change end
  handler: Effect.fn("Cli.session.list")(function* (args) {
    // kilocode_change start
    const sessions = args.all
      ? yield* Session.Service.use((svc) => svc.listGlobal({ roots: true, limit: args.maxCount, search: args.search }))
      : yield* Session.Service.use((svc) => svc.list({ roots: true, limit: args.maxCount, search: args.search }))
    // kilocode_change end

    if (sessions.length === 0) return

    // kilocode_change start - fold a future wakeup into each session's status so
    // the list shows `scheduled <wake time>` instead of a bare idle. The list
    // runs in its own process and can cover directories this instance never
    // adopted, so read the persisted wakeups (`Wakeup.list`) and keep the ones
    // belonging to the sessions being listed. The in-memory, directory-scoped
    // `Wakeup.scheduled` would miss every session whose directory differs from the
    // shell's working directory.
    const due = futureDueFor(
      yield* Wakeup.Service.use((svc) => svc.list()),
      sessions.map((session) => String(session.id)),
    )
    const statuses = mergeScheduled(Object.fromEntries(yield* SessionStatus.Service.use((svc) => svc.list())), due)
    // kilocode_change end

    // kilocode_change start
    const output =
      args.format === "json"
        ? args.all
          ? formatGlobalSessionJSON(sessions as Session.GlobalInfo[], statuses)
          : formatSessionJSON(sessions as Session.Info[], statuses)
        : args.all
          ? formatGlobalSessionTable(sessions as Session.GlobalInfo[], statuses)
          : formatSessionTable(sessions as Session.Info[], statuses)
    // kilocode_change end

    const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

    if (shouldPaginate) {
      yield* Effect.promise(async () => {
        const proc = Process.spawn(pagerCmd(), {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        if (!proc.stdin) {
          console.log(output)
          return
        }

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      })
    } else {
      console.log(output)
    }
  }),
})

// kilocode_change start
/** The Status column cell: the wake time for a scheduled session, its status type
 * otherwise, and `idle` when the session carries no status at all. */
function statusCell(status: SessionStatus.Info | undefined): string {
  if (status?.type === "scheduled") return `scheduled ${status.scheduledAt}`
  return status?.type ?? "idle"
}

export function formatSessionTable(sessions: Session.Info[], statuses: Record<string, SessionStatus.Info>): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))
  const maxStatusWidth = Math.max(6, ...sessions.map((s) => statusCell(statuses[String(s.id)]).length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Status${" ".repeat(maxStatusWidth - 6)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const status = statusCell(statuses[String(session.id)])
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${status.padEnd(maxStatusWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}
// kilocode_change end

// kilocode_change start
export function formatSessionJSON(sessions: Session.Info[], statuses: Record<string, SessionStatus.Info>): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
    // The full payload, so `scheduledAt` appears only on the scheduled variant.
    status: statuses[String(session.id)] ?? { type: "idle" as const },
  }))
  return JSON.stringify(jsonData, null, 2)
}
// kilocode_change end

// kilocode_change start
export function formatGlobalSessionTable(
  sessions: Session.GlobalInfo[],
  statuses: Record<string, SessionStatus.Info>,
): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))
  const maxStatusWidth = Math.max(6, ...sessions.map((s) => statusCell(statuses[String(s.id)]).length))
  const maxProjectWidth = Math.max(
    10,
    ...sessions.map((s) => (s.project?.name ?? s.project?.worktree ?? "unknown").length),
  )

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Status${" ".repeat(maxStatusWidth - 6)}  Project${" ".repeat(maxProjectWidth - 7)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const project = Locale.truncate(session.project?.name ?? session.project?.worktree ?? "unknown", maxProjectWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const status = statusCell(statuses[String(session.id)])
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${status.padEnd(maxStatusWidth)}  ${project.padEnd(maxProjectWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

export function formatGlobalSessionJSON(
  sessions: Session.GlobalInfo[],
  statuses: Record<string, SessionStatus.Info>,
): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
    project: session.project
      ? { id: session.project.id, name: session.project.name, worktree: session.project.worktree }
      : null,
    // The full payload, so `scheduledAt` appears only on the scheduled variant.
    status: statuses[String(session.id)] ?? { type: "idle" as const },
  }))
  return JSON.stringify(jsonData, null, 2)
}
// kilocode_change end
