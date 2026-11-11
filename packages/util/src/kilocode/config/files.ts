export * as KiloConfigFiles from "./files.js"

import path from "path"

// Kilo config file names and orders. Core discovery (through the Kilo host) and the CLI write commands both read
// them, and both packages depend on @opencode/util, so the names live here once. For reads, a later file wins.
//
// Internal v2 releases use `kilo2.json`, `kilo2.jsonc` and `.kilo2` (product decision, 2026-10-21), separate from
// v1's `kilo.json`, `kilo.jsonc` and `.kilo`. There is no implicit legacy fallback. Release migration to the
// `kilo` names is tracked in U-E3-03 and U-E8-02. The file contents use the v2 schema.
//
// The admin-managed system directory is the exception: it keeps the stable product names (`managedFiles`), because
// an administrator deploys it once and it must keep applying across internal renames (decision 2026-11, #15326).

/** Root files of the global directory and each project directory. `.jsonc` wins. */
export const names = ["kilo2.json", "kilo2.jsonc"]

/** Kilo v1 file order, using the internal v2 names inside `.kilo2`: `.json` wins. */
export const directoryFiles = ["kilo2.jsonc", "kilo2.json"]

/**
 * Files of the platform managed system directory (`systemDirectory`), the stable product names an administrator
 * deploys once. `.jsonc` is read first, so `.json` wins.
 */
export const managedFiles = ["kilo.jsonc", "kilo.json"]

/** Project config directories at one level. */
export const directories = [".kilo2"]

/** The file that the CLI write commands (`mcp add`, `plugin add`, `plugin remove`) create when none exists. */
export const newFile = "kilo2.json"

/**
 * Files the CLI write commands look for, in order; the first that exists is written. The order is the reverse of the
 * read order in each directory, so a write lands on the file the reader actually resolves. A project directory checks
 * `.kilo2` before its root files; inside `.kilo2` the later read file (`directoryFiles`: `.json` wins) comes first,
 * while in the root the later read file (`names`: `.jsonc` wins) comes first. The global directory checks only its
 * root files, like Kilo v1.
 */
export function writeCandidates(directory: string, global: boolean) {
  const root = names.toReversed()
  if (global) return root.map((name) => path.join(directory, name))
  const nested = directoryFiles.toReversed()
  return [
    ...directories.flatMap((parent) => nested.map((name) => path.join(directory, parent, name))),
    ...root.map((name) => path.join(directory, name)),
  ]
}
