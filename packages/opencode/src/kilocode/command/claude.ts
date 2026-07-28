import { ConfigCommand } from "@/config/command"
import type { Warning } from "@/config/config"
import { primaryPaths } from "@/kilocode/primary-worktree"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ConfigCommandV1 } from "@opencode-ai/core/v1/config/command"
import { Effect } from "effect"
import path from "path"

type Ctx = {
  directory: string
  worktree: string
  disabled: boolean
  warnings?: Warning[]
}

const dir = ".claude"

export const load = Effect.fn("ClaudeCommands.load")(function* (ctx: Ctx) {
  if (ctx.disabled) return {}

  const fsys = yield* FSUtil.Service
  const global = yield* Global.Service
  const root = ctx.worktree === "/" ? ctx.directory : ctx.worktree
  const result: Record<string, ConfigCommandV1.Info> = {}
  const home = path.join(global.home, dir)

  if (yield* fsys.isDir(home)) {
    Object.assign(result, yield* Effect.promise(() => ConfigCommand.load(home, ctx.warnings, true)))
  }

  const local = yield* fsys
    .up({ targets: [dir], start: ctx.directory, stop: root })
    .pipe(Effect.catch(() => Effect.succeed([] as string[])))
  const fallbacks = yield* primaryPaths(ctx.directory, ctx.worktree, [dir])
  for (const item of [...fallbacks, ...local]) {
    const scope = fallbacks.includes(item) ? path.dirname(item) : root
    Object.assign(
      result,
      yield* Effect.promise(() =>
        ConfigCommand.load(item, ctx.warnings, false, { root, source: root }, { root: scope, source: scope }),
      ),
    )
  }

  return result
})

export * as ClaudeCommands from "./claude"
