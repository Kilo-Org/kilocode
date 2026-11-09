export * as KiloConfigDiscovery from "./discovery.js"

import { Effect } from "effect"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { sameDirectory } from "@opencode/util/path"
import path from "path"
import type { ConfigDiscovery } from "../../config/discovery.js"
import { AbsolutePath } from "../../schema.js"
import { KiloConfigPolicy } from "./policy.js"

export function systemDirectory(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env) {
  if (platform === "darwin") return AbsolutePath.make("/Library/Application Support/kilo")
  if (platform === "win32") return AbsolutePath.make(path.win32.join(env.ProgramData || "C:\\ProgramData", "kilo"))
  return AbsolutePath.make("/etc/kilo")
}

/**
 * Kilo config discovery as a value for the generic discovery layout (`ConfigDiscovery.Layout`). The Kilo host
 * replaces `ConfigDiscovery.node` with it (packages/kilo-cli/src/host.ts), so every server it starts reads
 * `kilo2.json`, `kilo2.jsonc` and `.kilo2` and stops the upward walk at the worktree root. A linked git worktree
 * also reads the primary checkout's config as a lower-priority fallback. The platform managed
 * system directory stays at the stable product path and reads the stable product names (`managedFiles`), so an
 * administrator's deployed policy keeps applying across internal releases. The global write target follows from
 * `names`: the last existing name, else `kilo2.jsonc`, preserving Kilo v1's file order with v2 names.
 */
export const layout: ConfigDiscovery.Layout = {
  names: KiloConfigFiles.names,
  directories: KiloConfigFiles.directories,
  directoryFiles: KiloConfigFiles.directoryFiles,
  systemFiles: KiloConfigFiles.managedFiles, // kilo_port(unattributed:config:73db79553730) managed .jsonc before .json
  systemDirectory,
  normalize: KiloConfigPolicy.normalize,
  commandDocuments: KiloConfigPolicy.commandDocuments,
  commandMetadata: true,
  parse: KiloConfigPolicy.parse,
  walk: (input) =>
    Effect.gen(function* () {
      // Cut the walk (nearest first) at the worktree root, as Kilo v1 does. Directories outside version control
      // keep the full walk to the filesystem root. Paths compare after symlink resolution because the project
      // directory is resolved and the location directory may not be.
      if (!input.location.vcs) return input.ancestors
      const root = yield* input.fs.resolve(input.location.project.directory)
      const resolved = yield* Effect.forEach(input.ancestors, (directory) => input.fs.resolve(directory))
      const index = resolved.indexOf(root)
      const local = index === -1 ? input.ancestors : input.ancestors.slice(0, index + 1)
      // A linked git worktree also reads the primary checkout as a lower-priority fallback. `project.canonical`
      // is the primary checkout that Project.resolve derives through Git; it equals the worktree root for an
      // ordinary checkout. Mirror the location's path relative to the worktree root into the primary checkout,
      // nearest first, so a nested package sees the primary config for the same package.
      if (input.location.vcs.type !== "git") return local
      const canonical = yield* input.fs.resolve(input.location.project.canonical)
      if (sameDirectory(canonical, root)) return local
      const relative = path.relative(root, yield* input.fs.resolve(input.location.directory))
      const parts =
        relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)
          ? relative.split(path.sep)
          : []
      return [
        ...local,
        ...Array.from({ length: parts.length + 1 }, (_, offset) =>
          path.join(canonical, ...parts.slice(0, parts.length - offset)),
        ),
      ]
    }),
}
