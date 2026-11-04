import { inspect } from "util"

/**
 * Render log arguments so failures stay diagnosable.
 *
 * `JSON.stringify(new Error("boom"))` is `"{}"` — every own property of an Error is non-enumerable.
 * That is how `Agent Manager request recovery failed: {}` reached a user-visible log with no
 * message, no type, and no stack.
 */
export function formatLog(args: unknown[]): string {
  return args.map(render).join(" ")
}

function render(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  return inspect(value, { breakLength: Infinity, depth: 4 })
}
