export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { orderConfigDirectories } from "@/kilocode/config/paths" // kilocode_change
import * as Effect from "effect/Effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* AppFileSystem.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* AppFileSystem.Service
  return orderConfigDirectories(
    [
      Global.Path.config,
      ...(!Flag.KILO_DISABLE_PROJECT_CONFIG
        ? yield* afs.up({
            targets: [".kilocode", ".kilo", ".opencode"], // kilocode_change
            start: directory,
            stop: worktree,
          })
        : []),
      ...(yield* afs.up({
        targets: [".kilocode", ".kilo", ".opencode"], // kilocode_change
        start: Global.Path.home,
        stop: Global.Path.home,
      })),
    ],
    Flag.KILO_CONFIG_DIR,
  ) // kilocode_change
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}
