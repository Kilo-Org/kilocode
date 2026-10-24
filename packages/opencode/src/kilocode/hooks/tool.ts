import path from "path"
import { createHash } from "crypto"
import { asc, eq } from "drizzle-orm"
import { Cause, Effect, Option } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { TodoTable } from "@opencode-ai/core/session/sql"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { ToolExecutionOptions } from "ai"
import { Suggestion } from "@/kilocode/suggestion"
import { SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import type { Tool } from "@/tool/tool"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import type { Event } from "./events"
import { KiloHooks } from "./hooks"
import { KiloHookLifecycle } from "./lifecycle"
import { KiloHookLoop } from "./loop"
import { KiloHookPayload } from "./payload"

// Tool events: PreToolUse and PostToolUse around every tool call (session/tools.ts), plus the
// PostToolUseFailure wrapper, the PermissionRequest review that races the permission prompt, the
// Task events for todowrite, CwdChanged for bash and InstructionsLoaded for nested AGENTS.md reads.

const HOUR = 60 * 60 * 1000
const SESSIONS = 4096 // sessions whose last bash workdir is remembered

type Note = { event: string; text: string }

// Feedback waiting for its call's result, keyed by tool call id: PreToolUse context and Task
// event rollbacks, appended to the result (or error) the model sees.
const pending = new Map<string, { time: number; notes: Note[] }>()
// When each wrapped tool call started, for `duration_ms`.
const started = new Map<string, number>()

function prune<T extends { time: number } | number>(map: Map<string, T>, now: number) {
  for (const [key, item] of map) if (now - (typeof item === "number" ? item : item.time) > HOUR) map.delete(key)
}

function keep(id: string, notes: readonly Note[]) {
  if (!notes.length) return
  const now = Date.now()
  prune(pending, now)
  pending.set(id, { time: now, notes: [...(pending.get(id)?.notes ?? []), ...notes] })
}

/** The feedback blocks waiting for a call, one per event in arrival order; removes them. */
function take(id: string | undefined) {
  if (!id) return []
  const item = pending.get(id)
  pending.delete(id)
  const events = [...new Set(item?.notes.map((note) => note.event))]
  return events.map((event) =>
    block(
      event,
      (item?.notes ?? []).filter((note) => note.event === event).map((note) => note.text),
    ),
  )
}

function mark(id: string | undefined) {
  if (!id) return
  const now = Date.now()
  prune(started, now)
  started.set(id, now)
}

function elapsed(id: string | undefined) {
  const start = id ? started.get(id) : undefined
  if (id) started.delete(id)
  return start === undefined ? 0 : Date.now() - start
}

function block(event: string, notes: readonly string[]) {
  return `<hook_feedback event="${event}">\n${KiloHooks.clip(notes.join("\n\n"))}\n</hook_feedback>`
}

/**
 * The hook view of the tool calls of one model step: `(tool, args, opts, aliases?, server?)` gives
 * the `KiloHooks.Call` for a call, with the session's root, its permission mode and whether someone
 * can answer a prompt in this turn. A PreToolUse `ask` shows a forced permission prompt for the call
 * through `ask` (never auto-approved or remembered), which names the tool and carries its input,
 * as hooks see them, for clients to show.
 */
export const caller = Effect.fn("KiloHookTool.caller")(function* (
  input: {
    session: Session.Info
    agent: { name: string }
    processor: { message: { parentID: string } }
    messages: SessionV1.WithParts[]
  },
  sessions: Session.Interface,
  ask: (
    hook: KiloHooks.Call,
    args: unknown,
    opts: ToolExecutionOptions,
    request: Parameters<Tool.Context["ask"]>[0],
  ) => Effect.Effect<void>,
) {
  const root = input.session.parentID ? yield* KiloHookPayload.root(input.session.id, sessions) : input.session.id
  const attended = KiloHookPayload.attendance({
    sessionID: input.session.id,
    parent: input.session.parentID,
    messages: input.messages,
    user: input.processor.message.parentID,
  })
  return (
    tool: string,
    args: unknown,
    opts: ToolExecutionOptions,
    aliases?: string[],
    server?: string,
  ): KiloHooks.Call => {
    const hook: KiloHooks.Call = {
      tool,
      aliases,
      args,
      callID: opts.toolCallId,
      sessionID: input.session.id,
      directory: input.session.directory,
      abort: opts.abortSignal,
      agent: input.agent.name,
      prompt: input.processor.message.parentID,
      parent: input.session.parentID,
      root,
      mode: KiloHookPayload.mode(input.session.permission, input.agent.name),
      attended,
      server,
      confirm: (reason) => {
        // What hooks were shown: the Claude Code tool name and the arguments they received.
        const shown = KiloHooks.input("PreToolUse", hook)
        const pattern =
          tool === "bash" && typeof shown.tool_input.command === "string"
            ? shown.tool_input.command
            : typeof shown.tool_input.file_path === "string"
              ? shown.tool_input.file_path
              : "*"
        return ask(hook, args, opts, {
          permission: tool,
          patterns: [pattern],
          always: [],
          metadata: { hookAsk: true, reason, tool: shown.tool_name, input: shown.tool_input },
        })
      },
    }
    return hook
  }
})

/** Common hook input fields for a tool call's session. */
function base(event: Event, call: KiloHooks.Call, cwd = call.directory) {
  return KiloHookPayload.base(event, {
    sessionID: call.sessionID,
    root: call.root,
    parent: call.parent,
    cwd,
    agent: call.agent,
    prompt: call.prompt,
    mode: call.mode,
  })
}

/**
 * Runs PreToolUse hooks. Returns the message to fail the tool call with when a hook blocks it,
 * stops the turn, or asks for a confirmation nobody can give. An `ask` on an attended turn shows a
 * forced permission prompt; a rejection fails like any user rejection. For `todowrite`, the Task
 * events then run and can roll back single items of the update.
 */
export const before = Effect.fn("KiloHookTool.before")(function* (hooks: KiloHooks.Hooks, call: KiloHooks.Call) {
  const verdict = yield* KiloHooks.fire({
    event: "PreToolUse",
    hooks,
    subjects: KiloHooks.names(call),
    call,
    payloads: KiloHooks.inputs("PreToolUse", call),
    cwd: call.directory,
    sessionID: call.sessionID,
    signal: call.abort,
  })
  // The user cancelled while the hooks ran: never let the tool run without its guards.
  if (verdict.ran && call.abort?.aborted) return "The tool call was aborted before it ran."
  if (verdict.block) return `A PreToolUse hook blocked this ${call.tool} call:\n${verdict.block}`
  if (verdict.stop !== undefined) {
    KiloHookLoop.halt(call.sessionID, verdict.stop, { event: "PreToolUse", prompt: call.prompt })
    return `A PreToolUse hook stopped the turn: ${verdict.stop.trim() || "No reason given."}`
  }
  if (verdict.ask !== undefined) {
    if (!call.confirm || call.attended === false)
      return `A PreToolUse hook asked for confirmation, but nobody can answer in this turn: ${verdict.ask}`
    yield* call.confirm(verdict.ask)
  }
  if (call.callID)
    keep(
      call.callID,
      verdict.context.map((text) => ({ event: "PreToolUse", text })),
    )
  if (call.tool === "todowrite") yield* tasks(hooks, call)
  return undefined
})

/**
 * PostToolUse for a result: the replacement text a hook gave (`updatedToolOutput`), if any, and
 * the feedback blocks to append (PreToolUse context, Task rollbacks, PostToolUse feedback).
 */
export const post = Effect.fn("KiloHookTool.post")(function* (
  hooks: KiloHooks.Hooks,
  call: KiloHooks.Call,
  response: unknown,
  text: string,
) {
  const verdict = yield* KiloHooks.fire({
    event: "PostToolUse",
    hooks,
    subjects: KiloHooks.names(call),
    call,
    payloads: KiloHooks.inputs("PostToolUse", call, response, text),
    cwd: call.directory,
    sessionID: call.sessionID,
    signal: call.abort,
  })
  if (verdict.stop !== undefined)
    KiloHookLoop.halt(call.sessionID, verdict.stop, { event: "PostToolUse", prompt: call.prompt })
  return {
    output: verdict.output,
    notes: [...take(call.callID), ...(verdict.context.length ? [block("PostToolUse", verdict.context)] : [])],
  }
})

/**
 * Runs PostToolUse hooks: `updatedToolOutput` replaces the output the model sees (text and
 * attachments; the UI may still show the streamed original from metadata), then PreToolUse context
 * and PostToolUse feedback are appended to it. A bash command that exited non-zero runs
 * PostToolUseFailure instead, as Claude Code counts it as a failed call.
 */
export const after = Effect.fn("KiloHookTool.after")(function* (
  hooks: KiloHooks.Hooks,
  call: KiloHooks.Call,
  result: { output: string; metadata?: unknown; attachments?: unknown[] },
) {
  const metadata = isRecord(result.metadata) ? result.metadata : {}
  if (call.tool === "bash") yield* moved(hooks, call)
  if (call.tool === "bash" && typeof metadata.exit === "number" && metadata.exit !== 0) {
    const notes = [
      ...take(call.callID),
      ...(yield* failed(hooks, call, `Exit code ${metadata.exit}\n${result.output}`, false)),
    ]
    if (notes.length) result.output = `${result.output}\n\n${notes.join("\n\n")}`
    return
  }
  elapsed(call.callID)
  const verdict = yield* post(hooks, call, KiloHooks.response(call, result), result.output)
  if (verdict.output !== undefined) {
    // A replacement only narrows what the model sees: never longer than the tool's own output
    // (already truncated) or one hook output item, and without the original's images or files.
    result.output = KiloHooks.clip(verdict.output, Math.max(KiloHooks.FEEDBACK, result.output.length))
    if (result.attachments) result.attachments = []
  }
  if (verdict.notes.length) result.output = `${result.output}\n\n${verdict.notes.join("\n\n")}`
  if (call.tool === "read" && Array.isArray(metadata.loaded)) yield* loaded(hooks, call, metadata.loaded)
})

// Errors that steer the agent loop (rejections, dismissals, hook blocks, malformed calls): rethrown
// unchanged, so the checks that recognize them keep working, and never reported as tool failures.
const CONTROL = new Set([
  "PermissionRejectedError",
  "PermissionCorrectedError",
  "PermissionDeniedError",
  "QuestionRejectedError",
  "ToolInvalidArgumentsError",
  "KiloHookBlocked",
  "KiloHookDenied",
])

function control(error: unknown) {
  if (error instanceof Suggestion.DismissedError) return true
  return isRecord(error) && typeof error._tag === "string" && CONTROL.has(error._tag)
}

function aborted(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
}

/** Keeps the start and end of a long error, as Claude Code sends at most 10 000 characters. */
function middle(text: string) {
  if (text.length <= KiloHooks.FEEDBACK) return text
  const half = KiloHooks.FEEDBACK / 2
  return `${text.slice(0, half)}\n... (truncated) ...\n${text.slice(-half)}`
}

/** PostToolUseFailure for a failed call: the feedback blocks for the model. */
const failed = Effect.fn("KiloHookTool.failed")(function* (
  hooks: KiloHooks.Hooks,
  call: KiloHooks.Call,
  error: string,
  interrupt: boolean,
) {
  const duration = elapsed(call.callID)
  const verdict = yield* KiloHooks.fire({
    event: "PostToolUseFailure",
    hooks,
    subjects: KiloHooks.names(call),
    call,
    payloads: KiloHooks.inputs("PostToolUseFailure", call).map((item) => ({
      ...item,
      error: middle(error),
      is_interrupt: interrupt,
      duration_ms: duration,
    })),
    cwd: call.directory,
    sessionID: call.sessionID,
    signal: call.abort,
  })
  if (verdict.stop !== undefined)
    KiloHookLoop.halt(call.sessionID, verdict.stop, { event: "PostToolUseFailure", prompt: call.prompt })
  return verdict.context.length ? [block("PostToolUseFailure", verdict.context)] : []
})

/**
 * Runs PostToolUseFailure hooks when the tool call fails, appending their feedback to the error
 * the model sees. Control-flow errors (rejections, hook blocks) and cancelled calls pass through
 * untouched and run no hook.
 */
export function failure<A, E, R>(
  hooks: KiloHooks.Hooks,
  call: KiloHooks.Call,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.suspend(() => {
    mark(call.callID)
    return effect.pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const error = Cause.squash(cause)
          if (Cause.hasInterruptsOnly(cause) || call.abort?.aborted || control(error)) {
            take(call.callID)
            elapsed(call.callID)
            return yield* Effect.failCause(cause)
          }
          if (call.tool === "bash") yield* moved(hooks, call)
          const message = errorMessage(error)
          const notes = [...take(call.callID), ...(yield* failed(hooks, call, message, aborted(error)))]
          if (!notes.length) return yield* Effect.failCause(cause)
          return yield* Effect.die(new Error(`${message}\n\n${notes.join("\n\n")}`))
        }),
      ),
    )
  })
}

/** Decides a pending permission request; resolves with a deny when a hook denies it. */
export type Review = (request: PermissionV1.Request) => Effect.Effect<{ deny?: string; interrupt?: boolean }>

/**
 * The PermissionRequest review for a tool call's permission asks, when the event has handlers.
 * Hooks can only deny: `allow`, `updatedInput` and `updatedPermissions` are ignored.
 */
export function review(hooks: KiloHooks.Hooks, call: KiloHooks.Call): Review | undefined {
  if (!KiloHooks.select(hooks, "PermissionRequest", KiloHooks.names(call), call).length) return undefined
  return (request) =>
    KiloHooks.fire({
      event: "PermissionRequest",
      hooks,
      subjects: KiloHooks.names(call),
      call,
      payloads: KiloHooks.inputs("PermissionRequest", call).map((item) => {
        const { tool_use_id: _, ...rest } = item
        return { ...rest, kilo_permission: request.permission, kilo_patterns: request.patterns }
      }),
      cwd: call.directory,
      sessionID: call.sessionID,
      signal: call.abort,
    }).pipe(
      Effect.map((verdict) =>
        verdict.block
          ? {
              deny: `A PermissionRequest hook denied this ${call.tool} call: ${verdict.block}`,
              ...(verdict.interrupt ? { interrupt: true } : {}),
            }
          : {},
      ),
    )
}

/**
 * Races a pending permission prompt: never settles unless a hook denies, in which case `closed`
 * dismisses the prompt and the call fails (a `Denied` defect, or a rejection on interrupt). A user
 * reply that comes first interrupts the review, which kills the hooks.
 */
export function contest(
  review: Review | undefined,
  info: PermissionV1.Request,
  closed: () => Effect.Effect<void>,
): Effect.Effect<never, PermissionV1.RejectedError> {
  if (!review) return Effect.never
  return review(info).pipe(
    Effect.flatMap((result) => {
      if (result.deny === undefined) return Effect.never
      const deny = result.deny
      return closed().pipe(
        Effect.andThen(
          result.interrupt ? Effect.fail(new PermissionV1.RejectedError()) : Effect.die(new KiloHooks.Denied(deny)),
        ),
      )
    }),
  )
}

type Todo = { content: string; status: string; priority: string }

function todo(value: unknown): value is Todo {
  return (
    isRecord(value) &&
    typeof value.content === "string" &&
    typeof value.status === "string" &&
    typeof value.priority === "string"
  )
}

/** The session's current todo list, when the database is available. */
const todos = Effect.fn("KiloHookTool.todos")(function* (sessionID: string) {
  const service = yield* Effect.serviceOption(Database.Service)
  if (Option.isNone(service)) return undefined
  return yield* service.value.db
    .select()
    .from(TodoTable)
    .where(eq(TodoTable.session_id, SessionID.make(sessionID)))
    .orderBy(asc(TodoTable.position))
    .all()
    .pipe(Effect.orDie)
})

/** A todo's stable id for hooks: todos have no id, so it hashes the content. */
function id(content: string) {
  return createHash("sha256").update(content).digest("hex").slice(0, 8)
}

/**
 * TaskCreated and TaskCompleted for a todowrite call, diffing the stored list with the new one by
 * content. A block rolls back that one item in `call.args.todos` (the object the tool receives):
 * a blocked creation drops it, a blocked completion restores its previous status.
 */
const tasks = Effect.fn("KiloHookTool.tasks")(function* (hooks: KiloHooks.Hooks, call: KiloHooks.Call) {
  const create = KiloHooks.select(hooks, "TaskCreated", []).length > 0
  const complete = KiloHooks.select(hooks, "TaskCompleted", []).length > 0
  if (!create && !complete) return
  const args = isRecord(call.args) ? call.args : undefined
  if (!args || !Array.isArray(args.todos)) return
  const stored = yield* todos(call.sessionID)
  if (!stored) return
  const previous = new Map<string, Todo>()
  for (const item of stored) if (!previous.has(item.content)) previous.set(item.content, item)
  const run = (event: "TaskCreated" | "TaskCompleted", item: Todo) =>
    KiloHooks.fire({
      event,
      hooks,
      call,
      payloads: [
        {
          ...base(event, call),
          task_id: id(item.content),
          task_subject: item.content,
          kilo_status: item.status,
          kilo_priority: item.priority,
        },
      ],
      cwd: call.directory,
      sessionID: call.sessionID,
      signal: call.abort,
    })
  const notes: Note[] = []
  const next: unknown[] = []
  for (const item of args.todos) {
    if (!todo(item)) {
      next.push(item)
      continue
    }
    const prior = previous.get(item.content)
    if (!prior && create) {
      const verdict = yield* run("TaskCreated", item)
      if (verdict.block) {
        notes.push({
          event: "TaskCreated",
          text: `Task "${item.content}" was not created: ${verdict.block}. Resubmit the list without that change once the hook's condition holds.`,
        })
        continue
      }
    }
    if (item.status === "completed" && prior?.status !== "completed" && complete) {
      const verdict = yield* run("TaskCompleted", item)
      if (verdict.block) {
        notes.push({
          event: "TaskCompleted",
          text: `Task "${item.content}" was kept open: ${verdict.block}. Resubmit the list without that change once the hook's condition holds.`,
        })
        next.push({ ...item, status: prior?.status ?? "pending" })
        continue
      }
    }
    next.push(item)
  }
  if (!notes.length) return
  args.todos = next
  if (call.callID) keep(call.callID, notes)
})

// The last bash workdir per session, for CwdChanged.
const dirs = new Map<string, string>()

/** The `watchPaths` a hook returned, if any hook returned the field (`[]` clears the list). */
function watched(verdict: KiloHooks.Verdict) {
  const lists = verdict.specific.flatMap((item) => (Array.isArray(item.watchPaths) ? [item.watchPaths] : []))
  if (!lists.length) return undefined
  return lists.flat().filter((item): item is string => typeof item === "string" && item.length > 0)
}

/**
 * CwdChanged when a bash call runs in another directory than the session's previous one. Kilo's
 * shell keeps no working directory, so this means "the agent ran a command somewhere else".
 */
function moved(hooks: KiloHooks.Hooks, call: KiloHooks.Call) {
  const args = isRecord(call.args) ? call.args : {}
  const next = path.resolve(call.directory, typeof args.workdir === "string" ? args.workdir : call.directory)
  const prev = dirs.get(call.sessionID) ?? call.directory
  KiloHooks.keep(dirs, call.sessionID, next, SESSIONS)
  if (prev === next || !KiloHooks.select(hooks, "CwdChanged", []).length) return Effect.void
  return KiloHookLifecycle.detach(
    KiloHooks.fire({
      event: "CwdChanged",
      hooks,
      payloads: [{ ...base("CwdChanged", call, next), old_cwd: prev, new_cwd: next }],
      cwd: call.directory,
      sessionID: call.sessionID,
    }).pipe(
      Effect.tap((verdict) =>
        Effect.sync(() => {
          const paths = watched(verdict)
          if (paths) KiloHookLifecycle.watch(call.directory, paths)
        }),
      ),
    ),
  )
}

/** InstructionsLoaded (`nested_traversal`) for the AGENTS.md files a read pulled in. */
function loaded(hooks: KiloHooks.Hooks, call: KiloHooks.Call, files: readonly unknown[]) {
  const list = files.filter((item): item is string => typeof item === "string" && item.length > 0)
  const subjects = ["nested_traversal"]
  if (!list.length || !KiloHooks.select(hooks, "InstructionsLoaded", subjects).length) return Effect.void
  const trigger = KiloHooks.compat(call.tool, call.args, call.directory).file_path
  return KiloHookLifecycle.detach(
    KiloHooks.fire({
      event: "InstructionsLoaded",
      hooks,
      subjects,
      payloads: list.map((file) => ({
        ...base("InstructionsLoaded", call),
        file_path: file,
        memory_type: KiloHookPayload.memory(file),
        load_reason: "nested_traversal",
        ...(typeof trigger === "string" ? { trigger_file_path: trigger } : {}),
      })),
      cwd: call.directory,
      sessionID: call.sessionID,
    }),
  )
}

export * as KiloHookTool from "./tool"
