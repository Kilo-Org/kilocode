import path from "node:path"
import { createHash } from "node:crypto"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ConfigPaths } from "@/config/paths"
import { Git } from "@/git"
import { primaryPaths } from "@/kilocode/primary-worktree"
import { KilocodeConfig } from "./config"

/**
 * Read-only freshness for the sources that contribute a project's effective config.
 *
 * The merged config is cached per instance, so a direct edit to one of these files (by an editor or
 * another tool) would not be observed until some other invalidation happened. We read a digest of
 * the loader's contributing sources at the config-protection decision boundary and let the caller
 * invalidate the Config cache when it changed. The digest is caller-owned (stored on the caller's
 * instance state), so one instance never consumes an invalidation meant for another, and no config
 * text is retained. Global config freshness stays with the existing global stamp in Config.
 */
export namespace KilocodeProjectConfigStamp {
  /**
   * Digest of the project-effective config sources, or undefined when enumeration fails. Callers
   * must treat undefined as "reload conservatively" rather than "unchanged".
   */
  export const digest = Effect.fnUntraced(function* (input: {
    fs: FSUtil.Interface
    git: Git.Interface
    directory: string
    worktree?: string
  }) {
    const paths = yield* sources(input).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    if (paths === undefined) return undefined
    const entries = yield* Effect.forEach(
      paths,
      Effect.fnUntraced(function* (file) {
        const text = yield* input.fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
        return [file, text ?? null] as const
      }),
      { concurrency: "unbounded" },
    )
    // Read the live env at call time: the loader reads process.env.KILO_CONFIG_CONTENT, not a flag.
    const live = process.env["KILO_CONFIG_CONTENT"] ?? null
    return createHash("sha256")
      .update(JSON.stringify([entries, live]))
      .digest("hex")
  })

  /**
   * Whether a newly read digest requires a conservative invalidate for the cached config. An
   * unknown digest (enumeration failure) always reloads, and a first observation reloads even when
   * the digest is also unknown, so a failed scan can never pin a stale config for the instance.
   */
  export function stale(previous: string | undefined, digest: string | undefined): boolean {
    return digest === undefined || previous !== digest
  }

  /** Mirror the loader's read branches without widening KilocodeConfig.projectConfigFiles (write-only). */
  const sources = Effect.fnUntraced(function* (input: {
    fs: FSUtil.Interface
    git: Git.Interface
    directory: string
    worktree?: string
  }) {
    const fs = input.fs
    const files = new Set<string>()

    if (!Flag.KILO_DISABLE_PROJECT_CONFIG) {
      // Root config files from the directory up to the worktree.
      for (const name of ["kilo", "opencode"] as const) {
        const found = yield* ConfigPaths.files(name, input.directory, input.worktree).pipe(
          Effect.provideService(FSUtil.Service, fs),
        )
        for (const file of found) files.add(file)
      }

      // Primary-checkout fallback for linked git worktrees. `.git` is a file only in linked
      // worktrees and submodules, so skip the git lookup for ordinary checkouts.
      if (input.worktree && (yield* fs.isFile(path.join(input.worktree, ".git")))) {
        const dirs = yield* primaryPaths(input.directory, input.worktree, KilocodeConfig.KILO_DIR_SUFFIXES).pipe(
          Effect.provideService(Git.Service, input.git),
        )
        for (const dir of dirs) {
          for (const name of KilocodeConfig.ALL_CONFIG_FILES) files.add(path.join(dir, name))
        }
      }
    }

    // Config directories the loader merges: project `.kilo`/`.kilocode` dirs, legacy home dirs, and
    // KILO_CONFIG_DIR. The global config dir is covered by Config's global stamp, so skip it here.
    const dirs = yield* ConfigPaths.directories(input.directory, input.worktree).pipe(
      Effect.provideService(FSUtil.Service, fs),
    )
    for (const dir of dirs) {
      if (dir === Global.Path.config) continue
      for (const name of KilocodeConfig.ALL_CONFIG_FILES) files.add(path.join(dir, name))
    }

    if (Flag.KILO_CONFIG) files.add(Flag.KILO_CONFIG)
    return [...files].sort()
  })
}
