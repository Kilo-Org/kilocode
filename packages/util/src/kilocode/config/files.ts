export * as KiloConfigFiles from "./files.js"

import path from "path"

// Kilo config file names and orders. Core discovery (through the Kilo host) and the CLI write commands both read
// them, and both packages depend on @opencode/util, so the names live here once. For reads, a later file wins.
//
// Kilo v2 reads only Kilo names (product decision, 2026-10-20): `kilo.json`, `kilo.jsonc` and `.kilo`. v1 also read
// root `opencode.json` and `opencode.jsonc` (and let them win over `kilo.*`) and the legacy `.kilocode` directory;
// v2 does not read them, and the v1 migration moves them (plan U-E3-03). The file contents use the v2 schema.

/** Root files of the global directory, the system directory and each project directory. `.jsonc` wins. */
export const names = ["kilo.json", "kilo.jsonc"]

/** Kilo v1 `ALL_CONFIG_FILES` order inside `.kilo`, without `opencode.*`: `.json` wins. */
export const directoryFiles = ["kilo.jsonc", "kilo.json"]

/** Project config directories at one level. */
export const directories = [".kilo"]

/** The file that the CLI write commands (`mcp add`, `plugin add`, `plugin remove`) create when none exists. */
export const newFile = "kilo.json"

/**
 * Files the CLI write commands look for, in order; the first that exists is written. A project directory checks
 * `.kilo` before its root files, `.jsonc` before `.json`. The global directory checks only its root files, like
 * Kilo v1.
 */
export function writeCandidates(directory: string, global: boolean) {
  const files = names.toReversed()
  if (global) return files.map((name) => path.join(directory, name))
  return [...directories, "."].flatMap((parent) => files.map((name) => path.join(directory, parent, name)))
}
