export * as KiloConfigDiscovery from "./discovery.js"

import path from "path"
import { Effect } from "effect"
import type { FSUtil } from "@opencode/util/fs-util"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import type { Location } from "../../location.js"

// Kilo v1 config discovery, called from the marked lines in config/discovery.ts and config.ts. Kilo v1 reads
// config files in three different orders; the names and orders are in KiloConfigFiles. For reads, a later file
// in each list wins.

/** The global config directory, the system directory and the project root files of one directory. */
export const names = KiloConfigFiles.names // kilo_port(unattributed:config:546539fc1643)

/** The read order inside `.kilocode` and `.kilo`. */
export const configFiles = KiloConfigFiles.configFiles

/** Project config directories at one level; `.kilo` wins over `.kilocode`. */
export const directories = KiloConfigFiles.directories

/** Names that discovery resolves at each directory level of the upward walk, Kilo directories instead of `.opencode`. */
export const candidates = [".claude", ".agents", ...directories.toReversed(), ...names.toReversed()]

/**
 * The project root config files from the discovered items (nearest level first), farthest first. Kilo v1 reads
 * all project root `kilo.*` files before all `opencode.*` files, so any `opencode.*` file wins over any `kilo.*`
 * file at any depth.
 */
export function direct<T extends string>(visible: readonly T[]) {
  return byFamily(visible.filter((item) => ![".agents", ".claude", ...directories].includes(path.basename(item))).toReversed())
}

/** The project config directories from the discovered items (nearest level first), farthest first. */
export function projectDirectories<T extends string>(visible: readonly T[]) {
  return visible.filter((item) => directories.includes(path.basename(item))).toReversed()
}

/** Keeps the order inside each family and puts all `kilo.*` files before the other files. */
export function byFamily<T extends string>(files: readonly T[]) {
  const kilo = files.filter((file) => path.basename(file).startsWith("kilo."))
  return [...kilo, ...files.filter((file) => !kilo.includes(file))]
}

/**
 * Cuts an upward walk (nearest first) at the worktree root, as Kilo v1 does. Directories outside
 * version control keep the full walk to the filesystem root. Paths compare after symlink resolution
 * because the project directory is resolved and the location directory may not be.
 */
export const withinWorktree = (fs: FSUtil.Interface, location: Location.Interface) =>
  Effect.fnUntraced(function* (ancestors: readonly string[]) {
    if (!location.vcs) return ancestors
    const root = yield* fs.resolve(location.project.directory)
    const resolved = yield* Effect.forEach(ancestors, (directory) => fs.resolve(directory))
    const index = resolved.indexOf(root)
    return index === -1 ? ancestors : ancestors.slice(0, index + 1)
  })

/** The global config file that `Config.update` writes: the first existing file in Kilo v1 preference order, else `kilo.jsonc`. */
export const writeTarget = Effect.fnUntraced(function* (fs: FSUtil.Interface, directory: string) {
  // kilo_port(unattributed:config:8cdbdec70393)
  const candidates = configFiles.map((name) => path.join(directory, name))
  return (yield* Effect.filter(candidates, fs.isFile)).at(0) ?? path.join(directory, configFiles[0])
})
