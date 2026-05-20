/**
 * sanitize.ts — Sanitize strings for use as file/directory names
 * Zero deps. Pure regex.
 */

export function path(s: string): string {
  return s.replace(/[<>:"|?*]/g, "_").replace(/[/\\]+/g, "_")
}

export function nullBytes(s: string): string {
  return s.replace(/\0/g, "")
}
