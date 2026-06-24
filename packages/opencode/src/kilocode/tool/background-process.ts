import { BackgroundProcess } from "@/kilocode/background-process"
import { Tool } from "@/tool/tool"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { containsPath } from "@/project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Schema } from "effect"
import { enabled as sandboxed } from "@kilocode/sandbox"
import DESCRIPTION from "./background-process.txt"
import path from "path"

const Action = Schema.Literals(["start", "list", "status", "logs", "stop", "restart"])
type Action = Schema.Schema.Type<typeof Action>

export const Params = Schema.Struct({
  action: Action.annotate({ description: "Operation to perform" }),
  command: Schema.optional(Schema.String).annotate({
    description: "Required for start. Command to run as a tracked background process.",
  }),
  id: Schema.optional(BackgroundProcess.ID.annotate({ description: "Required for status, logs, stop, and restart" })),
  workdir: Schema.optional(Schema.String).annotate({
    description: "Working directory for start. Defaults to the project directory.",
  }),
  description: Schema.optional(Schema.String).annotate({ description: "Short label shown in the sidebar" }),
  ready: Schema.optional(BackgroundProcess.Ready).annotate({ description: "Optional readiness probe for start" }),
}).check(
  Schema.makeFilter((params: { action: Action; command?: string; id?: BackgroundProcess.ID }) => {
    if (params.action === "start") {
      if (params.command?.trim()) return undefined
      return "command is required when action is start"
    }
    if (params.action === "list") return undefined
    if (params.id) return undefined
    return "id is required when action is status, logs, stop, or restart"
  }),
)
export type Params = Schema.Schema.Type<typeof Params>

type Meta = {
  processID?: BackgroundProcess.ID
  status?: BackgroundProcess.Status
  count?: number
}

function title(info: BackgroundProcess.Info) {
  return info.description ?? info.command
}

function last(text: string) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  return lines.at(-1) ?? ""
}

function format(info: BackgroundProcess.Info) {
  return [
    `id: ${info.id}`,
    `status: ${info.status}`,
    info.pid ? `pid: ${info.pid}` : undefined,
    `cwd: ${info.cwd}`,
    `command: ${info.command}`,
    last(info.output) ? `last_output: ${last(info.output)}` : undefined,
  ]
    .filter(Boolean)
    .join("\n")
}

function invalid(action: Action, message: string) {
  return {
    title: "Invalid background process input",
    output: `${message} for action: ${action}`,
    metadata: {},
  }
}

function missing(id: BackgroundProcess.ID) {
  return {
    title: "Background process not found",
    output: `Background process not found: ${id}`,
    metadata: { processID: id },
  }
}

function pattern(ready?: BackgroundProcess.Ready) {
  if (!ready?.pattern) return
  try {
    new RegExp(ready.pattern)
  } catch (err) {
    return `Invalid ready pattern: ${err instanceof Error ? err.message : String(err)}`
  }
}

export const BackgroundProcessTool = Tool.define<typeof Params, Meta, never, "background_process">(
  "background_process",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Params,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        if (params.action === "list") {
          const list = yield* Effect.promise(() => BackgroundProcess.list({ sessionID: ctx.sessionID }))
          return {
            title: "Background processes",
            output: list.length
              ? list.map(format).join("\n\n")
              : "No background processes are running for this session.",
            metadata: { count: list.length },
          }
        }

        if ((params.action === "start" || params.action === "restart") && (yield* sandboxed)) {
          return invalid(params.action, "Background processes are unavailable while the sandbox is enabled")
        }

        if (params.action !== "start") {
          const id = params.id
          if (!id) return invalid(params.action, "Missing id")
          const found = yield* Effect.promise(() => BackgroundProcess.get(id))
          if (!found || found.sessionID !== ctx.sessionID) return missing(id)
          if (params.action === "logs") {
            const logs = yield* Effect.promise(() => BackgroundProcess.logs(id))
            if (!logs) return missing(id)
            return {
              title: `Logs: ${title(found)}`,
              output: logs.output || "(no output)",
              metadata: { processID: found.id, status: found.status },
            }
          }
          const info =
            params.action === "stop"
              ? yield* Effect.promise(() => BackgroundProcess.stop(id))
              : params.action === "restart"
                ? yield* Effect.promise(() => BackgroundProcess.restart(id))
                : found
          if (!info) return missing(id)
          return {
            title: `${params.action}: ${title(info)}`,
            output: format(info),
            metadata: { processID: info.id, status: info.status },
          }
        }

        const command = params.command?.trim()
        if (!command) return invalid(params.action, "Missing command")
        const err = pattern(params.ready)
        if (err) return invalid(params.action, err)
        const inst = yield* InstanceState.context
        const cwd = path.resolve(inst.directory, params.workdir ?? inst.directory)
        if (!containsPath(cwd, inst)) {
          const pattern =
            process.platform === "win32" ? AppFileSystem.normalizePathPattern(path.join(cwd, "*")) : path.join(cwd, "*")
          yield* ctx.ask({
            permission: "external_directory",
            patterns: [pattern],
            always: [pattern],
            metadata: { command, access: "unknown" },
          })
        }
        yield* ctx.ask({
          permission: "bash",
          patterns: [command],
          always: [command.split(/\s+/, 1)[0] + " *"],
          metadata: { command, description: params.description, action: "start", backgroundProcess: true },
        })

        const info = yield* Effect.promise(() =>
          BackgroundProcess.start({
            sessionID: ctx.sessionID,
            command,
            cwd,
            description: params.description,
            ready: params.ready,
          }),
        )
        return {
          title: `Started: ${title(info)}`,
          output: format(info),
          metadata: { processID: info.id, status: info.status },
        }
      }),
  }),
)
