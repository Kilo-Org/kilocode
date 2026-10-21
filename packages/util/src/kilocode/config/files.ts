export * as KiloConfigFiles from "./files.js"

import path from "path"

// Kilo config file names and orders. Core discovery (through the Kilo host) and the CLI write commands both read
// them, and both packages depend on @opencode/util, so the names live here once. For reads, a later file wins.
//
// Internal v2 releases use `kilo2.json`, `kilo2.jsonc` and `.kilo2` (product decision, 2026-10-21), separate from
// v1's `kilo.json`, `kilo.jsonc` and `.kilo`. There is no implicit legacy fallback. Release migration to the
// `kilo` names is tracked in U-E3-03 and U-E8-02. The file contents use the v2 schema.

/** Root files of the global directory, the system directory and each project directory. `.jsonc` wins. */
export const names = ["kilo2.json", "kilo2.jsonc"]

/** Kilo v1 file order, using the internal v2 names inside `.kilo2`: `.json` wins. */
export const directoryFiles = ["kilo2.jsonc", "kilo2.json"]

/** Project config directories at one level. */
export const directories = [".kilo2"]

/** The file that the CLI write commands (`mcp add`, `plugin add`, `plugin remove`) create when none exists. */
export const newFile = "kilo2.json"

/**
 * Files the CLI write commands look for, in order; the first that exists is written. A project directory checks
 * `.kilo2` before its root files, `.jsonc` before `.json`. The global directory checks only its root files, like
 * Kilo v1.
 */
export function writeCandidates(directory: string, global: boolean) {
  const files = names.toReversed()
  if (global) return files.map((name) => path.join(directory, name))
  return [...directories, "."].flatMap((parent) => files.map((name) => path.join(directory, parent, name)))
}
