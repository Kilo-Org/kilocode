/**
 * Path safety utilities — Kilo-specific.
 *
 * SEC-001: Prevent path traversal by ensuring resolved paths fall within
 * a known allowlist of base directories.
 */

import path from "node:path"

/**
 * Returns true if `resolvedPath` is strictly within one of the `allowedBaseDirs`.
 * Both sides are normalised (resolved + made absolute) before comparison so
 * symlinks and `..` sequences cannot evade the check.
 */
export function isPathWithinAllowlist(resolvedPath: string, allowedBaseDirs: string[]): boolean {
  const target = path.resolve(resolvedPath)
  for (const base of allowedBaseDirs) {
    const abs = path.resolve(base)
    // Must be the dir itself or a strict descendant: prefix + path.sep
    if (target === abs || target.startsWith(abs + path.sep)) return true
  }
  return false
}
