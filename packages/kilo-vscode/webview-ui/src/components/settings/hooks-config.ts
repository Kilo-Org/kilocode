import type { Config, HookEvent, HookGroup, HookHandler, HooksConfig } from "../../types/messages"

export const HOOK_EVENTS: HookEvent[] = ["PreToolUse", "PostToolUse"]

export const EVENT_LABELS = {
  PreToolUse: { label: "settings.agentBehaviour.hooks.pre", help: "settings.agentBehaviour.hooks.pre.help" },
  PostToolUse: { label: "settings.agentBehaviour.hooks.post", help: "settings.agentBehaviour.hooks.post.help" },
} as const satisfies Record<HookEvent, { label: string; help: string }>

/** Defaults and limits of the CLI hook runner (packages/opencode/src/kilocode/hooks/hooks.ts). */
export const HOOK_TIMEOUT = 60
const MAX_TIMEOUT = 86_400

/** One handler of one matcher group: the unit the settings list shows and edits. */
export interface HookEntry {
  event: HookEvent
  group: number
  index: number
  matcher?: string
  handler: HookHandler
}

/** Form state of the hook editor. `exec` runs the command without a shell, with one argument per line. */
export interface HookDraft {
  event: HookEvent
  matcher: string
  command: string
  exec: boolean
  args: string
  timeout: string
  block: boolean
}

export interface HookErrors {
  matcher?: string
  command?: string
  timeout?: string
}

export type MatcherKind = { kind: "all" } | { kind: "names"; names: string[] } | { kind: "regex" } | { kind: "invalid" }

export function entries(hooks: HooksConfig | null | undefined, event: HookEvent): HookEntry[] {
  return (hooks?.[event] ?? []).flatMap((group, g) =>
    group.hooks.map((handler, index) => ({ event, group: g, index, matcher: group.matcher, handler })),
  )
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
    ]),
  ])
}

/** Groups that run from other trusted config (other global files, managed, organization), not from the editable file. */
export function inherited(effective: HooksConfig | null | undefined, own: HooksConfig | null | undefined): HooksConfig {
  return Object.fromEntries(
    HOOK_EVENTS.flatMap((event) => {
      const mine = new Set((own?.[event] ?? []).map(key))
      const groups = (effective?.[event] ?? []).filter((group) => !mine.has(key(group)))
      return groups.length ? [[event, groups]] : []
    }),
  )
}

/** Mirrors how the CLI reads a matcher. */
export function matcherKind(value: string | undefined): MatcherKind {
  const matcher = value?.trim()
  if (!matcher || matcher === "*") return { kind: "all" }
  if (/^[\w\s,|-]+$/.test(matcher)) {
    return {
      kind: "names",
      names: matcher
        .split(/[|,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    }
  }
  try {
    new RegExp(matcher)
    return { kind: "regex" }
  } catch {
    return { kind: "invalid" }
  }
}

export function draft(entry: HookEntry | undefined, event: HookEvent): HookDraft {
  if (!entry) return { event, matcher: "", command: "", exec: false, args: "", timeout: "", block: false }
  return {
    event: entry.event,
    matcher: entry.matcher ?? "",
    command: entry.handler.command,
    exec: entry.handler.args !== undefined,
    args: (entry.handler.args ?? []).join("\n"),
    timeout: entry.handler.timeout === undefined ? "" : String(entry.handler.timeout),
    block: entry.handler.onFailure === "block",
  }
}

export function validate(input: HookDraft): HookErrors {
  const errors: HookErrors = {}
  if (matcherKind(input.matcher).kind === "invalid") errors.matcher = "settings.agentBehaviour.hooks.matcher.invalid"
  if (!input.command.trim()) errors.command = "settings.agentBehaviour.hooks.command.required"
  const timeout = input.timeout.trim()
  if (timeout) {
    const value = Number(timeout)
    if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT) {
      errors.timeout = "settings.agentBehaviour.hooks.timeout.invalid"
    }
  }
  return errors
}

function handler(input: HookDraft): HookHandler {
  const timeout = input.timeout.trim()
  return {
    type: "command",
    command: input.command.trim(),
    ...(input.exec ? { args: input.args.split(/\r?\n/).filter((line) => line.length > 0) } : {}),
    ...(timeout ? { timeout: Number(timeout) } : {}),
    ...(input.block && input.event === "PreToolUse" ? { onFailure: "block" as const } : {}),
  }
}

function group(input: HookDraft): HookGroup {
  const matcher = input.matcher.trim()
  return { ...(matcher ? { matcher } : {}), hooks: [handler(input)] }
}

function clone(hooks: HooksConfig | null | undefined): Record<HookEvent, HookGroup[]> {
  return {
    PreToolUse: (hooks?.PreToolUse ?? []).map((item) => ({ ...item, hooks: [...item.hooks] })),
    PostToolUse: (hooks?.PostToolUse ?? []).map((item) => ({ ...item, hooks: [...item.hooks] })),
  }
}

function drop(next: Record<HookEvent, HookGroup[]>, target: HookEntry) {
  const groups = next[target.event]
  const item = groups[target.group]
  if (!item) return
  const hooks = item.hooks.filter((_, index) => index !== target.index)
  next[target.event] = hooks.length
    ? groups.map((entry, index) => (index === target.group ? { ...entry, hooks } : entry))
    : groups.filter((_, index) => index !== target.group)
}

/** Adds a hook, or replaces `target`, keeping the other hooks of its matcher group where they are. */
export function save(hooks: HooksConfig | null | undefined, target: HookEntry | undefined, input: HookDraft) {
  const next = clone(hooks)
  const item = target ? next[target.event][target.group] : undefined
  const matcher = input.matcher.trim() || undefined
  if (target && item && target.event === input.event && item.matcher === matcher) {
    item.hooks[target.index] = handler(input)
    return next
  }
  if (target && item && target.event === input.event && item.hooks.length === 1) {
    next[target.event][target.group] = group(input)
    return next
  }
  if (target) drop(next, target)
  next[input.event] = [...next[input.event], group(input)]
  return next
}

export function remove(hooks: HooksConfig | null | undefined, target: HookEntry) {
  const next = clone(hooks)
  drop(next, target)
  return next
}

/**
 * The global config patch for `next`. Only changed events are sent, each as its full array (config
 * merges replace arrays); an emptied event is unset with null. `hooks` itself is never nulled, so
 * later edits still merge per event.
 */
export function patch(before: HooksConfig | null | undefined, next: Record<HookEvent, HookGroup[]>): Partial<Config> {
  const changed = HOOK_EVENTS.filter(
    (event) => JSON.stringify(before?.[event] ?? []) !== JSON.stringify(next[event]),
  ).map((event) => [event, next[event].length ? next[event] : null])
  return changed.length ? { hooks: Object.fromEntries(changed) } : {}
}
