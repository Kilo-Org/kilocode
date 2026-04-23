import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Locale } from "../../util"
import { Flag } from "../../flag/flag"
import { Filesystem } from "../../util"
import { Process } from "../../util"
import { EOL } from "os"
import path from "path"
import { which } from "../../util/which"
import { AppRuntime } from "@/effect/app-runtime"

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

export const SessionDeleteCommand = cmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = SessionID.make(args.sessionID)
      try {
        await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
      } catch {
        UI.error(`Session not found: ${args.sessionID}`)
        process.exit(1)
      }
      await AppRuntime.runPromise(Session.Service.use((svc) => svc.remove(sessionID)))
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
    })
  },
})

export const SessionListCommand = cmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs: Argv) => {
    // kilocode_change start
    return (
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
        // kilocode_change end
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
        })
    )
    // kilocode_change end
  },
  // kilocode_change start
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      // kilocode_change end
      // kilocode_change start
      const sessions = args.all
        ? [...Session.listGlobal({ roots: true, limit: args.maxCount, search: args.search })]
        : [...Session.list({ roots: true, limit: args.maxCount, search: args.search })]
      // kilocode_change end

      // kilocode_change start
      if (sessions.length === 0) {
        return
      }
      // kilocode_change end

      // kilocode_change start
      let output: string
      if (args.format === "json") {
        output = args.all
          ? formatGlobalSessionJSON(sessions as Session.GlobalInfo[])
          : formatSessionJSON(sessions as Session.Info[])
      } else {
        output = args.all
          ? formatGlobalSessionTable(sessions as Session.GlobalInfo[])
          : formatSessionTable(sessions as Session.Info[])
        // kilocode_change end
      }

      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
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
      } else {
        console.log(output)
      }
    })
  },
})

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

// kilocode_change start
function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}
// kilocode_change end

// kilocode_change start
function formatGlobalSessionTable(sessions: Session.GlobalInfo[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))
  const maxProjectWidth = Math.max(
    10,
    ...sessions.map((s) => (s.project?.name ?? s.project?.worktree ?? "unknown").length),
  )

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Project${" ".repeat(maxProjectWidth - 7)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const project = Locale.truncate(session.project?.name ?? session.project?.worktree ?? "unknown", maxProjectWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${project.padEnd(maxProjectWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatGlobalSessionJSON(sessions: Session.GlobalInfo[]): string {
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
  }))
  return JSON.stringify(jsonData, null, 2)
}
// kilocode_change end
