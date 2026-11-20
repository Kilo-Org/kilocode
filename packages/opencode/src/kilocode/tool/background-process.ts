import { BackgroundProcess } from "@/kilocode/background-process"
import { Tool } from "@/tool/tool"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Shell } from "@opencode-ai/core/shell"
import { classifyShell } from "@/tool/shell"
import { containsPath } from "@/project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { KiloSession } from "@/kilocode/session"
import { SessionID } from "@/session/schema"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Effect, Schema } from "effect"
import { enabled as sandboxed } from "@kilocode/sandbox"
import DESCRIPTION from "./background-process.txt"
import { stat } from "node:fs/promises"
import path from "path"

const Action = Schema.Literals(["start", "monitor", "list", "status", "logs", "stop", "restart"])
type Action = Schema.Schema.Type<typeof Action>

const MONITOR_LINES = 200
const MONITOR_LINES_MIN = 1
const MONITOR_LINES_MAX = 1_000
const MONITOR_TIMEOUT_MS = 120_000
const MONITOR_TIMEOUT_MIN_MS = 5_000
const MONITOR_TIMEOUT_MAX_MS = 600_000
const MONITOR_POLL_MS = 200

const STOPPED: readonly BackgroundProcess.Status[] = ["exited", "failed", "stopped", "stopping"]

export const Params = Schema.Struct({
  action: Action.annotate({ description: "Operation to perform" }),
  command: Schema.optional(Schema.String).annotate({
    description: "Required for start and monitor. Command to run as a tracked background process.",
  }),
  id: Schema.optional(BackgroundProcess.ID.annotate({ description: "Required for status, logs, stop, and restart" })),
  workdir: Schema.optional(Schema.String).annotate({
    description: "Working directory for start and monitor. Defaults to the project directory.",
  }),
  description: Schema.optional(Schema.String).annotate({ description: "Short label shown in the sidebar" }),
  ready: Schema.optional(BackgroundProcess.Ready).annotate({
    description: "Optional readiness probe for start and monitor",
  }),
  lines: Schema.optional(PositiveInt).annotate({
    description: `For monitor: maximum output lines to capture (default ${MONITOR_LINES}, clamped to ${MONITOR_LINES_MIN}..${MONITOR_LINES_MAX})`,
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: `For monitor: wall-time cap in milliseconds (default ${MONITOR_TIMEOUT_MS}, clamped to ${MONITOR_TIMEOUT_MIN_MS}..${MONITOR_TIMEOUT_MAX_MS})`,
  }),
  inherit: Schema.optional(Schema.Boolean).annotate({
    description: "For subagents only: transfer the process to the parent session when this session ends",
  }),
  persistent: Schema.optional(Schema.Boolean).annotate({
    description: "Keep the process running and manageable after the session or Kilo exits",
  }),
}).check(
  Schema.makeFilter(
    (params: {
      action: Action
      command?: string
      id?: BackgroundProcess.ID
      inherit?: boolean
      persistent?: boolean
    }) => {
      if (params.action === "start") {
        if (params.inherit && params.persistent) return "inherit and persistent cannot be combined"
        if (params.command?.trim()) return undefined
        return "command is required when action is start"
      }
      if (params.inherit || params.persistent) return "inherit and persistent are only valid when action is start"
      if (params.action === "monitor") {
        if (params.command?.trim()) return undefined
        return "command is required when action is monitor"
      }
      if (params.action === "list") return undefined
      if (params.id) return undefined
      return "id is required when action is status, logs, stop, or restart"
    },
  ),
)
export type Params = Schema.Schema.Type<typeof Params>

type Reason = "exit" | "lines" | "time"

type Meta = {
  processID?: BackgroundProcess.ID
  status?: BackgroundProcess.Status
  count?: number
  output?: string
  reason?: Reason
  lines?: number
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
    `lifetime: ${info.lifetime}`,
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

function clamp(value: number | undefined, min: number, max: number, fallback: number) {
  if (value == null) return fallback
  if (value < min) return min
  if (value > max) return max
  return value
}

/** Keep at most the last `limit` lines of the process output. */
function capture(text: string, limit: number) {
  const rows = text.replace(/\r\n/g, "\n").split("\n")
  if (rows.at(-1) === "") rows.pop()
  const total = rows.length
  return {
    output: total > limit ? rows.slice(total - limit).join("\n") : rows.join("\n"),
    lines: total < limit ? total : limit,
    reached: total >= limit,
  }
}

function trailer(
  reason: Reason,
  status: BackgroundProcess.Status,
  id: BackgroundProcess.ID,
  cap: number,
  timeout: number,
) {
  const detail =
    reason === "exit"
      ? `process ${status}`
      : reason === "lines"
        ? `reached the ${cap}-line cap; the process is still running`
        : `reached the ${timeout} ms wall-time cap; the process is still running`
  return [
    `[monitor stopped: ${detail}]`,
    `process id: ${id}`,
    `Use this tool with action "logs", "status", or "stop" to follow up.`,
  ].join("\n")
}

function monitor(params: Params, ctx: Tool.Context<Meta>, info: BackgroundProcess.Info) {
  const cap = clamp(params.lines, MONITOR_LINES_MIN, MONITOR_LINES_MAX, MONITOR_LINES)
  const timeout = clamp(params.timeout, MONITOR_TIMEOUT_MIN_MS, MONITOR_TIMEOUT_MAX_MS, MONITOR_TIMEOUT_MS)
  const deadline = Date.now() + timeout
  return Effect.gen(function* () {
    let pushed = ""
    const outcome = yield* Effect.raceFirst(
      Effect.gen(function* () {
        while (true) {
          const current = yield* Effect.promise(() => BackgroundProcess.get(info.id))
          const status = current?.status ?? "stopped"
          const captured = capture(current?.output ?? "", cap)
          if (captured.output !== pushed) {
            pushed = captured.output
            yield* ctx.metadata({ metadata: { output: pushed } })
          }
          const reason: Reason | undefined = !current
            ? "exit"
            : STOPPED.includes(status)
              ? "exit"
              : captured.reached
                ? "lines"
                : Date.now() >= deadline
                  ? "time"
                  : undefined
          if (reason) return { reason, status, lines: captured.lines, output: captured.output }
          yield* Effect.sleep(`${MONITOR_POLL_MS} millis`)
        }
      }).pipe(Effect.map((result) => ({ kind: "stopped" as const, result }))),
      Effect.callback<{ kind: "abort" }>((resume) => {
        const abort = () => resume(Effect.succeed({ kind: "abort" as const }))
        if (ctx.abort.aborted) return abort()
        ctx.abort.addEventListener("abort", abort, { once: true })
        return Effect.sync(() => ctx.abort.removeEventListener("abort", abort))
      }),
    )
    if (outcome.kind === "abort") return yield* Effect.interrupt
    const { reason, status, lines, output } = outcome.result
    const note = trailer(reason, status, info.id, cap, timeout)
    return {
      title: `Monitor: ${title(info)}`,
      output: output ? `${output}\n\n${note}` : note,
      metadata: { processID: info.id, status, reason, lines },
    }
  })
}

const authorize = Effect.fn("BackgroundProcessTool.authorize")(function* (
  ctx: Tool.Context,
  input: { command: string; cwd: string; description?: string },
  restart = false,
) {
  const inst = yield* InstanceState.context
  const shell = Shell.acceptable()
  const scan = yield* classifyShell(input.command, shell)
  const glob = (dir: string) => {
    const pattern = path.join(dir, "*")
    return process.platform === "win32" ? FSUtil.normalizePathPattern(pattern) : pattern
  }
  const cwd = containsPath(input.cwd, inst) ? undefined : glob(input.cwd)
  if (cwd) {
    yield* ctx.ask({
      permission: "external_directory",
      patterns: [cwd],
      always: restart ? [] : [cwd],
      metadata: { command: input.command, access: "unknown" },
      ...(restart ? { managedOnly: true } : {}),
    })
  }
  const dirs = new Set<string>()
  for (const file of scan.paths) {
    const resolved = path.resolve(input.cwd, FSUtil.windowsPath(file))
    if (containsPath(resolved, inst)) continue
    const dir = (yield* Effect.promise(() => stat(resolved).catch(() => undefined)))?.isDirectory()
      ? resolved
      : path.dirname(resolved)
    const pattern = glob(dir)
    if (pattern !== cwd) dirs.add(pattern)
  }
  if (dirs.size > 0) {
    yield* ctx.ask({
      permission: "external_directory",
      patterns: [...dirs],
      always: [],
      metadata: { command: input.command, access: "unknown" },
      managedOnly: true,
    })
  }
  yield* ctx.ask({
    permission: "bash",
    patterns: [input.command],
    always: restart ? [] : [input.command.split(/\s+/, 1)[0] + " *"],
    metadata: {
      command: input.command,
      description: input.description,
      action: restart ? "restart" : "start",
      backgroundProcess: true,
    },
    ...(restart ? { managedOnly: true } : {}),
    // The background launcher can apply login initialization and does not use
    // the foreground path analyzer. Keep identified denials, but require fallback.
    managedShell: { ...scan.managedShell, uncertain: true },
  })
  const context = yield* Effect.context()
  const recheck = ctx.recheck ? Effect.suspend(() => ctx.recheck?.() ?? Effect.void) : undefined
  return { shell, recheck: recheck && (() => Effect.runPromiseWith(context)(recheck, { signal: ctx.abort })) }
})

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
              : "No background processes are available for this session.",
            metadata: { count: list.length },
          }
        }

        if (
          (params.action === "start" || params.action === "monitor" || params.action === "restart") &&
          (yield* sandboxed)
        ) {
          return invalid(params.action, "Background processes are unavailable while the sandbox is enabled")
        }

        if (params.action !== "start" && params.action !== "monitor") {
          const id = params.id
          if (!id) return invalid(params.action, "Missing id")
          const found = yield* Effect.promise(() => BackgroundProcess.get(id))
          if (!found || (found.sessionID !== ctx.sessionID && found.lifetime !== "persistent")) return missing(id)
          if (params.action === "logs") {
            const logs = yield* Effect.promise(() => BackgroundProcess.logs(id))
            if (!logs) return missing(id)
            return {
              title: `Logs: ${title(found)}`,
              output: logs.output || "(no output)",
              metadata: { processID: found.id, status: found.status },
            }
          }
          const opts = params.action === "restart" ? yield* authorize(ctx, found, true) : undefined
          const info = opts
            ? yield* Effect.promise(() => BackgroundProcess.restart(id, { ...opts, expected: found }))
            : params.action === "stop"
              ? yield* Effect.promise(() => BackgroundProcess.stop(id))
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
        const parent = params.inherit ? KiloSession.resolveParent(ctx.sessionID) : undefined
        const parentID = parent ? SessionID.make(parent) : undefined
        if (params.inherit && !parentID) return invalid(params.action, "inherit requires a subagent session")
        const err = pattern(params.ready)
        if (err) return invalid(params.action, err)
        const inst = yield* InstanceState.context
        const cwd = path.resolve(inst.directory, params.workdir ?? inst.directory)
        const opts = yield* authorize(ctx, { command, cwd, description: params.description })

        const info = yield* Effect.promise(() =>
          BackgroundProcess.start(
            {
              sessionID: ctx.sessionID,
              command,
              cwd,
              description: params.description,
              ready: params.ready,
              lifetime: params.persistent ? "persistent" : params.inherit ? "parent" : "session",
              parentID,
            },
            opts,
          ),
        )
        if (params.action === "monitor") return yield* monitor(params, ctx, info)
        return {
          title: `Started: ${title(info)}`,
          output: format(info),
          metadata: { processID: info.id, status: info.status },
        }
      }),
  }),
)
