import {
  CLAUDE_KNOWN,
  EVENTS,
  IMPORTED,
  IMPORTED_EVENTS,
  type Event,
  type Group,
  type Imported,
  type Matcher,
  type Meta,
} from "@opencode-ai/core/kilocode/hooks-events"

export { CLAUDE_KNOWN, EVENTS, IMPORTED, IMPORTED_EVENTS }
export type { Event, Group, Imported, Matcher, Meta }

/** Every event, in registry order. */
export const ALL = Object.keys(EVENTS) as Event[]

/** Events whose matcher is a tool name. */
export const TOOLS = ALL.filter((event) => meta(event).matcher === "tool")

/** Events where a handler's `if` condition is evaluated; on any other event such a handler never runs. */
export const CONDITIONS: readonly Event[] = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"]

/** Events a Kilo process started by a hook (KILO_HOOK_DEPTH 1-2) still runs: the tool guards. */
export const GUARDS: readonly Event[] = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "TaskCreated",
  "TaskCompleted",
]

export function meta(event: Event): Meta {
  return EVENTS[event]
}

export function known(name: string): name is Event {
  return Object.hasOwn(EVENTS, name)
}

export * as KiloHookEvents from "./events"
