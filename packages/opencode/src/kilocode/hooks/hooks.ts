import path from "path"
import type { Readable } from "node:stream"
import { spawn as native, type SpawnOptions } from "node:child_process"
import launch from "cross-spawn"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Patch } from "@/patch"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { model as modelEnv } from "@/kilocode/process/env"

/**
 * Claude Code-compatible command hooks around agent tool calls.
 *
 * Config shape (same as Claude Code / IBM Bob):
 *   hooks: { PreToolUse: [{ matcher: "edit|write", hooks: [{ type: "command", command, timeout }] }] }
 *
 * Each matching command runs with the hook input as JSON on stdin.
 * PreToolUse: exit 2 (stderr = reason) or a JSON deny decision blocks the tool call.
 * PostToolUse: exit 2 stderr, or a JSON block reason / additionalContext, is appended to the tool result.
 * Any other failure (other exit code, timeout, spawn error) is logged and never blocks,
 * unless the handler sets `onFailure: "block"`.
 */

const log = Log.create({ service: "hooks" })

export type Event = "PreToolUse" | "PostToolUse"
export type Handler = { type: "command"; command: string; args?: string[]; timeout?: number; onFailure?: "block" }
export type Group = { matcher?: string; hooks: Handler[] }
export type Hooks = Partial<Record<Event, Group[]>>

export interface Call {
  tool: string
  /** Extra names a matcher can use, e.g. Claude Code's `mcp__server__tool` for an MCP tool. */
  aliases?: string[]
  args: unknown
  callID?: string
  sessionID: string
  directory: string
  abort?: AbortSignal
}

export interface Outcome {
  code?: number
  stdout: string
  stderr: string
  error?: string
}

const EVENTS: Event[] = ["PreToolUse", "PostToolUse"]
const TIMEOUT = 60 // seconds
const MAX_TIMEOUT = 24 * 60 * 60 // seconds
const LIMIT = 1024 * 1024 // captured bytes per output stream
const FEEDBACK = 10_000 // characters of hook output shown to the model
const DRAIN = 500 // ms to keep reading output after the hook exits
const GRACE = 2_000 // ms to wait for a killed hook to exit before giving up on it
const CONCURRENCY = 8 // hook processes run at once for one tool call
// Kilo's built-in tools name these arguments in camelCase; Claude Code scripts read the snake_case names.
const KEYS: Record<string, string> = {
  filePath: "file_path",
  oldString: "old_string",
  newString: "new_string",
  replaceAll: "replace_all",
}
// Claude Code handler fields whose behavior Kilo does not implement; such handlers are skipped
// rather than run with different semantics (e.g. without their `if` filter).
const UNSUPPORTED = ["if", "async", "asyncRewake", "shell"]

// Kilo tool ids -> Claude Code tool names (the first one is sent as tool_name), so Claude Code
// matchers and scripts keep working.
const ALIASES: Record<string, string[]> = {
  bash: ["Bash"],
  read: ["Read"],
  write: ["Write"],
  edit: ["Edit"],
  apply_patch: ["Edit"],
  glob: ["Glob"],
  grep: ["Grep"],
  webfetch: ["WebFetch"],
  websearch: ["WebSearch"],
  task: ["Agent", "Task"],
  todowrite: ["TodoWrite"],
  question: ["AskUserQuestion"],
  skill: ["Skill"],
  list_mcp_resources: ["ListMcpResourcesTool"],
  read_mcp_resource: ["ReadMcpResourceTool"],
}

/**
 * Hooks run commands automatically with the user's permissions, so they are only honored from
 * trusted config (global, managed, organization). A project config could otherwise run commands
 * from a repository the user has not reviewed, or let a sandboxed agent escape by writing a hook.
 * A `.kilo`/`.kilocode` directory only counts as trusted when it is a global one: outside a git
 * repository, project directories above the working directory are otherwise classed as global.
 */
export function scope<T extends { hooks?: unknown }>(config: T, trusted: boolean, source: string): T {
  if (config.hooks === undefined) return config
  if (trusted && global(source)) return config
  log.warn("ignoring hooks from project config; define hooks in the global config", { source })
  const scoped = { ...config }
  delete scoped.hooks
  return scoped
}

function global(source: string) {
  const dir = path.dirname(source)
  if (![".kilo", ".kilocode"].includes(path.basename(dir))) return true
  const roots = [path.join(Global.Path.home, ".kilo"), path.join(Global.Path.home, ".kilocode"), Flag.KILO_CONFIG_DIR]
  return roots.some((root) => !!root && path.resolve(root) === path.resolve(dir))
}

/**
 * Hooks from every trusted config layer run; arrays are concatenated rather than replaced.
 * Identical groups are kept once, since a config file can be read by more than one loader.
 */
export function concat(a?: Hooks, b?: Hooks): Hooks | undefined {
  if (!a) return b
  if (!b) return a
  return Object.fromEntries(
    EVENTS.flatMap((event) => {
      const seen = new Set<string>()
      const groups = [...(a[event] ?? []), ...(b[event] ?? [])].filter((group) => {
        const key = JSON.stringify(group)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      return groups.length ? [[event, groups]] : []
    }),
  )
}

/**
 * Kilo config hooks plus Claude Code user hooks (~/.claude/settings.json) unless Claude Code
 * compatibility is off. Sandboxed sessions still skip Claude Code hooks: the Linux sandbox cannot
 * protect a ~/.claude directory that does not exist yet.
 */
export const load = Effect.fn("KiloHooks.load")(function* (cfg: { hooks?: Hooks }, claude: boolean) {
  const extra =
    claude && !Flag.KILO_DISABLE_CLAUDE_CODE_HOOKS ? yield* Effect.promise(() => read(Global.Path.home)) : undefined
  return concat(cfg.hooks, extra) ?? {}
})

/** Claude Code user hooks as Kilo runs them, for settings UIs. */
export async function claude() {
  return {
    path: path.join(Global.Path.home, ".claude", "settings.json"),
    enabled: !Flag.KILO_DISABLE_CLAUDE_CODE_HOOKS,
    hooks: await read(Global.Path.home),
  }
}

/** Reads the command hooks of Claude Code's user settings, skipping what Kilo cannot honor. */
export async function read(home: string): Promise<Hooks | undefined> {
  const file = Bun.file(path.join(home, ".claude", "settings.json"))
  if (!(await file.exists())) return undefined
  const data: unknown = await file.json().catch((err: unknown) => {
    log.warn("invalid Claude Code settings", { path: file.name, err: errorMessage(err) })
    return undefined
  })
  if (!isRecord(data) || !isRecord(data.hooks)) return undefined
  if (data.disableAllHooks === true) return undefined
  const source = data.hooks
  const events = Object.keys(source).filter((key) => !EVENTS.includes(key as Event))
  if (events.length) log.info("ignoring unsupported Claude Code hook events", { events })
  return Object.fromEntries(
    EVENTS.flatMap((event) => {
      const value = source[event]
      if (!Array.isArray(value)) return []
      const groups = value.flatMap((group): Group[] => {
        if (!isRecord(group) || !Array.isArray(group.hooks)) return []
        const hooks = group.hooks.flatMap(handler)
        if (!hooks.length) return []
        return [{ ...(typeof group.matcher === "string" ? { matcher: group.matcher } : {}), hooks }]
      })
      return groups.length ? [[event, groups]] : []
    }),
  )
}

function handler(item: unknown): Handler[] {
  if (!isRecord(item) || item.type !== "command" || typeof item.command !== "string") return []
  const unsupported = UNSUPPORTED.filter((key) => item[key] !== undefined && item[key] !== false)
  if (unsupported.length) {
    log.info("skipping Claude Code hook with unsupported fields", { command: item.command, fields: unsupported })
    return []
  }
  const args = Array.isArray(item.args) && item.args.every((arg) => typeof arg === "string") ? item.args : undefined
  if (item.args !== undefined && !args) return []
  return [
    {
      type: "command",
      command: item.command,
      ...(args ? { args } : {}),
      ...(typeof item.timeout === "number" ? { timeout: item.timeout } : {}),
      ...(item.onFailure === "block" ? { onFailure: "block" as const } : {}),
    },
  ]
}

/**
 * Claude Code matcher semantics: "*", "" or omitted match everything; a value made only of
 * letters, digits, "_", "-", spaces, "," and "|" is an exact name or list; anything else is an
 * unanchored regular expression.
 */
export function matches(matcher: string | undefined, names: string[]): boolean {
  if (!matcher || matcher === "*") return true
  if (/^[\w\s,|-]+$/.test(matcher)) {
    const list = matcher.split(/[|,]/).map((item) => item.trim())
    return names.some((name) => list.includes(name))
  }
  const pattern = regex(matcher)
  return !!pattern && names.some((name) => pattern.test(name))
}

function regex(source: string) {
  try {
    return new RegExp(source)
  } catch (err) {
    log.warn("invalid hook matcher", { matcher: source, err: errorMessage(err) })
    return undefined
  }
}

/** Names a matcher is tested against: the Kilo tool id, its Claude Code names, and call aliases. */
export function names(call: Pick<Call, "tool" | "aliases">) {
  return [call.tool, ...(ALIASES[call.tool] ?? []), ...(call.aliases ?? [])]
}

/** Handlers for an event and tool, deduplicated by command (a hook defined in two config files runs once). */
export function select(hooks: Hooks, event: Event, call: Pick<Call, "tool" | "aliases">): Handler[] {
  const list = names(call)
  const seen = new Set<string>()
  return (hooks[event] ?? [])
    .filter((group) => matches(group.matcher, list))
    .flatMap((group) => group.hooks)
    .filter((handler) => {
      const key = JSON.stringify([handler.command, handler.args ?? []])
      if (handler.type !== "command" || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** Hook input sent on stdin, using Claude Code's field names. */
export function input(event: Event, call: Call, response?: string) {
  return {
    session_id: call.sessionID,
    cwd: call.directory,
    hook_event_name: event,
    tool_name: ALIASES[call.tool]?.[0] ?? call.aliases?.[0] ?? call.tool,
    kilo_tool_name: call.tool,
    tool_input: compat(call.tool, call.args, call.directory),
    tool_use_id: call.callID,
    ...(response === undefined ? {} : { tool_response: response }),
  }
}

/**
 * One input per hook run. An apply_patch call runs the hooks once per file in the patch, with
 * that file as `file_path`, so a guard on file paths sees every file the patch touches.
 */
export function inputs(event: Event, call: Call, response?: string) {
  const base = input(event, call, response)
  const files = call.tool === "apply_patch" ? patched(call.args, call.directory) : []
  if (!files.length) return [base]
  return files.map((file) => ({ ...base, tool_input: { ...base.tool_input, file_path: file, file_paths: files } }))
}

function patched(args: unknown, dir: string): string[] {
  if (!isRecord(args) || typeof args.patchText !== "string") return []
  const text = args.patchText
  const hunks = (() => {
    try {
      return Patch.parsePatch(text).hunks
    } catch (err) {
      log.debug("could not parse patch for hooks", { err: errorMessage(err) })
      return []
    }
  })()
  const files = hunks.flatMap((hunk) => [
    hunk.path,
    ...(hunk.type === "update" && hunk.move_path ? [hunk.move_path] : []),
  ])
  return [...new Set(files.map((file) => path.resolve(dir, file)))]
}

/**
 * For built-in tools, adds Claude Code's snake_case names (file_path, old_string, ...) for the
 * camelCase arguments the tool actually uses. They overwrite what the model sent, so a model
 * cannot show hooks a decoy `file_path` while the tool acts on `filePath`. Other tools (MCP)
 * get their arguments unchanged, as in Claude Code.
 */
export function compat(tool: string, args: unknown, dir: string): Record<string, unknown> {
  if (!isRecord(args)) return {}
  if (!ALIASES[tool]) return args
  const result: Record<string, unknown> = { ...args }
  for (const [key, snake] of Object.entries(KEYS)) {
    if (!(key in args)) continue
    const value = args[key]
    result[snake] = key === "filePath" && typeof value === "string" ? path.resolve(dir, value) : value
  }
  return result
}

function seconds(timeout: number | undefined) {
  if (timeout === undefined || !Number.isFinite(timeout) || timeout <= 0) return TIMEOUT
  return Math.min(timeout, MAX_TIMEOUT)
}

/**
 * Runs one command hook with the input on stdin. Shell form (`command` only) runs through the
 * platform shell; exec form (`command` plus `args`) spawns the program directly. On timeout or
 * abort the whole process tree is killed. Never throws: failures are reported in the outcome.
 */
export function run(handler: Handler, payload: unknown, opts: { cwd: string; abort?: AbortSignal }) {
  const limit = seconds(handler.timeout)
  const fail = (error: string) => Promise.resolve<Outcome>({ stdout: "", stderr: "", error })
  if (opts.abort?.aborted) return fail("aborted")
  if (!handler.command.trim()) return fail("empty command")
  const input = attempt(() => JSON.stringify(payload))
  if (input instanceof Error) return fail(errorMessage(input))
  const child = attempt(() => spawn(handler, opts.cwd))
  if (child instanceof Error) return fail(errorMessage(child))
  const pid = child.pid
  if (pid !== undefined) live.add(pid)
  const result = Promise.withResolvers<Outcome>()
  // Set when the hook is stopped, and read at exit time so a late drain cannot change the outcome.
  let stopped: "timeout" | "aborted" | undefined
  let exited = false
  const reason = (stop: "timeout" | "aborted") => (stop === "timeout" ? `timed out after ${limit}s` : "aborted")
  const stop = (why: "timeout" | "aborted") => {
    if (stopped || exited) return
    stopped = why
    kill(pid)
    // If the kill does not take effect, give up on the hook rather than hang the tool call. The pid
    // stays in `live`, so Kilo tries again when it exits.
    setTimeout(() => {
      if (exited) return
      child.stdout?.destroy()
      child.stderr?.destroy()
      result.resolve({ stdout: "", stderr: "", error: reason(why) })
    }, GRACE).unref()
  }
  const timer = setTimeout(() => stop("timeout"), limit * 1000)
  const abort = () => stop("aborted")
  opts.abort?.addEventListener("abort", abort, { once: true })
  const done = () => {
    clearTimeout(timer)
    opts.abort?.removeEventListener("abort", abort)
    if (pid !== undefined) live.delete(pid)
  }
  const out = collect(child.stdout)
  const err = collect(child.stderr)
  child.stdin?.on("error", (error) => log.debug("hook closed stdin early", { err: errorMessage(error) }))
  child.stdin?.end(input)
  child.on("error", (error) => {
    done()
    result.resolve({ stdout: "", stderr: "", error: errorMessage(error) })
  })
  child.on("exit", (code) => {
    exited = true
    done()
    const why = stopped
    // A background process started by the hook can keep the pipes open; stop reading shortly after exit.
    const drain = setTimeout(() => {
      child.stdout?.destroy()
      child.stderr?.destroy()
    }, DRAIN)
    void Promise.all([out, err]).then(([stdout, stderr]) => {
      clearTimeout(drain)
      if (why) return result.resolve({ stdout, stderr, error: reason(why) })
      result.resolve({ code: code ?? 1, stdout, stderr })
    })
  })
  return result.promise
}

function attempt<T>(fn: () => T) {
  try {
    return fn()
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

function spawn(handler: Handler, cwd: string) {
  const opts: SpawnOptions = {
    cwd,
    env: modelEnv({ KILO_PROJECT_DIR: cwd, CLAUDE_PROJECT_DIR: cwd }), // hooks must not inherit backend credentials
    stdio: "pipe",
    windowsHide: true,
    detached: process.platform !== "win32", // own process group, so a timeout can kill the whole tree
  }
  // cross-spawn resolves programs the way a shell would (PATHEXT, shebangs on Windows), but it adds
  // nothing to shell form and reports any exit code 1 there as ENOENT on Windows.
  if (handler.args === undefined) return native(handler.command, { ...opts, shell: true })
  return launch(handler.command, handler.args, opts)
}

// Hooks run in their own process group, which a kill of Kilo's group does not reach: stop any
// hook still running when Kilo exits.
const live = new Set<number>()
process.once("exit", () => {
  for (const pid of live) kill(pid)
})

function kill(pid: number | undefined) {
  if (pid === undefined) return
  if (process.platform === "win32") {
    launch("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", (error) =>
      log.debug("could not kill hook process tree", { err: errorMessage(error) }),
    )
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch (error) {
    log.debug("could not kill hook process group", { err: errorMessage(error) })
  }
}

function collect(stream: Readable | null | undefined) {
  return new Promise<string>((resolve) => {
    if (!stream) return resolve("")
    const chunks: Buffer[] = []
    let size = 0
    stream.on("data", (chunk: Buffer) => {
      if (size >= LIMIT) return
      chunks.push(chunk)
      size += chunk.length
    })
    stream.on("error", (error) => log.debug("hook output stream failed", { err: errorMessage(error) }))
    stream.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

function json(stdout: string): Record<string, unknown> | undefined {
  const text = stdout.trim()
  if (!text.startsWith("{")) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : undefined
  } catch (err) {
    log.warn("hook printed invalid JSON", { err: errorMessage(err) })
    return undefined
  }
}

function reason(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "No reason given."
}

/** Why a PreToolUse outcome blocks the call, if it does. */
export function blocked(outcome: Outcome, handler?: Pick<Handler, "onFailure">): string | undefined {
  if (outcome.code === 2) return reason(outcome.stderr)
  if (outcome.code !== 0) {
    if (handler?.onFailure !== "block") return undefined
    return `The hook failed (${outcome.error ?? `exit code ${outcome.code}`}) and is set to block on failure.`
  }
  const output = json(outcome.stdout)
  if (!output) return undefined
  const specific = isRecord(output.hookSpecificOutput) ? output.hookSpecificOutput : {}
  // "allow" and "ask" are ignored: hooks can only tighten permissions, never loosen them.
  if (specific.permissionDecision === "deny") return reason(specific.permissionDecisionReason)
  if (output.decision === "block") return reason(output.reason)
  if (output.continue === false) return reason(output.stopReason)
  return undefined
}

/** Feedback a PostToolUse outcome gives the model, if any. Plain stdout on exit 0 is not shown, as in Claude Code. */
export function feedback(outcome: Outcome): string | undefined {
  if (outcome.code === 2) return outcome.stderr.trim() || undefined
  if (outcome.code !== 0) return undefined
  const output = json(outcome.stdout)
  if (!output) return undefined
  const specific = isRecord(output.hookSpecificOutput) ? output.hookSpecificOutput : {}
  const notes = [output.decision === "block" ? output.reason : undefined, specific.additionalContext].filter(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  )
  return notes.length ? notes.join("\n") : undefined
}

function clip(text: string) {
  if (text.length <= FEEDBACK) return text
  return `${text.slice(0, FEEDBACK)}\n... (hook output truncated)`
}

function execute(event: Event, hooks: Hooks, call: Call, response?: string) {
  const handlers = select(hooks, event, call)
  if (!handlers.length) return Effect.succeed([] as { handler: Handler; outcome: Outcome }[])
  const runs = inputs(event, call, response).flatMap((payload) => handlers.map((handler) => ({ handler, payload })))
  // Bounded so a patch touching many files cannot exhaust processes and make guards fail open.
  return Effect.forEach(
    runs,
    (item) =>
      Effect.promise(async () => {
        const start = Date.now()
        const outcome = await run(item.handler, item.payload, { cwd: call.directory, abort: call.abort })
        const info = { event, tool: call.tool, command: item.handler.command, ms: Date.now() - start }
        if (outcome.error) log.warn("hook failed", { ...info, error: outcome.error })
        else if (outcome.code !== 0 && outcome.code !== 2)
          log.warn("hook exited with a non-blocking error", {
            ...info,
            code: outcome.code,
            stderr: outcome.stderr.trim(),
          })
        else log.info("hook finished", { ...info, code: outcome.code })
        return { handler: item.handler, outcome }
      }),
    { concurrency: CONCURRENCY },
  )
}

/** Runs PreToolUse hooks. Returns the message to fail the tool call with when a hook blocks it. */
export const before = Effect.fn("KiloHooks.before")(function* (hooks: Hooks, call: Call) {
  const results = yield* execute("PreToolUse", hooks, call)
  // The user cancelled while the hooks ran: never let the tool run without its guards.
  if (results.length && call.abort?.aborted) return "The tool call was aborted before it ran."
  const reasons = results
    .map((item) => blocked(item.outcome, item.handler))
    .filter((value): value is string => value !== undefined)
  if (!reasons.length) return undefined
  return `A PreToolUse hook blocked this ${call.tool} call:\n${clip([...new Set(reasons)].join("\n"))}`
})

/** Runs PostToolUse hooks and appends their feedback to the tool result the model sees. */
export const after = Effect.fn("KiloHooks.after")(function* (hooks: Hooks, call: Call, result: { output: string }) {
  const notes = (yield* execute("PostToolUse", hooks, call, result.output))
    .map((item) => feedback(item.outcome))
    .filter((value): value is string => value !== undefined)
  if (!notes.length) return
  result.output = `${result.output}\n\n<hook_feedback event="PostToolUse">\n${clip([...new Set(notes)].join("\n\n"))}\n</hook_feedback>`
})

export * as KiloHooks from "./hooks"
