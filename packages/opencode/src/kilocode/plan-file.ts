import path from "path"
import type { MessageV2 } from "@/session/message-v2"
import { containsPath, type InstanceContext } from "@/project/instance-context"
import { Filesystem } from "@/util/filesystem"

export namespace PlanFile {
  export function latest(messages: MessageV2.WithParts[]) {
    const exit = messages
      .flatMap((m) => m.parts)
      .findLast((part) => part.type === "tool" && part.tool === "plan_exit" && part.state.status === "completed")
    if (exit?.type !== "tool" || exit.state.status !== "completed") return
    const meta = exit.state.metadata ?? {}
    const input = exit.state.input ?? {}
    return typeof meta.plan === "string" ? meta.plan : typeof input.path === "string" ? input.path : undefined
  }

  export function resolve(file: string | undefined, ctx: InstanceContext) {
    if (!file) return
    const root = ctx.worktree === "/" ? ctx.directory : ctx.worktree
    const full = path.isAbsolute(file) ? path.normalize(file) : path.resolve(root, file)
    if (!containsPath(full, ctx)) return
    return full
  }

  export function display(file: string, ctx: InstanceContext) {
    const root = ctx.worktree === "/" ? ctx.directory : ctx.worktree
    if (Filesystem.contains(root, file)) return path.relative(root, file) || file
    if (Filesystem.contains(ctx.directory, file)) return path.relative(ctx.directory, file) || file
    return file
  }
}
