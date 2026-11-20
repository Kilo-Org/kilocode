export * as KiloConfigFiles from "./files.js"

import path from "path"

// Kilo config file names and orders. Core discovery (through the Kilo host) and the CLI write commands both read
// them, and both packages depend on @opencode/util, so the names live here once. For reads, a later file wins.
//
/** Root files of the global directory and each project directory. `.jsonc` wins. */
export const names = ["kilo.json", "kilo.jsonc"]

/** Kilo v1 file order inside the project directory: `.json` wins. */
export const directoryFiles = ["kilo.jsonc", "kilo.json"]

/**
 * Files of the platform managed system directory (`systemDirectory`), the stable product names an administrator
 * deploys once. `.jsonc` is read first, so `.json` wins.
 */
export const managedFiles = ["kilo.jsonc", "kilo.json"]

/** Project config directories at one level. */
export const directories = [".kilo"]

/** The file that the CLI write commands (`mcp add`, `plugin add`, `plugin remove`) create when none exists. */
export const newFile = "kilo.json"

/**
 * Files the CLI write commands look for, in order; the first that exists is written. The order is the reverse of the
 * read order in each directory, so a write lands on the file the reader actually resolves. A project directory checks
 * its config directory (`directories`) before its root files; inside it the later read file (`directoryFiles`: `.json`
 * wins) comes first, while in the root the later read file (`names`: `.jsonc` wins) comes first. The global directory
 * checks only its root files, like Kilo v1.
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
