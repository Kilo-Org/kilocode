// RegExp.escape is ES2025 and exists on current Electron, Chromium, and Bun
// builds. Older runtimes fall back to escaping the standard regex syntax
// characters. Keep this the single place that decides how to escape.
const nativeEscape = (RegExp as { escape?: (value: string) => string }).escape

/** Escape a string so it matches literally inside a RegExp source. */
export function escapeRegExp(value: string): string {
  if (typeof nativeEscape === "function") return nativeEscape(value)
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
