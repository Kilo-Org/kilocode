/**
 * The one list of Kilo-owned paths on the v2 line.
 *
 * A Kilo-owned path needs no `kilocode_change` markers and is not counted as a shared upstream patch.
 * The merge tooling keeps Kilo's version of these paths, the annotation check skips them, and the
 * shared-patch counter does not count them. Every other path is shared with upstream.
 *
 * A path that also exists in the pinned upstream release is shared, even when it matches a pattern
 * here. This keeps a broad pattern such as `script/check-*.ts` safe when upstream adds a file with
 * the same name.
 */

import { match } from "./match"

export const owned = [
  "packages/kilo-*/**",
  // `**` so nested workspace packages (for example packages/console/app) are covered too.
  "packages/**/src/kilocode/**",
  "packages/**/test/kilocode/**",
  ".kilo/**",
  "migration-tracking/**",
  "script/upstream/**",
  "script/check-*.ts",
  "script/dev-isolated.ts",
  // Kilo CI tooling, for example the sharded test runner (script/kilocode/test/).
  "script/kilocode/**",
  ".github/workflows/kilo-v2.yml",
  // Review policy for the Kilo review bot. Upstream has no REVIEW.md.
  "REVIEW.md",
]

/**
 * Generated shared files. They follow from other files (bun.lock follows the package.json files),
 * so they carry no decision of their own: the checks list them but need no markers and count no
 * lines. A new Kilo package (for example the first packages/kilo-* plugin) changes bun.lock.
 */
export const generated = ["bun.lock", "**/bun.lock"]

export function isGenerated(file: string) {
  return generated.some((pattern) => match(file.replaceAll("\\", "/"), pattern))
}

export function isKiloOwned(file: string, upstream?: Set<string>) {
  const path = file.replaceAll("\\", "/")
  if (upstream?.has(path)) return false
  return owned.some((pattern) => match(path, pattern))
}

/** Directory prefixes of the owned patterns, for git commands that take directories. */
export function ownedDirectories() {
  return owned.filter((pattern) => pattern.endsWith("/**")).map((pattern) => pattern.slice(0, -3))
}
