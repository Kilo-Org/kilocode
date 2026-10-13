export * as ConfigDiscovery from "./discovery.js"

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "../location.js"
import { AbsolutePath } from "../schema.js"
import type { Options } from "../config.js"
import { KiloConfigDiscovery } from "../kilocode/config/discovery.js" // kilocode_change

// kilocode_change start - Kilo v1 file names (opencode.* wins over kilo.*), and .kilocode and .kilo instead of .opencode
export const names = KiloConfigDiscovery.names
const directoryNames = KiloConfigDiscovery.directories
const candidates = [".claude", ".agents", ...directoryNames.toReversed(), ...names.toReversed()]
// kilocode_change end

/** Eligible sources in priority order, including paths that may appear later. */
export interface Sources {
  readonly global?: AbsolutePath
  readonly explicit?: AbsolutePath
  readonly direct: readonly AbsolutePath[]
  readonly project: readonly { readonly path: AbsolutePath; readonly present: boolean }[]
  readonly claude: readonly AbsolutePath[]
  readonly agents: readonly AbsolutePath[]
}

export const discover = Effect.fn("ConfigDiscovery.discover")(function* (options?: Options) {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const location = yield* Location.Service
  const globalDirectory = AbsolutePath.make(global.config)
  const globalAgentsDirectory = AbsolutePath.make(path.join(global.home, ".agents"))
  const globalClaudeDirectory = AbsolutePath.make(path.join(global.home, ".claude"))
  const globalRoots = yield* Effect.forEach([globalDirectory, globalClaudeDirectory, globalAgentsDirectory], (item) =>
    fs.resolve(item),
  )
  const directories =
    (yield* fs.resolve(location.directory)) === globalRoots[0] || options?.project === false
      ? []
      : yield* fs.up({ targets: ["."], start: location.directory }).pipe(
          // kilocode_change - stop the walk at the worktree root, like Kilo v1
          Effect.flatMap((ancestors) => KiloConfigDiscovery.withinWorktree(fs, location, ancestors)),
          Effect.orDie,
        )
  const discovered = yield* Effect.forEach(directories, (directory) =>
    Effect.gen(function* () {
      // Resolve the parent too: missing children must honor symlinked global roots.
      const parent = yield* fs.resolve(directory)
      // kilocode_change - candidates include the Kilo project directories
      return yield* Effect.forEach(candidates, (name) =>
        fs
          .resolve(path.join(parent, name))
          .pipe(Effect.map((resolved) => ({ item: AbsolutePath.make(path.join(directory, name)), resolved }))),
      )
    }),
  ).pipe(
    Effect.map((items) => items.flat()),
    Effect.orDie,
  )

  const globalEnabled = options?.global !== false
  const globalFiles = yield* Effect.forEach(names, (name) => fs.resolve(path.join(globalDirectory, name)))
  // Global sources must not re-enter through the project walk.
  const visible = discovered
    .filter(({ resolved }) =>
      globalEnabled
        ? !globalRoots.includes(resolved) && !globalFiles.includes(resolved)
        : !globalRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep)),
    )
    .map(({ item }) => item)

  return {
    global: globalEnabled ? globalDirectory : undefined,
    explicit: options?.file ? AbsolutePath.make(path.resolve(options.file)) : undefined,
    // kilocode_change - Kilo project directories replace .opencode; opencode.* wins over kilo.* at any depth, like Kilo v1
    direct: KiloConfigDiscovery.byFamily(
      visible.filter((item) => ![".agents", ".claude", ...directoryNames].includes(path.basename(item))).toReversed(),
    ),
    project: yield* Effect.forEach(
      // kilocode_change - Kilo project directories replace .opencode
      visible.filter((item) => directoryNames.includes(path.basename(item))).toReversed(),
      (directory) => fs.isDir(directory).pipe(Effect.map((present) => ({ path: directory, present }))),
    ),
    claude: [
      ...new Set([
        ...(globalEnabled ? [globalClaudeDirectory] : []),
        ...visible.filter((item) => path.basename(item) === ".claude").toReversed(),
      ]),
    ],
    agents: [
      ...new Set([
        ...(globalEnabled ? [globalAgentsDirectory] : []),
        ...visible.filter((item) => path.basename(item) === ".agents").toReversed(),
      ]),
    ],
  } satisfies Sources
})
