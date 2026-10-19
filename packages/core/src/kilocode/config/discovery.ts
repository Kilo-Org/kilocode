export * as KiloConfigDiscovery from "./discovery.js"

import path from "path"
import { Effect } from "effect"
import type { FSUtil } from "@opencode/util/fs-util"
import type { Location } from "../../location.js"

// Kilo v1 reads config files in three different orders. For reads, a later file in each list wins.

/** The global config directory and the project root files of one directory. `.jsonc` wins over `.json`. */
export const names = ["kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc"]

/**
 * Kilo v1 `ALL_CONFIG_FILES`: the read order inside `.kilocode` and `.kilo`, where `.json` wins over `.jsonc`.
 * It is also the write preference in the global config directory, where the first file that exists is written.
 */
export const configFiles = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"]

/**
 * Project config directories at one level. `.kilocode` is the legacy name and `.kilo` wins.
 * Kilo v1 does not read `.opencode`, so it is not listed.
 */
export const directories = [".kilocode", ".kilo"]

/**
 * Kilo v1 reads all project root `kilo.*` files before all `opencode.*` files, so any `opencode.*` file
 * wins over any `kilo.*` file at any depth. The input is in priority order; the order in each family is kept.
 */
export function byFamily<T extends string>(files: readonly T[]) {
  const kilo = files.filter((file) => path.basename(file).startsWith("kilo."))
  return [...kilo, ...files.filter((file) => !kilo.includes(file))]
}

/**
 * Cuts an upward walk (nearest first) at the worktree root, as Kilo v1 does. Directories outside
 * version control keep the full walk to the filesystem root. Paths compare after symlink resolution
 * because the project directory is resolved and the location directory may not be.
 */
export const withinWorktree = Effect.fnUntraced(function* (
  fs: FSUtil.Interface,
  location: Location.Interface,
  ancestors: readonly string[],
) {
  if (!location.vcs) return ancestors
  const root = yield* fs.resolve(location.project.directory)
  const resolved = yield* Effect.forEach(ancestors, (directory) => fs.resolve(directory))
  const index = resolved.indexOf(root)
  return index === -1 ? ancestors : ancestors.slice(0, index + 1)
})
