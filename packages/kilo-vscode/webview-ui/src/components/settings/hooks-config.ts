import type { Config, HookEvent, HookGroup, HookHandler, HooksConfig, Part } from "../../types/messages"

type Group = "tools" | "prompt" | "session" | "loop" | "compaction" | "environment" | "kilo"

type Matcher =
  | "tool"
  | "source"
  | "reason"
  | "trigger"
  | "agent"
  | "notification"
  | "model"
  | "config"
  | "file"
  | "error"
  | "load"
  | "command"
  | "status"
  | "kind"
  | "origin"

interface HookMeta {
  group: Group
  /** Absent: the event has no matcher and the CLI ignores the field. */
  matcher?: Matcher
  /** Exact-match matchers may only use letters, digits, "_" and "|". */
  strict?: true
  /** `onFailure: "block"` is honored. */
  failure: boolean
  /** A hook's answer changes what happens (it can block or add context), so running it in the background loses that. */
  decides: boolean
  /** Default timeout in seconds. */
  timeout: number
  /** A Kilo-only event name. */
  kilo: boolean
  help: string
}

/**
 * Every hook event the CLI runs, mirroring packages/core/src/kilocode/hooks-events.ts (a unit test
 * keeps them equal). The label is the raw event id, which is also the config key; only the help
 * line is translated.
 */
export const HOOK_INFO = {
  PreToolUse: {
    group: "tools",
    matcher: "tool",
    failure: true,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.PreToolUse.help",
  },
  PostToolUse: {
    group: "tools",
    matcher: "tool",
    failure: false,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.PostToolUse.help",
  },
  PostToolUseFailure: {
    group: "tools",
    matcher: "tool",
    failure: false,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.PostToolUseFailure.help",
  },
  PostToolBatch: {
    group: "tools",
    failure: true,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.PostToolBatch.help",
  },
  PermissionRequest: {
    group: "tools",
    matcher: "tool",
    failure: true,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.PermissionRequest.help",
  },
  TaskCreated: {
    group: "tools",
    failure: true,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.TaskCreated.help",
  },
  TaskCompleted: {
    group: "tools",
    failure: false,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.TaskCompleted.help",
  },
  UserPromptSubmit: {
    group: "prompt",
    failure: true,
    decides: true,
    timeout: 30,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.UserPromptSubmit.help",
  },
  UserPromptExpansion: {
    group: "prompt",
    matcher: "command",
    failure: true,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.UserPromptExpansion.help",
  },
  PreModelSwitch: {
    group: "prompt",
    matcher: "model",
    failure: true,
    decides: true,
    timeout: 30,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.PreModelSwitch.help",
  },
  PostModelSwitch: {
    group: "prompt",
    matcher: "model",
    failure: false,
    decides: true,
    timeout: 30,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.PostModelSwitch.help",
  },
  SessionStart: {
    group: "session",
    matcher: "source",
    failure: false,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.SessionStart.help",
  },
  SessionEnd: {
    group: "session",
    matcher: "reason",
    failure: false,
    decides: false,
    timeout: 1.5,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.SessionEnd.help",
  },
  InstructionsLoaded: {
    group: "session",
    matcher: "load",
    failure: false,
    decides: false,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.InstructionsLoaded.help",
  },
  Stop: {
    group: "loop",
    failure: false,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.Stop.help",
  },
  SubagentStop: {
    group: "loop",
    matcher: "agent",
    failure: false,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.SubagentStop.help",
  },
  SubagentStart: {
    group: "loop",
    matcher: "agent",
    failure: false,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.SubagentStart.help",
  },
  StopFailure: {
    group: "loop",
    matcher: "error",
    strict: true,
    failure: false,
    decides: false,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.StopFailure.help",
  },
  PreCompact: {
    group: "compaction",
    matcher: "trigger",
    failure: true,
    decides: true,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.PreCompact.help",
  },
  PostCompact: {
    group: "compaction",
    matcher: "trigger",
    failure: false,
    decides: false,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.PostCompact.help",
  },
  Notification: {
    group: "environment",
    matcher: "notification",
    failure: false,
    decides: false,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.Notification.help",
  },
  ConfigChange: {
    group: "environment",
    matcher: "config",
    failure: false,
    decides: false,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.ConfigChange.help",
  },
  FileChanged: {
    group: "environment",
    matcher: "file",
    strict: true,
    failure: false,
    decides: false,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.FileChanged.help",
  },
  CwdChanged: {
    group: "environment",
    failure: false,
    decides: false,
    timeout: 600,
    kilo: false,
    help: "settings.agentBehaviour.hooks.event.CwdChanged.help",
  },
  GoalReport: {
    group: "kilo",
    matcher: "status",
    failure: false,
    decides: true,
    timeout: 600,
    kilo: true,
    help: "settings.agentBehaviour.hooks.event.GoalReport.help",
  },
  WakeupFire: {
    group: "kilo",
    matcher: "kind",
    failure: true,
    decides: true,
    timeout: 60,
    kilo: true,
    help: "settings.agentBehaviour.hooks.event.WakeupFire.help",
  },
  WorktreeSetup: {
    group: "kilo",
    matcher: "origin",
    failure: true,
    decides: true,
    timeout: 300,
    kilo: true,
    help: "settings.agentBehaviour.hooks.event.WorktreeSetup.help",
  },
  WorktreeTeardown: {
    group: "kilo",
    failure: false,
    decides: false,
    timeout: 60,
    kilo: true,
    help: "settings.agentBehaviour.hooks.event.WorktreeTeardown.help",
  },
  CommitMessage: {
    group: "kilo",
    failure: true,
    decides: true,
    timeout: 30,
    kilo: true,
    help: "settings.agentBehaviour.hooks.event.CommitMessage.help",
  },
  BranchName: {
    group: "kilo",
    failure: true,
    decides: true,
    timeout: 10,
    kilo: true,
    help: "settings.agentBehaviour.hooks.event.BranchName.help",
  },
} as const satisfies Record<HookEvent, HookMeta>

/** The events the tab lists and edits, in registry order (grouped). */
export const HOOK_EVENTS = Object.keys(HOOK_INFO) as HookEvent[]

export const HOOK_GROUPS: readonly Group[] = ["tools", "prompt", "session", "loop", "compaction", "environment", "kilo"]

export const GROUP_LABELS = {
  tools: "settings.agentBehaviour.hooks.group.tools",
  prompt: "settings.agentBehaviour.hooks.group.prompt",
  session: "settings.agentBehaviour.hooks.group.session",
  loop: "settings.agentBehaviour.hooks.group.loop",
  compaction: "settings.agentBehaviour.hooks.group.compaction",
  environment: "settings.agentBehaviour.hooks.group.environment",
  kilo: "settings.agentBehaviour.hooks.group.kilo",
} as const satisfies Record<Group, string>

type MatcherMeta = { placeholder: string } & (
  | { help: string; field?: string }
  | { help: "settings.agentBehaviour.hooks.matcher.values"; field: string; values: string }
)

/**
 * Placeholder and help of the matcher field per matcher kind. Kinds with a fixed set of values use
 * the `values` template; tool, file, model and name kinds have their own help line.
 */
export const MATCHER_INFO = {
  tool: { placeholder: "edit|write", help: "settings.agentBehaviour.hooks.matcher.kind.tool" },
  source: {
    placeholder: "startup|resume",
    help: "settings.agentBehaviour.hooks.matcher.values",
    field: "source",
    values: "startup, resume, fork, compact",
  },
  reason: {
    placeholder: "other",
    help: "settings.agentBehaviour.hooks.matcher.values",
    field: "reason",
    values: "other, prompt_input_exit",
  },
  trigger: {
    placeholder: "auto",
    help: "settings.agentBehaviour.hooks.matcher.values",
    field: "trigger",
    values: "manual, auto",
  },
  agent: { placeholder: "explore", help: "settings.agentBehaviour.hooks.matcher.kind.name", field: "agent_type" },
  notification: {
    placeholder: "permission_prompt",
    help: "settings.agentBehaviour.hooks.matcher.values",
    field: "notification_type",
    values: "permission_prompt, agent_needs_input, idle_prompt",
  },
  model: { placeholder: "claude-sonnet-4-5", help: "settings.agentBehaviour.hooks.matcher.kind.model" },
  config: {
    placeholder: "user_settings",
    help: "settings.agentBehaviour.hooks.matcher.values",
    field: "source",
    values: "user_settings, project_settings",
  },
  file: { placeholder: ".envrc|.env", help: "settings.agentBehaviour.hooks.matcher.kind.file" },
  error: {
    placeholder: "rate_limit",
    help: "settings.agentBehaviour.hooks.matcher.values",
    field: "error",
    values:
      "rate_limit, overloaded, authentication_failed, billing_error, model_not_found, invalid_request, server_error, max_output_tokens, unknown",
  },
  load: {
    placeholder: "session_start",
    help: "settings.agentBehaviour.hooks.matcher.values",
    field: "load_reason",
    values: "session_start, nested_traversal, compact",
  },
  command: { placeholder: "review", help: "settings.agentBehaviour.hooks.matcher.kind.name", field: "command_name" },
  status: {
    placeholder: "complete",
    help: "settings.agentBehaviour.hooks.matcher.values",
    field: "reported_status",
    values: "complete, blocked",
  },
  kind: {
    placeholder: "cron",
    help: "settings.agentBehaviour.hooks.matcher.values",
    field: "kind",
    values: "once, cron",
  },
  origin: {
    placeholder: "create",
    help: "settings.agentBehaviour.hooks.matcher.values",
    field: "origin",
    values: "create, promote, import, multi_version, tool, continue, cli",
  },
} as const satisfies Record<Matcher, MatcherMeta>

/** The registry entry of `event`, widened so optional fields can be read on any event. */
export function meta(event: HookEvent): HookMeta {
  return HOOK_INFO[event]
}

/** The matcher kind of `event` with its placeholder and help, or undefined when the event has no matcher. */
export function matcher(event: HookEvent) {
  const kind = meta(event).matcher
  if (!kind) return undefined
  const info: MatcherMeta = MATCHER_INFO[kind]
  return { kind, ...info }
}

/** Default timeout of a hook for `event`, in seconds. */
export function timeout(event: HookEvent) {
  return meta(event).timeout
}

const MAX_TIMEOUT = 86_400

/** One handler of one matcher group: the unit the settings list shows and edits. */
export interface HookEntry {
  event: HookEvent
  group: number
  index: number
  matcher?: string
  handler: HookHandler
}

/**
 * Form state of the hook editor. `exec` runs the command without a shell, with one argument per
 * line; `async` runs the hook in the background.
 */
export interface HookDraft {
  event: HookEvent
  matcher: string
  command: string
  exec: boolean
  args: string
  timeout: string
  block: boolean
  async: boolean
}

export interface HookErrors {
  matcher?: string
  command?: string
  timeout?: string
}

export type MatcherKind =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "names"; names: string[] }
  | { kind: "files"; names: string[] }
  /** FileChanged without a matcher: watches nothing itself, runs for paths hooks add with `watchPaths`. */
  | { kind: "dynamic" }
  | { kind: "regex" }
  | { kind: "invalid" }

export function entries(hooks: HooksConfig | null | undefined, event: HookEvent): HookEntry[] {
  return (hooks?.[event] ?? []).flatMap((group, g) =>
    group.hooks.map((handler, index) => ({ event, group: g, index, matcher: group.matcher, handler })),
  )
}

/** The groups of HOOK_GROUPS that have hooks in `hooks`, each with its events that have hooks. */
export function sections(hooks: HooksConfig | null | undefined) {
  return HOOK_GROUPS.flatMap((group) => {
    const events = HOOK_EVENTS.filter((event) => meta(event).group === group && entries(hooks, event).length > 0)
    return events.length ? [{ group, events }] : []
  })
}

// Field order differs between the raw file and the decoded effective config, so compare by value.
function key(group: HookGroup) {
  return JSON.stringify([
    group.matcher ?? null,
    group.hooks.map((item) => [
      item.type,
      item.command,
      item.args ?? null,
      item.timeout ?? null,
      item.onFailure ?? null,
      item.shell ?? null,
      item.if ?? null,
      item.async ?? null,
    ]),
  ])
}

// The CLI substitutes {env:NAME} and {file:path} when it loads config, so the effective value of an
// own hook can differ from the raw file; such a token matches any text.
function like(raw: string | undefined, value: string | undefined) {
  if (raw === undefined || value === undefined) return raw === value
  const parts = raw.split(/\{(?:env|file):[^}]*\}/)
  if (parts.length === 1) return raw === value
  return new RegExp(`^${parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*")}$`).test(
    value,
  )
}

function handlerLike(raw: HookHandler, value: HookHandler) {
  return (
    raw.type === value.type &&
    raw.timeout === value.timeout &&
    raw.onFailure === value.onFailure &&
    raw.shell === value.shell &&
    raw.async === value.async &&
    like(raw.if, value.if) &&
    like(raw.command, value.command) &&
    (raw.args ?? []).length === (value.args ?? []).length &&
    (raw.args ?? []).every((arg, index) => like(arg, value.args?.[index])) &&
    (raw.args === undefined) === (value.args === undefined)
  )
}

function groupLike(raw: HookGroup, value: HookGroup) {
  return (
    like(raw.matcher, value.matcher) &&
    raw.hooks.length === value.hooks.length &&
    raw.hooks.every((item, index) => {
      const other = value.hooks.at(index)
      return !!other && handlerLike(item, other)
    })
  )
}

/** Groups that run from other trusted config (other global files, managed, organization), not from the editable file. */
export function inherited(effective: HooksConfig | null | undefined, own: HooksConfig | null | undefined): HooksConfig {
  return Object.fromEntries(
    HOOK_EVENTS.flatMap((event) => {
      const mine = own?.[event] ?? []
      const groups = (effective?.[event] ?? []).filter((group) => !mine.some((item) => groupLike(item, group)))
      return groups.length ? [[event, groups]] : []
    }),
  )
}

const split = (value: string, separator: RegExp) =>
  value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean)

/** Mirrors how the CLI reads a matcher for `event`. */
export function matcherKind(value: string | undefined, event: HookEvent): MatcherKind {
  const info = meta(event)
  if (!info.matcher) return { kind: "none" }
  const text = value?.trim()
  // FileChanged: every entry is a literal file name to watch, whatever its characters. Without one it
  // adds nothing to the watch list and only runs for paths that hooks add with `watchPaths`.
  if (info.matcher === "file") return text ? { kind: "files", names: split(text, /\|/) } : { kind: "dynamic" }
  if (!text || text === "*") return { kind: "all" }
  if (info.strict && /^[\w|]+$/.test(text)) return { kind: "names", names: split(text, /\|/) }
  if (!info.strict && /^[\w\s,|-]+$/.test(text)) return { kind: "names", names: split(text, /[|,]/) }
  try {
    new RegExp(text)
    return { kind: "regex" }
  } catch {
    return { kind: "invalid" }
  }
}

/** Names in an exact-list tool matcher that none of `tools` answers to: the hook never runs for them. */
export function unknown(value: string | undefined, tools: readonly string[] | undefined, event: HookEvent) {
  if (meta(event).matcher !== "tool") return []
  const kind = matcherKind(value, event)
  if (!tools || kind.kind !== "names") return []
  return kind.names.filter((name) => !tools.includes(name))
}

/** Whether the CLI honors this hook's `onFailure: "block"`: only on events that allow it, never in the background. */
export function blocking(entry: HookEntry) {
  return meta(entry.event).failure && !entry.handler.async && entry.handler.onFailure === "block"
}

export function draft(entry: HookEntry | undefined, event: HookEvent): HookDraft {
  if (!entry) return { event, matcher: "", command: "", exec: false, args: "", timeout: "", block: false, async: false }
  return {
    event: entry.event,
    matcher: entry.matcher ?? "",
    command: entry.handler.command,
    exec: entry.handler.args !== undefined,
    args: (entry.handler.args ?? []).join("\n"),
    timeout: entry.handler.timeout === undefined ? "" : String(entry.handler.timeout),
    block: entry.handler.onFailure === "block",
    async: entry.handler.async === true,
  }
}

export function validate(input: HookDraft): HookErrors {
  const errors: HookErrors = {}
  if (matcherKind(input.matcher, input.event).kind === "invalid")
    errors.matcher = "settings.agentBehaviour.hooks.matcher.invalid"
  if (!input.command.trim()) errors.command = "settings.agentBehaviour.hooks.command.required"
  const value = input.timeout.trim()
  if (value) {
    const seconds = Number(value)
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TIMEOUT) {
      errors.timeout = "settings.agentBehaviour.hooks.timeout.invalid"
    }
  }
  return errors
}

// `from` is the hook being edited: fields the editor does not show (shell, if) are kept, `if` only
// on tool events, where the CLI evaluates it (elsewhere it would make the CLI skip the hook).
function handler(input: HookDraft, from?: HookHandler): HookHandler {
  const seconds = input.timeout.trim()
  const info = meta(input.event)
  const block = input.block && info.failure && !input.async
  return {
    type: "command",
    command: input.command.trim(),
    ...(input.exec ? { args: input.args.split(/\r?\n/).filter((line) => line.length > 0) } : {}),
    ...(seconds ? { timeout: Number(seconds) } : {}),
    ...(block ? { onFailure: "block" as const } : {}),
    ...(!block && !input.async && from?.onFailure === "continue" ? { onFailure: "continue" as const } : {}),
    ...(from?.shell !== undefined ? { shell: from.shell } : {}),
    ...(from?.if !== undefined && info.matcher === "tool" ? { if: from.if } : {}),
    ...(input.async ? { async: true } : {}),
  }
}

function target(input: HookDraft) {
  return meta(input.event).matcher ? input.matcher.trim() || undefined : undefined
}

function group(input: HookDraft, from?: HookHandler): HookGroup {
  const value = target(input)
  return { ...(value ? { matcher: value } : {}), hooks: [handler(input, from)] }
}

// Every event the tab knows is copied, so a patch can tell which events changed.
function clone(hooks: HooksConfig | null | undefined): Record<HookEvent, HookGroup[]> {
  return Object.fromEntries(
    HOOK_EVENTS.map((event) => [event, (hooks?.[event] ?? []).map((item) => ({ ...item, hooks: [...item.hooks] }))]),
  ) as Record<HookEvent, HookGroup[]>
}

const same = (a: HookHandler, b: HookHandler) => key({ hooks: [a] }) === key({ hooks: [b] })

/**
 * Where `target` is now. Positions go stale when the hooks change under an open editor (Discard, a
 * reload), so they are only trusted if the hook there is still the same; otherwise it is searched.
 */
function locate(next: Record<HookEvent, HookGroup[]>, entry: HookEntry) {
  const fits = (item: HookGroup | undefined, index: number) =>
    !!item && item.matcher === entry.matcher && !!item.hooks[index] && same(item.hooks[index], entry.handler)
  if (fits(next[entry.event][entry.group], entry.index)) return { group: entry.group, index: entry.index }
  for (const [at, item] of next[entry.event].entries()) {
    const index = item.hooks.findIndex((hook) => same(hook, entry.handler))
    if (index >= 0 && fits(item, index)) return { group: at, index }
  }
  return undefined
}

function drop(next: Record<HookEvent, HookGroup[]>, event: HookEvent, at: { group: number; index: number }) {
  const groups = next[event]
  const item = groups.at(at.group)
  if (!item) return
  const hooks = item.hooks.filter((_, index) => index !== at.index)
  next[event] = hooks.length
    ? groups.map((entry, index) => (index === at.group ? { ...entry, hooks } : entry))
    : groups.filter((_, index) => index !== at.group)
}

/**
 * Adds a hook, or replaces `entry`, keeping the other hooks of its matcher group where they are.
 * An entry that no longer exists is added as a new hook.
 */
export function save(hooks: HooksConfig | null | undefined, entry: HookEntry | undefined, input: HookDraft) {
  const next = clone(hooks)
  const at = entry ? locate(next, entry) : undefined
  const item = entry && at ? next[entry.event][at.group] : undefined
  if (entry && at && item && entry.event === input.event && item.matcher === target(input)) {
    item.hooks[at.index] = handler(input, entry.handler)
    return next
  }
  if (entry && at && item && entry.event === input.event && item.hooks.length === 1) {
    next[entry.event][at.group] = group(input, entry.handler)
    return next
  }
  if (entry && at) drop(next, entry.event, at)
  next[input.event] = [...next[input.event], group(input, entry?.handler)]
  return next
}

/** Removes `entry`; does nothing if it no longer exists. */
export function remove(hooks: HooksConfig | null | undefined, entry: HookEntry) {
  const next = clone(hooks)
  const at = locate(next, entry)
  if (at) drop(next, entry.event, at)
  return next
}

/**
 * The global config patch for `next`. Only changed events are sent, each as its full array (config
 * merges replace arrays); an emptied event is unset with null. `hooks` itself is never nulled, so
 * later edits still merge per event.
 */
export function patch(before: HooksConfig | null | undefined, next: Record<HookEvent, HookGroup[]>): Partial<Config> {
  const changed = HOOK_EVENTS.filter(
    (event) => (before?.[event] ?? []).map(key).join() !== next[event].map(key).join(),
  ).map((event) => [event, next[event].length ? next[event] : null])
  return changed.length ? { hooks: Object.fromEntries(changed) } : {}
}

/**
 * The Claude Code hooks the CLI skipped, one item per event and reason: "Setup (not supported by
 * Kilo)", "PreToolUse ×2 (asyncRewake)".
 */
export function skipped(list: readonly { event: string; command?: string; reason: string }[] | undefined) {
  const counts = new Map<string, { event: string; reason: string; count: number }>()
  for (const item of list ?? []) {
    const id = JSON.stringify([item.event, item.reason])
    const hit = counts.get(id)
    if (hit) hit.count++
    if (!hit) counts.set(id, { event: item.event, reason: item.reason, count: 1 })
  }
  return [...counts.values()].map((item) =>
    item.count > 1 ? `${item.event} ×${item.count} (${item.reason})` : `${item.event} (${item.reason})`,
  )
}

// Hook parts the chat shows as notes: why a Stop hook made the agent continue, why an attachment is missing.
const NOTED = new Set(["Stop", "SubagentStop", "PreToolUse"])
// The text of a blocked-attachment part. A PreToolUse hook's context for an attachment is also a
// PreToolUse part, but it is for the model only.
const BLOCKED = "A PreToolUse hook blocked attaching "

/** Removes the `<hook_context event="E">` wrapper the CLI puts around hook output for the model. */
function unwrap(text: string) {
  const match = text.match(/^<hook_context event="[^"]*">\n([\s\S]*)\n<\/hook_context>$/)
  if (!match) return text
  return (match[1] ?? "").replaceAll("&lt;/hook_context", "</hook_context")
}

/**
 * Synthetic hook parts of a user message the chat shows as collapsed notes: Stop and SubagentStop
 * continuations and blocked attachments (`metadata.hook.event`). Every other hook part stays hidden.
 */
export function notes(parts: readonly Part[]) {
  return parts.flatMap((part) => {
    if (part.type !== "text" || !part.synthetic) return []
    const hook = (part.metadata as { hook?: { event?: unknown } } | undefined)?.hook
    const event = hook?.event
    if (typeof event !== "string" || !NOTED.has(event)) return []
    const text = part.text.trim()
    if (event === "PreToolUse" && !text.startsWith(BLOCKED)) return []
    return [{ id: part.id, event, text: unwrap(text) }]
  })
}
