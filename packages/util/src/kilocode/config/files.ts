export * as KiloConfigFiles from "./files.js"

import path from "path"

// Kilo v1 config file names and orders. Core discovery and the CLI write commands both read them, and both
// packages depend on @opencode/util, so the names live here once. For reads, a later file in each list wins.

/** The global config directory and the project root files of one directory. `.jsonc` wins over `.json`. */
export const names = ["kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc"]

/**
 * Kilo v1 `ALL_CONFIG_FILES`: the read order inside `.kilocode` and `.kilo`, where `.json` wins over `.jsonc`.
 * It is also the write preference, where the first file that exists is written.
 */
export const configFiles = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"]

/**
 * Project config directories at one level. `.kilocode` is the legacy name and `.kilo` wins.
 * Kilo v1 does not read `.opencode`, so it is not listed.
 */
export const directories = [".kilocode", ".kilo"]

/** The file that the CLI write commands (`mcp add`, `plugin add`, `plugin remove`) create when none exists. */
export const newFile = "kilo.json"

/**
 * Files the CLI write commands look for, in order; the first that exists is written. A project directory checks
 * `.kilo`, then `.kilocode`, then its root files. The global directory checks only its root files, like Kilo v1.
 */
export function writeCandidates(directory: string, global: boolean) {
  if (global) return configFiles.map((name) => path.join(directory, name))
  return [".kilo", ".kilocode", "."].flatMap((parent) => configFiles.map((name) => path.join(directory, parent, name)))
}
