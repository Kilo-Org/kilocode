import os from "os"
import path from "path"
import { stat } from "node:fs/promises"
import type { Readable } from "node:stream"
import { spawn as native, type SpawnOptions } from "node:child_process"
import launch from "cross-spawn"
import { Cause, Duration, Effect, Option } from "effect"
import type { EventV2 } from "@opencode-ai/core/event"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Shell } from "@opencode-ai/core/shell"
import { NamedError } from "@opencode-ai/core/util/error"
import * as Log from "@opencode-ai/core/util/log"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { EventV2Bridge } from "@/event-v2-bridge"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import { model as modelEnv } from "@/kilocode/process/env"
import { McpCatalog } from "@/mcp/catalog"
import { Patch } from "@/patch"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { Wildcard } from "@/util/wildcard"
import { concat } from "./config"
import { CLAUDE_KNOWN, CONDITIONS, EVENTS, GUARDS, IMPORTED, TOOLS, known as registered, meta } from "./events"
import type { Event } from "./events"
import { KiloHookLifecycle } from "./lifecycle"
import { KiloHookPayload } from "./payload"
import { KiloHookTool } from "./tool"

/**
 * Claude Code-compatible command hooks on agent events.
 *
 * Config shape (same as Claude Code):
 *   hooks: { PreToolUse: [{ matcher: "edit|write", hooks: [{ type: "command", command, timeout }] }] }
 *
 * Each matching command runs with the hook input as JSON on stdin. Exit codes and JSON output
 * combine as in Claude Code (see `decide`). A hook that crashes, times out or prints invalid JSON
 * never blocks, unless it sets `onFailure: "block"` on an event that honors it. Hooks can only make
 * things stricter: no output approves a permission or widens a sandbox.
 */

const log = Log.create({ service: "hooks" })

export { concat, scope } from "./config"
export type { Event } from "./events"

export type Handler = {
  type: "command"
  command: string
  args?: string[]
  timeout?: number
  onFailure?: "block" | "continue"
  async?: boolean
  shell?: "bash" | "powershell"
  if?: string
}
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
  /** Kilo agent running the call. */
  agent?: string
  /** User message id of the turn. */
  prompt?: string
  /** Parent session id, set for subagent sessions. */
  parent?: string
  /** Root session id, sent as `session_id`. */
  root?: string
  /** Claude Code permission mode (`default`, `plan`, `bypassPermissions`). */
  mode?: string
  /** Someone can answer a prompt in this turn. */
  attended?: boolean
  /** Shows a forced permission prompt for a PreToolUse `ask`; absent where no prompt is possible. */
  confirm?: (reason: string) => Effect.Effect<void, PermissionV1.Error>
  /** MCP server name, for MCP tools. */
  server?: string
}

export interface Outcome {
  code?: number
  stdout: string
  stderr: string
  error?: string
}

/** What a set of hook runs decided, aggregated over every handler and payload. */
export interface Verdict {
  /** Joined, deduplicated blocking reasons. */
  block?: string
  /** `continue: false` was seen; its stopReason, or "". */
  stop?: string
  /** PreToolUse `permissionDecision: "ask"` (a deny wins over it). */
  ask?: string
  /** PermissionRequest `decision.interrupt`, or `continue: false` together with a deny. */
  interrupt?: boolean
  /** PostToolUse `updatedToolOutput` / `updatedMCPToolOutput`, the last in config order. */
  output?: string
  /** additionalContext (and plain stdout where honored), deduplicated, each clipped. */
  context: string[]
  /** Shown to the user: systemMessage, exit-2 stderr on "user" events, first failure per handler. */
  user: string[]
  /** hookSpecificOutput objects, in config order. */
  specific: Record<string, unknown>[]
  /** Synchronous handlers that ran. */
  ran: number
}

/** What one hook run decided. */
type Decision = Omit<Verdict, "ran"> & { failure?: string }

/** Hook input for a tool event: the common fields plus the tool's. */
type Input = Record<string, unknown> & {
  tool_name: string
  kilo_tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id?: string
}

type Skip = { event: string; command?: string; reason: string }
type Inspection = { hooks?: Hooks; skipped: Skip[] }

const MAX_TIMEOUT = 24 * 60 * 60 // seconds
const LIMIT = 1024 * 1024 // captured bytes per output stream
export const FEEDBACK = 10_000 // characters of one hook output item
const DRAIN = 500 // ms to keep reading output after the hook exits
const GRACE = 2_000 // ms to wait for a killed hook to exit before giving up on it
const CONCURRENCY = 8 // hook processes run at once for one event
const MINUTE = 60_000
// Kilo's built-in tools name these arguments in camelCase; Claude Code scripts read the snake_case names.
const KEYS: Record<string, string> = {
  filePath: "file_path",
  oldString: "old_string",
  newString: "new_string",
  replaceAll: "replace_all",
}
const SHELLS = ["bash", "powershell"]
const FILES = new Set(["read", "write", "edit", "apply_patch", "notebook_edit", "notebook_read"])
// Words that run their arguments as a command (`sudo rm`, `xargs rm`, `sh -c rm`) or start a
// compound command (`if rm x; then`): a bash segment starting with one hides the command it runs.
const WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "command",
  "builtin",
  "exec",
  "eval",
  "xargs",
  "time",
  "timeout",
  "nice",
  "nohup",
  "stdbuf",
  "ionice",
  "setsid",
  "watch",
  "alias",
  "source",
  ".",
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "for",
  "case",
  "select",
  "function",
  "coproc",
])

// Kilo tool ids -> Claude Code tool names (the first one is sent as tool_name), so Claude Code
// matchers and scripts keep working.
const ALIASES: Record<string, string[]> = {
  bash: ["Bash"],
  read: ["Read"],
  write: ["Write"],
  // MultiEdit and NotebookRead are older Claude Code tools that existing matchers still name.
  edit: ["Edit", "MultiEdit"],
  apply_patch: ["Edit", "MultiEdit"],
  notebook_edit: ["NotebookEdit"],
  notebook_read: ["NotebookRead"],
  plan_exit: ["ExitPlanMode"],
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

/** Nesting depth of this process: a hook that runs `kilo` starts it with KILO_HOOK_DEPTH set. */
export const DEPTH = Number(process.env.KILO_HOOK_DEPTH) || 0

const skippedDepth = new Set<Event>()

/**
 * The recursion guard: a Kilo started by a hook (depth 1-2) runs only the tool-guard events, and at
 * depth 3 or more it runs no hooks.
 */
export function allowed(event: Event, depth = DEPTH) {
  if (depth >= 3) return false
  if (depth >= 1) return GUARDS.includes(event)
  return true
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

/**
 * The hooks for a session or, without one, for the current instance directory, using the
 * directory's effective sandbox default (including the /sandbox preference) to decide whether
 * Claude Code hooks run. With an event and no handler for it anywhere, it returns at once without
 * reading any sandbox state.
 */
export const resolve = Effect.fn("KiloHooks.resolve")(function* (sessionID?: SessionID, event?: Event) {
  const cfg = yield* (yield* Config.Service).get()
  const hooks: Hooks | undefined = cfg.hooks
  if (event && !hooks?.[event]?.length && !(yield* Effect.promise(() => has(event)))) return {} as Hooks
  const sandboxed = sessionID
    ? (yield* SandboxPolicy.status(sessionID)).enabled
    : yield* SandboxPolicy.directory((yield* InstanceRef)?.directory ?? process.cwd())
  return yield* load(cfg, !sandboxed)
})

/** Whether Claude Code user hooks define a handler for the event (false when they are turned off). */
async function has(event: Event) {
  if (Flag.KILO_DISABLE_CLAUDE_CODE_HOOKS) return false
  return !!(await inspect(Global.Path.home)).hooks?.[event]?.length
}

/** Claude Code user hooks as Kilo runs them, and what it skips, for settings UIs. */
export async function claude() {
  const result = await inspect(Global.Path.home)
  return {
    path: path.join(Global.Path.home, ".claude", "settings.json"),
    enabled: !Flag.KILO_DISABLE_CLAUDE_CODE_HOOKS,
    hooks: result.hooks,
    skipped: result.skipped,
  }
}

/** Reads the command hooks of Claude Code's user settings, skipping what Kilo cannot honor. */
export async function read(home: string): Promise<Hooks | undefined> {
  return (await inspect(home)).hooks
}

const inspected = new Map<string, { mtime: number; size: number; value: Inspection }>()

/**
 * The hooks Kilo runs from Claude Code's user settings and what it skips, with the reason. Cached
 * per file version, since every resolution of every event reads it.
 */
export async function inspect(home: string): Promise<Inspection> {
  const file = path.join(home, ".claude", "settings.json")
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile()) {
    inspected.delete(file)
    return { skipped: [] }
  }
  const hit = inspected.get(file)
  if (hit && hit.mtime === info.mtimeMs && hit.size === info.size) return hit.value
  const value = await parse(file)
  inspected.set(file, { mtime: info.mtimeMs, size: info.size, value })
  return value
}

function unsupported(name: string) {
  if ((IMPORTED as readonly string[]).includes(name)) return undefined
  if (name === "ConfigChange") return "Kilo config only"
  if ((CLAUDE_KNOWN as readonly string[]).includes(name)) return "not supported by Kilo"
  if (registered(name)) return "Kilo-only event"
  return "unknown event"
}

async function parse(file: string): Promise<Inspection> {
  const data: unknown = await Bun.file(file)
    .json()
    .catch((err: unknown) => {
      log.warn("invalid Claude Code settings", { path: file, err: errorMessage(err) })
      return undefined
    })
  if (!isRecord(data) || !isRecord(data.hooks)) return { skipped: [] }
  if (data.disableAllHooks === true) return { skipped: [] }
  const skipped: Skip[] = []
  const entries = Object.entries(data.hooks).flatMap(([name, value]): [Event, Group[]][] => {
    const why = unsupported(name)
    if (why || !registered(name)) {
      skipped.push({ event: name, reason: why ?? "unknown event" })
      return []
    }
    const event = name
    if (!Array.isArray(value)) return []
    const groups = value.flatMap((group): Group[] => {
      if (!isRecord(group) || !Array.isArray(group.hooks)) return []
      const hooks = group.hooks.flatMap((item): Handler[] => {
        const result = handler(item, event)
        if (!result) return []
        if ("reason" in result) {
          skipped.push(result)
          return []
        }
        return [result]
      })
      if (!hooks.length) return []
      // A matcher on an event without matcher support is ignored, so it is not shown either.
      const matcher = meta(event).matcher && typeof group.matcher === "string" ? { matcher: group.matcher } : {}
      return [{ ...matcher, hooks }]
    })
    return groups.length ? [[event, groups]] : []
  })
  const others = entries.map(([event]) => event).filter((event) => meta(event).group !== "tools")
  if (others.length) log.warn("running Claude Code hooks for these events too", { path: file, events: others })
  if (skipped.length) log.info("skipping Claude Code hooks Kilo does not run", { path: file, skipped })
  return { ...(entries.length ? { hooks: Object.fromEntries(entries) } : {}), skipped }
}

function handler(item: unknown, event: Event): Handler | Skip | undefined {
  if (!isRecord(item)) return undefined
  const command = typeof item.command === "string" ? item.command : undefined
  const skip = (reason: string): Skip => ({ event, ...(command === undefined ? {} : { command }), reason })
  if (item.type !== "command") return typeof item.type === "string" ? skip(`type ${item.type}`) : undefined
  if (command === undefined) return undefined
  if (item.asyncRewake !== undefined && item.asyncRewake !== false) return skip("asyncRewake")
  if (typeof item.if === "string" && !CONDITIONS.includes(event)) return skip("if on a non-tool event")
  if (item.shell !== undefined && (typeof item.shell !== "string" || !SHELLS.includes(item.shell)))
    return skip(`shell ${typeof item.shell === "string" ? item.shell : JSON.stringify(item.shell)}`)
  const args = Array.isArray(item.args) && item.args.every((arg) => typeof arg === "string") ? item.args : undefined
  if (item.args !== undefined && !args) return skip("invalid args")
  return {
    type: "command",
    command,
    ...(args ? { args } : {}),
    ...(typeof item.timeout === "number" ? { timeout: item.timeout } : {}),
    ...(item.onFailure === "block" || item.onFailure === "continue" ? { onFailure: item.onFailure } : {}),
    ...(item.async === true ? { async: true } : {}),
    ...(item.shell === "bash" || item.shell === "powershell" ? { shell: item.shell } : {}),
    ...(typeof item.if === "string" ? { if: item.if } : {}),
  }
}

/** Reads the hooks `SessionTools.resolve` put on a tool context's `extra`. */
export function from(value: unknown): Hooks | undefined {
  return isRecord(value) ? (value as Hooks) : undefined
}

/**
 * Claude Code matcher semantics: "*", "" or omitted match everything; a value made only of
 * letters, digits, "_", "-", spaces, "," and "|" is an exact name or list; anything else is an
 * unanchored regular expression. Strict events (StopFailure, FileChanged) only allow letters,
 * digits, "_" and "|" in an exact list.
 */
export function matches(matcher: string | undefined, names: readonly string[], strict = false): boolean {
  if (!matcher || matcher === "*") return true
  if ((strict ? /^[\w|]+$/ : /^[\w\s,|-]+$/).test(matcher)) {
    const list = matcher.split(strict ? /\|/ : /[|,]/).map((item) => item.trim())
    return names.some((name) => list.includes(name))
  }
  const pattern = regex(matcher)
  return !!pattern && names.some((name) => pattern.test(name))
}

/** The Claude Code name of an MCP tool (`mcp__<server>__<tool>`), which hook matchers can use. */
export function mcp(server: string, tool: string) {
  return `mcp__${McpCatalog.sanitize(server)}__${McpCatalog.sanitize(tool)}`
}

// Added next to the MCP tools by session/tools.ts, so not in the tool registry.
const RESOURCES = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]

/** Every name a hook matcher can use for these tool ids: the ids and their Claude Code names. */
export function known(ids: string[]) {
  return [...new Set([...ids, ...RESOURCES].flatMap((id) => [id, ...(ALIASES[id] ?? [])]))]
}

/** Names in exact-list tool matchers that none of `names` answers to: such hooks never run. */
export function unmatched(hooks: Hooks, names: string[]) {
  const set = new Set(names)
  return [
    ...new Set(
      TOOLS.flatMap((event) =>
        (hooks[event] ?? []).flatMap((group) => {
          const matcher = group.matcher?.trim()
          if (!matcher || matcher === "*" || !/^[\w\s,|-]+$/.test(matcher)) return []
          return matcher
            .split(/[|,]/)
            .map((item) => item.trim())
            .filter((name) => name && !set.has(name))
        }),
      ),
    ),
  ]
}

const warned = new Set<string>()

/** Logs once per name the matcher names no available tool answers to, since those hooks silently never run. */
export function warn(hooks: Hooks, names: string[]) {
  for (const name of unmatched(hooks, names)) {
    if (warned.has(name)) continue
    warned.add(name)
    log.warn("hook matcher names a tool that does not exist here, so the hook never runs", { name })
  }
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

const skips = new Set<string>()

/** Why Kilo does not run a handler on an event, if it does not. */
function unrunnable(handler: Handler, event: Event) {
  if (handler.type !== "command") return `type ${String(handler.type)}`
  if (handler.shell !== undefined && !SHELLS.includes(handler.shell)) return `shell ${handler.shell}`
  if (handler.if !== undefined && !CONDITIONS.includes(event)) return "if on a non-tool event"
  return undefined
}

/**
 * Handlers for an event and its matcher targets, deduplicated by command (a hook defined in two
 * config files runs once). Events without a matcher run every group; `if` conditions are checked
 * against the tool call.
 */
export function select(hooks: Hooks, event: Event, subjects: readonly string[], call?: Call): Handler[] {
  const info = meta(event)
  const seen = new Set<string>()
  return (hooks[event] ?? [])
    .filter((group) => !info.matcher || matches(group.matcher, subjects, info.strict === true))
    .flatMap((group) => group.hooks)
    .filter((handler) => {
      const why = unrunnable(handler, event)
      if (why) {
        const key = JSON.stringify([event, handler.command, why])
        if (!skips.has(key)) log.info("skipping hook", { event, command: handler.command, reason: why })
        skips.add(key)
        return false
      }
      if (handler.if !== undefined && !condition(handler.if, call)) return false
      const key = JSON.stringify([handler.command, handler.args ?? []])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/**
 * Evaluates a handler's `if` permission-rule condition (`Bash(rm *)`, `Edit(*.env)`) against a
 * tool call. Returns false only when the rule surely does not match: anything Kilo cannot evaluate
 * runs the hook, which is Claude Code's own fallback and the safe direction for guards.
 */
export function condition(rule: string, call?: Call): boolean {
  if (!call) return true
  const parsed = /^([\w-]+)(?:\(([\s\S]*)\))?$/.exec(rule.trim())
  if (!parsed) return true
  const tool = parsed[1] ?? ""
  if (!names(call).includes(tool)) return false
  const pattern = parsed[2]
  if (!pattern) return true
  const args = compat(call.tool, call.args, call.directory)
  if (call.tool === "bash") {
    const command = typeof args.command === "string" ? args.command : undefined
    if (command === undefined) return true
    // Only plain words joined by `&&`, `||`, `;`, `|` and `&` can be split safely. Anything else
    // (substitutions, quotes, escapes, variables, redirects, groups, subshells, tabs, newlines,
    // comments) is beyond a simple split: run the hook.
    if (/[^\w .\/:@%+,=~*\-|;&]/.test(command)) return true
    // The rule's spaces collapse the same way, so a rule written with a double space still matches.
    const glob = (pattern.endsWith(":*") ? pattern.slice(0, -2) + "*" : pattern).replace(/ +/g, " ")
    return (
      command
        .split(/[|;&]+/)
        // Leading `NAME=value` assignments are stripped, as Claude Code does. Runs of spaces collapse
        // to one, which is what the shell sees as the same words.
        .map((item) =>
          item
            .trim()
            .replace(/ +/g, " ")
            .replace(/^(?:\w+=\S*\s+)+/, ""),
        )
        .filter(Boolean)
        .some((item) => {
          const first = item.split(" ").at(0) ?? ""
          // A path (`/usr/bin/git`), a glob (`gi*`) or another letter case (`GIT`, on a case-insensitive
          // filesystem) can name the same program under another spelling.
          return (
            WRAPPERS.has(first) || /[\/*]/.test(first) || first !== first.toLowerCase() || Wildcard.match(item, glob)
          )
        })
    )
  }
  if (FILES.has(call.tool)) {
    const files = call.tool === "apply_patch" ? patched(call.args, call.directory) : []
    const list = files.length ? files : typeof args.file_path === "string" ? [args.file_path] : []
    if (!list.length) return true
    return list.some((file) => glob(pattern, file, call.directory))
  }
  if (call.tool === "webfetch" && pattern.startsWith("domain:")) {
    const host = attempt(() => new URL(String(args.url)).hostname)
    if (host instanceof Error) return true
    const domain = pattern.slice("domain:".length)
    return host === domain || host.endsWith("." + domain)
  }
  return true
}

function glob(pattern: string, file: string, cwd: string) {
  const target = file.replaceAll("\\", "/")
  if (!pattern.includes("/")) return new Bun.Glob(pattern).match(path.basename(target))
  const full = pattern.startsWith("//")
    ? pattern.slice(1)
    : pattern.startsWith("~/")
      ? path.join(os.homedir(), pattern.slice(2))
      : path.join(cwd, pattern)
  return new Bun.Glob(full.replaceAll("\\", "/")).match(target)
}

/**
 * Hook input sent on stdin for a tool event, using Claude Code's field names. `response` is the
 * `tool_response` (structured for some tools); `text` is the output the model sees.
 */
export function input(event: Event, call: Call, response?: unknown, text?: string): Input {
  return {
    ...KiloHookPayload.base(event, {
      sessionID: call.sessionID,
      root: call.root,
      parent: call.parent,
      cwd: call.directory,
      agent: call.agent,
      prompt: call.prompt,
      mode: call.mode,
    }),
    tool_name: ALIASES[call.tool]?.[0] ?? call.aliases?.[0] ?? call.tool,
    kilo_tool_name: call.tool,
    tool_input: compat(call.tool, call.args, call.directory),
    tool_use_id: call.callID,
    ...(call.server ? { mcp_server: { name: call.server } } : {}),
    ...(response === undefined ? {} : { tool_response: response }),
    ...(text === undefined ? {} : { kilo_tool_response: text }),
  }
}

/**
 * One input per hook run. An apply_patch call runs the hooks once per file in the patch, with
 * that file as `file_path`, so a guard on file paths sees every file the patch touches.
 */
export function inputs(event: Event, call: Call, response?: unknown, text?: string): Input[] {
  const value = input(event, call, response, text)
  const files = call.tool === "apply_patch" ? patched(call.args, call.directory) : []
  if (!files.length) return [value]
  return files.map((file) => ({ ...value, tool_input: { ...value.tool_input, file_path: file, file_paths: files } }))
}

/**
 * Claude Code's `tool_response` for a result: structured for bash (`{ stdout, stderr, interrupted }`)
 * and write/edit (`{ filePath, success }`), the output text for other tools.
 */
export function response(call: Call, result: { output: string; metadata?: unknown }) {
  const metadata = isRecord(result.metadata) ? result.metadata : {}
  if (call.tool === "bash") return { stdout: result.output, stderr: "", interrupted: metadata.interrupted === true }
  if (call.tool === "write" || call.tool === "edit") {
    const file = compat(call.tool, call.args, call.directory).file_path
    return { filePath: typeof file === "string" ? file : "", success: true }
  }
  return result.output
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

/** A handler's timeout in seconds: its own when valid, else the event's default (600 s for most). */
export function seconds(timeout: number | undefined, event?: Event) {
  if (timeout === undefined || !Number.isFinite(timeout) || timeout <= 0) return event ? EVENTS[event].timeout : 600
  return Math.min(timeout, MAX_TIMEOUT)
}

/**
 * Runs one command hook with the input on stdin. Shell form (`command` only) runs in bash (Git
 * Bash on Windows) when available, else the platform shell; `shell: "powershell"` runs PowerShell;
 * exec form (`command` plus `args`) spawns the program directly. On timeout or abort the whole
 * process tree is killed. Never throws: failures are reported in the outcome.
 */
export function run(
  handler: Handler,
  payload: unknown,
  opts: { cwd: string; abort?: AbortSignal; event?: Event; env?: Record<string, string>; timeout?: number },
) {
  const limit = opts.timeout ?? seconds(handler.timeout, opts.event)
  const fail = (error: string) => Promise.resolve<Outcome>({ stdout: "", stderr: "", error })
  if (opts.abort?.aborted) return fail("aborted")
  if (!handler.command.trim()) return fail("empty command")
  const input = attempt(() => JSON.stringify(payload))
  if (input instanceof Error) return fail(errorMessage(input))
  const child = attempt(() => spawn(handler, opts))
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
    // If the kill does not take effect, give up on the hook rather than hang the caller. The pid
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

/** Runs `fn`, returning the error it throws instead of throwing. */
export function attempt<T>(fn: () => T) {
  try {
    return fn()
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

/** Sets a key as the newest entry of a map kept in insertion order, evicting the oldest past `limit`. */
export function keep<T>(map: Map<string, T>, key: string, value: T, limit: number) {
  map.delete(key)
  map.set(key, value)
  if (map.size <= limit) return
  const oldest = map.keys().next()
  if (!oldest.done) map.delete(oldest.value)
}

const programs = new Map<string, string | undefined>()

function program(name: string, find: () => string | null | undefined) {
  if (!programs.has(name)) programs.set(name, find() ?? undefined)
  return programs.get(name)
}

function spawn(handler: Handler, opts: { cwd: string; event?: Event; env?: Record<string, string> }) {
  const env = modelEnv({
    KILO_PROJECT_DIR: opts.cwd,
    CLAUDE_PROJECT_DIR: opts.cwd,
    ...(opts.event ? { KILO_HOOK_EVENT: opts.event } : {}),
    KILO_HOOK_DEPTH: String(DEPTH + 1),
    // A hook that runs `kilo` must start its own backend: a daemon never sees KILO_HOOK_DEPTH.
    KILO_NO_DAEMON: "1",
    ...opts.env,
  }) // hooks must not inherit backend credentials
  // A Kilo started inside a Claude Code session must never append to that session's env file.
  delete env.CLAUDE_ENV_FILE
  const options: SpawnOptions = {
    cwd: opts.cwd,
    env,
    stdio: "pipe",
    windowsHide: true,
    detached: process.platform !== "win32", // own process group, so a timeout can kill the whole tree
  }
  // cross-spawn resolves programs the way a shell would (PATHEXT, shebangs on Windows).
  if (handler.args !== undefined) return launch(handler.command, handler.args, options)
  if (handler.shell === "powershell") {
    const shell = program("powershell", () => Bun.which("pwsh") ?? Bun.which("powershell")) ?? "powershell"
    return launch(shell, ["-NoProfile", "-Command", handler.command], options)
  }
  // Git Bash on Windows: a plain `bash` lookup can find WSL's bash.exe.
  const bash = program("bash", () => (process.platform === "win32" ? Shell.gitbash() : Bun.which("bash")))
  if (bash) return native(bash, ["-c", handler.command], options)
  // cross-spawn adds nothing to shell form and reports any exit code 1 there as ENOENT on Windows.
  return native(handler.command, { ...options, shell: true })
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

/** The hook's stdout as a JSON object, when the whole output is one (arrays and strings are plain text). */
function json(text: string): Record<string, unknown> | undefined {
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

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/** Shortens one hook output item to what the model or user is shown (10 000 characters by default). */
export function clip(value: string, limit = FEEDBACK) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n... (hook output truncated)`
}

/**
 * What one hook run decided, combining exit code and JSON output as Claude Code does: valid JSON
 * applies on every exit code; exit 2 blocks (where the event can block) and its JSON is still read
 * but cannot lift the block; any other exit code is a non-blocking failure whose JSON still applies.
 * `sent` is the `tool_input` the hook received, to detect PreToolUse input rewrites.
 */
export function decide(event: Event, outcome: Outcome, handler: Handler, sent?: unknown): Decision {
  const info = meta(event)
  const result: Decision = { context: [], user: [], specific: [] }
  // A hook that timed out, was aborted or could not start gives no decision, whatever it printed.
  const stdout = outcome.error ? "" : outcome.stdout.trim()
  const data = json(stdout)
  const bad = stdout.startsWith("{") && !data
  const missing =
    info.missing === true &&
    outcome.code === 2 &&
    !stdout &&
    /No such file or directory/i.test(outcome.stderr) &&
    !outcome.error
  const specific = isRecord(data?.hookSpecificOutput) ? data.hookSpecificOutput : undefined
  const verdict = isRecord(specific?.decision) ? specific.decision : undefined
  const denial =
    (data?.decision === "block" ? text(data.reason) : undefined) ??
    (specific?.permissionDecision === "deny" ? text(specific.permissionDecisionReason) : undefined) ??
    (verdict?.behavior === "deny" ? text(verdict.message) : undefined)

  if (outcome.code === 2 && !outcome.error && !missing) {
    const stderr = outcome.stderr.trim()
    if (info.exit2 === "block") result.block = denial ?? (stderr || "No reason given.")
    if (info.exit2 === "feedback" && stderr) result.context.push(clip(stderr))
    if (info.exit2 === "user" && stderr) result.user.push(clip(stderr))
    if (info.exit2 === "ignore") log.info("hook exit 2 is ignored on this event", { event, command: handler.command })
  }

  if (data && !missing) {
    if (data.continue === false) result.stop = typeof data.stopReason === "string" ? data.stopReason : ""
    if (data.decision === "block" && info.exit2 === "block") result.block ??= reason(data.reason)
    if (data.decision === "block" && info.exit2 === "feedback" && text(data.reason))
      result.context.push(clip(text(data.reason) ?? ""))
    // "allow", "defer" and the legacy top-level "approve" are ignored: hooks can only tighten permissions.
    if (specific?.permissionDecision === "deny" && info.exit2 === "block")
      result.block ??= reason(specific.permissionDecisionReason)
    if (specific?.permissionDecision === "ask" && event === "PreToolUse")
      result.ask = text(specific.permissionDecisionReason) ?? "A hook asked for confirmation."
    if (specific?.permissionDecision === "ask" && event === "PreModelSwitch")
      result.block ??= `ask is treated as a refusal: ${reason(specific.permissionDecisionReason)}`
    if (event === "PermissionRequest" && verdict?.behavior === "deny") {
      result.block ??= reason(verdict.message)
      if (verdict.interrupt === true || data.continue === false) result.interrupt = true
    }
    if (event === "PermissionRequest" && verdict?.behavior === "allow")
      log.info("PermissionRequest allow is ignored: hooks cannot approve permissions in Kilo", {
        command: handler.command,
      })
    if (
      event === "PreToolUse" &&
      specific &&
      "updatedInput" in specific &&
      !Bun.deepEquals(specific.updatedInput, sent)
    ) {
      log.warn("a PreToolUse hook rewrote the tool input; Kilo blocks the call instead", { command: handler.command })
      result.block ??=
        "A PreToolUse hook rewrote this call's input; Kilo does not apply input rewrites, so the call was blocked."
    }
    if (event === "PostToolUse") {
      const replaced = output(specific?.updatedToolOutput) ?? output(specific?.updatedMCPToolOutput)
      if (replaced !== undefined) result.output = replaced
    }
    if (info.context !== "none" && text(specific?.additionalContext))
      result.context.push(clip(text(specific?.additionalContext) ?? ""))
    if (specific) result.specific.push(specific)
    if (text(data.systemMessage)) result.user.push(clip(text(data.systemMessage) ?? ""))
  }

  if (!data && !bad && outcome.code === 0 && info.context === "stdout" && stdout) result.context.push(clip(stdout))

  const failed =
    outcome.error ??
    (missing
      ? "missing script"
      : bad
        ? "invalid JSON"
        : outcome.code !== 0 && outcome.code !== 2
          ? `exit code ${outcome.code}`
          : undefined)
  if (!failed) return result
  const line = outcome.stderr.trim().split("\n")[0]?.trim()
  result.failure = line ? `${failed}: ${line}` : failed
  if (handler.onFailure === "block" && info.failure && !handler.async) {
    result.block ??= bad
      ? "The hook printed invalid JSON and is set to block on failure."
      : `The hook failed (${failed}) and is set to block on failure.`
  }
  // A PreModelSwitch that times out blocks the switch, as in Claude Code.
  if (event === "PreModelSwitch" && outcome.error?.startsWith("timed out"))
    result.block ??= `The hook ${outcome.error} and a timed-out PreModelSwitch hook blocks the switch.`
  return result
}

function output(value: unknown) {
  if (typeof value === "string") return value
  if (!isRecord(value)) {
    if (value !== undefined) log.warn("ignoring updatedToolOutput with an unsupported shape")
    return undefined
  }
  const parts = [value.stdout, value.stderr].filter((item): item is string => typeof item === "string" && item !== "")
  if (typeof value.stdout !== "string" && typeof value.stderr !== "string") {
    log.warn("ignoring updatedToolOutput with an unsupported shape")
    return undefined
  }
  return parts.join("\n")
}

/** Why a PreToolUse outcome blocks the call, if it does. */
export function blocked(outcome: Outcome, handler?: Pick<Handler, "onFailure">): string | undefined {
  const result = decide("PreToolUse", outcome, { type: "command", command: "", ...handler })
  if (result.block) return result.block
  if (result.stop !== undefined) return reason(result.stop)
  return undefined
}

/** Feedback a PostToolUse outcome gives the model, if any. Plain stdout on exit 0 is not shown, as in Claude Code. */
export function feedback(outcome: Outcome): string | undefined {
  const result = decide("PostToolUse", outcome, { type: "command", command: "" })
  return result.context.length ? result.context.join("\n") : undefined
}

type Run = { handler: Handler; payload: Record<string, unknown>; outcome: Outcome }

function execute(
  input: { event: Event; cwd: string; env?: Record<string, string>; subjects?: readonly string[] },
  handler: Handler,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return Effect.promise(async (abort): Promise<Run> => {
    const start = Date.now()
    const outcome = await run(handler, payload, {
      cwd: input.cwd,
      env: input.env,
      event: input.event,
      timeout: seconds(handler.timeout, input.event),
      abort: signal ? AbortSignal.any([abort, signal]) : abort,
    })
    const info = {
      event: input.event,
      subjects: input.subjects?.slice(0, 4),
      command: handler.command,
      ms: Date.now() - start,
    }
    const result = { handler, payload, outcome }
    if (outcome.error) {
      log.warn("hook failed", { ...info, error: outcome.error })
      return result
    }
    if (outcome.code === 0 || outcome.code === 2) {
      log.info("hook finished", { ...info, code: outcome.code })
      return result
    }
    log.warn("hook exited with a non-blocking error", { ...info, code: outcome.code, stderr: outcome.stderr.trim() })
    return result
  })
}

const failed = new Map<string, number>()

/** True the first time a handler fails in a session, so the user hears about it once. */
function first(sessionID: string, handler: Handler) {
  const key = JSON.stringify([sessionID, handler.command, handler.args ?? []])
  if (failed.has(key)) return false
  if (failed.size > 1000) failed.clear()
  failed.set(key, Date.now())
  return true
}

function unique(items: readonly string[]) {
  return [...new Set(items)]
}

/**
 * Runs an event's hooks and aggregates their decisions. Without matching handlers it returns an
 * empty verdict without spawning anything, so callers can call it unconditionally. `async`
 * handlers are detached (output only logged); the others run with up to 8 at a time, each killed
 * when the calling fiber is interrupted or `signal` aborts. With a `budget` (ms), runs still going
 * when it expires are killed and ignored.
 */
export const fire = Effect.fn("KiloHooks.fire")(function* (input: {
  event: Event
  hooks: Hooks
  /** Matcher targets; ignored when the event has no matcher. */
  subjects?: readonly string[]
  /** Tool events: for `if` conditions. */
  call?: Call
  /** One run per payload per handler (apply_patch fan-out). */
  payloads: readonly Record<string, unknown>[]
  cwd: string
  /** Where `user` items are shown and first failures are tracked. */
  sessionID?: string
  /** Publishes notices; defaults to the EventV2Bridge in context, if any. */
  events?: EventV2.Interface
  env?: Record<string, string>
  signal?: AbortSignal
  budget?: number
}) {
  const empty: Verdict = { context: [], user: [], specific: [], ran: 0 }
  const handlers = select(input.hooks, input.event, input.subjects ?? [], input.call)
  if (!handlers.length) return empty
  if (!allowed(input.event)) {
    if (!skippedDepth.has(input.event)) log.warn("skipping hooks in a Kilo started by a hook", { event: input.event })
    skippedDepth.add(input.event)
    return empty
  }
  for (const handler of handlers.filter((item) => item.async)) {
    for (const payload of input.payloads) {
      yield* KiloHookLifecycle.detach(execute(input, handler, payload))
    }
  }
  const sync = handlers.filter((item) => !item.async)
  const runs = sync.flatMap((handler) => input.payloads.map((payload) => ({ handler, payload })))
  const results: (Run | undefined)[] = runs.map(() => undefined)
  const batch = Effect.forEach(
    runs,
    (item, index) =>
      execute(input, item.handler, item.payload, input.signal).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            results[index] = value
          }),
        ),
      ),
    { concurrency: CONCURRENCY, discard: true },
  )
  if (input.budget === undefined) yield* batch
  if (input.budget !== undefined) yield* batch.pipe(Effect.timeoutOption(Duration.millis(input.budget)))

  const decisions = results.flatMap((item) =>
    item
      ? [
          {
            item,
            result: decide(input.event, item.outcome, item.handler, item.payload.tool_input),
          },
        ]
      : [],
  )
  const blocks = unique(decisions.flatMap((entry) => (entry.result.block ? [entry.result.block] : [])))
  const stop = decisions.find((entry) => entry.result.stop !== undefined)?.result.stop
  const ask = decisions.find((entry) => entry.result.ask !== undefined)?.result.ask
  const output = decisions.findLast((entry) => entry.result.output !== undefined)?.result.output
  // A run killed because the caller was cancelled is not the hook's fault: not worth a notice.
  const failures = decisions.flatMap((entry) =>
    entry.result.failure &&
    entry.item.outcome.error !== "aborted" &&
    input.sessionID &&
    first(input.sessionID, entry.item.handler)
      ? [`${input.event} hook error: ${entry.item.handler.command}: ${entry.result.failure}`]
      : [],
  )
  const verdict: Verdict = {
    ...(blocks.length ? { block: clip(blocks.join("\n")) } : {}),
    ...(stop !== undefined ? { stop } : {}),
    ...(ask !== undefined ? { ask } : {}),
    ...(decisions.some((entry) => entry.result.interrupt) ? { interrupt: true } : {}),
    ...(output !== undefined ? { output } : {}),
    context: unique(decisions.flatMap((entry) => entry.result.context)),
    user: unique([...decisions.flatMap((entry) => entry.result.user), ...failures]),
    specific: decisions.flatMap((entry) => entry.result.specific),
    ran: sync.length,
  }
  if (!verdict.user.length) return verdict
  const events = input.events ?? Option.getOrUndefined(yield* Effect.serviceOption(EventV2Bridge.Service))
  if (!input.sessionID || !events) {
    log.info("hook messages for the user", { event: input.event, messages: verdict.user })
    return verdict
  }
  for (const message of verdict.user) yield* notice(events, input.sessionID as SessionID, message)
  return verdict
})

/** A hook rejected a prompt, command or model switch; the reason was already shown to the user. */
export class Blocked extends Error {
  readonly _tag = "KiloHookBlocked"
}

/** A PermissionRequest hook denied a tool call. */
export class Denied extends Error {
  readonly _tag = "KiloHookDenied"
}

/** True when the squashed cause is a `Blocked`. */
export function rejected(cause: Cause.Cause<unknown>) {
  return Cause.squash(cause) instanceof Blocked
}

/** Wraps hook context for the model, escaping anything that would close the tag early. */
export function wrap(event: Event, texts: readonly string[]) {
  const body = texts.map((item) => item.replaceAll("</hook_context", "&lt;/hook_context")).join("\n\n")
  return `<hook_context event="${event}">\n${body}\n</hook_context>`
}

const notices = new Map<string, number>()

/**
 * Shows a message about a hook to the user as a non-fatal session error (the admission error
 * row). The same text is shown at most once per session per minute.
 */
export const notice = Effect.fn("KiloHooks.notice")(function* (
  events: Pick<EventV2.Interface, "publish">,
  sessionID: SessionID,
  message: string,
) {
  const key = `${sessionID}\0${message}`
  const now = Date.now()
  const last = notices.get(key)
  if (last !== undefined && now - last < MINUTE) return
  if (notices.size > 1000) {
    for (const [item, time] of notices) if (now - time >= MINUTE) notices.delete(item)
  }
  notices.set(key, now)
  yield* events.publish(
    Session.Event.Error,
    { sessionID, error: new NamedError.Unknown({ message }).toObject() },
    { metadata: { phase: "admission" } },
  )
})

/** Runs PreToolUse hooks. Returns the message to fail the tool call with when a hook blocks it. */
export const before = (hooks: Hooks, call: Call) => KiloHookTool.before(hooks, call)

/** Runs PostToolUse hooks and applies their output and feedback to the tool result the model sees. */
export const after = (
  hooks: Hooks,
  call: Call,
  result: { output: string; metadata?: unknown; attachments?: unknown[] },
) => KiloHookTool.after(hooks, call, result)

export * as KiloHooks from "./hooks"
