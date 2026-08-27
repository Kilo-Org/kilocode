import path from "path"
import { Data, Duration, Effect, Option, RcMap } from "effect"
import { FSUtil } from "../fs-util"
import type { Ripgrep } from "../ripgrep"
import { ToolOutputStore } from "../tool-output-store"

export interface Target {
  readonly path: string
  readonly type: "file" | "directory"
  readonly dev: number
  readonly ino: number
}

class Key extends Data.Class<Target> {}

export const inspect = Effect.fn("SearchTarget.inspect")(function* (fs: FSUtil.Interface, input: string) {
  const target = yield* fs.realPath(input)
  const info = yield* fs.stat(target)
  if ((yield* fs.realPath(input)) !== target)
    return yield* Effect.fail(new Error("Search target changed during inspection"))
  const type = info.type === "File" ? "file" : info.type === "Directory" ? "directory" : undefined
  const ino = Option.getOrUndefined(info.ino)
  if (!type || ino === undefined) return yield* Effect.fail(new Error("Search target identity is unavailable"))
  return { path: target, type, dev: info.dev, ino } satisfies Target
})

export const validate = Effect.fn("SearchTarget.validate")(function* (fs: FSUtil.Interface, target: Target) {
  const info = yield* fs.stat(target.path)
  const type = info.type === "File" ? "file" : info.type === "Directory" ? "directory" : undefined
  if (type === target.type && info.dev === target.dev && Option.getOrUndefined(info.ino) === target.ino) return
  yield* Effect.fail(new Error("Search target changed after approval"))
})

export const listing = Effect.fn("SearchTarget.listing")(function* (
  fs: FSUtil.Interface,
  ripgrep: Ripgrep.Interface,
  limit: number,
) {
  const pending = yield* RcMap.make({
    lookup: (target: Target) =>
      ripgrep.find({ cwd: target.path, pattern: "*", limit, validate: validate(fs, target) }).pipe(Effect.orDie),
    capacity: 1,
    idleTimeToLive: Duration.zero,
  })
  return (target: Target) => RcMap.get(pending, new Key(target)).pipe(Effect.orDie)
})

export const managed = Effect.fn("SearchTarget.managed")(function* (
  fs: FSUtil.Interface,
  data: string,
  target: Target,
) {
  if (target.type !== "file" || !path.basename(target.path).startsWith("tool_")) return false
  const directory = yield* fs.realPath(path.join(data, ToolOutputStore.MANAGED_DIRECTORY))
  return path.dirname(target.path) === directory
})
