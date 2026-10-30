export * as KiloConfigDiscovery from "./discovery.js"

import { Effect } from "effect"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
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
 * `kilo2.json`, `kilo2.jsonc` and `.kilo2` and stops the upward walk at the worktree root. The global write target
 * follows from `names`: the last existing name, else `kilo2.jsonc`, preserving Kilo v1's file order with v2 names.
 */
export const layout: ConfigDiscovery.Layout = {
  names: KiloConfigFiles.names,
  directories: KiloConfigFiles.directories,
  directoryFiles: KiloConfigFiles.directoryFiles,
  systemFiles: KiloConfigFiles.directoryFiles, // kilo_port(unattributed:config:73db79553730) managed .jsonc before .json
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
      return index === -1 ? input.ancestors : input.ancestors.slice(0, index + 1)
    }),
}
