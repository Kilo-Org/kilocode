import path from "path"
import type { MessageV2 } from "@/session/message-v2"
import type { Info as SessionInfo } from "@/session/session"
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
    // may not exist yet, but an existing non-file is never the plan
    const existing = Filesystem.stat(full)
    if (existing && !existing.isFile()) return
    return full
  }

  // Newest of: the exact target, or a sibling matching the session's generated-name
  // pattern. Both compete on mtime so a stale exact-path guess can't beat a fresher
  // sibling written in a later refinement round.
  async function saved(file: string, info: SessionInfo) {
    const dir = path.dirname(file)
    const base = `${info.time.created}-`
    const siblings = (await Filesystem.isDir(dir))
      ? Array.from(new Bun.Glob(`${base}*.md`).scanSync({ cwd: dir, onlyFiles: true })).map((item) => path.join(dir, item))
      : []
    const items = siblings.includes(file) ? siblings : [...siblings, file]

    const found = items
      .flatMap((item) => {
        const stat = Filesystem.stat(item)
        return stat?.isFile() ? [{ item, stat }] : []
      })
      .sort((a, b) => Number(b.stat.mtimeMs) - Number(a.stat.mtimeMs) || a.item.localeCompare(b.item))[0]

    return found?.item
  }

  const PLANNERS = new Set(["plan", "architect"])

  // Intentionally narrow — a false match here finalizes the wrong file.
  function planWrite(part: MessageV2.WithParts["parts"][number]): string | undefined {
    if (part.type !== "tool" || part.state.status !== "completed") return
    if (part.tool !== "write" && part.tool !== "edit") return
    const file = (part.state.input ?? {})["filePath"]
    if (typeof file !== "string" || !file.toLowerCase().endsWith(".md")) return
    return file
  }

  // Newest .md written by a planning agent (or `agent`, covering custom architect slugs).
  async function written(messages: MessageV2.WithParts[], target: string, ctx: InstanceContext, agent?: string) {
    const dir = path.dirname(target)
    const files = messages
      .filter((m) => PLANNERS.has(m.info.agent?.toLowerCase() ?? "") || (!!agent && m.info.agent === agent))
      .flatMap((m) => m.parts)
      .flatMap((part) => planWrite(part) ?? [])
    for (const item of files.reverse()) {
      const full = path.isAbsolute(item) ? path.normalize(item) : path.resolve(ctx.directory, item)
      // dir check admits the canonical plan dir, outside the worktree for non-git projects
      if (!containsPath(full, ctx) && !Filesystem.contains(dir, full)) continue
      if (await Filesystem.exists(full)) return full
    }
  }

  /** The plan file actually on disk: exact target, else generated-name sibling, else last plan write. */
  export async function locate(
    target: string,
    messages: MessageV2.WithParts[],
    info: SessionInfo,
    ctx: InstanceContext,
    agent?: string,
  ) {
    return (await saved(target, info)) ?? (await written(messages, target, ctx, agent))
  }

  export function display(file: string, ctx: InstanceContext) {
    const root = ctx.worktree === "/" ? ctx.directory : ctx.worktree
    if (Filesystem.contains(root, file)) return path.relative(root, file) || file
    if (Filesystem.contains(ctx.directory, file)) return path.relative(ctx.directory, file) || file
    return file
  }
}
