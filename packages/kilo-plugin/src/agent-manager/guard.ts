import type { Context } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { Patch } from "@opencode/util/patch"
import { Effect, Result } from "effect"
import path from "path"
import { assertMutablePath, MESSAGE } from "./protection"

const MUTATION_TOOLS = new Set(["patch", "edit", "write"])

/**
 * Rejects a mutation of the Agent Manager state file before the tool runs. The guard lives on a tool hook so the
 * upstream tools stay unchanged.
 */
export const guard = (ctx: Context) =>
  ctx.tool.hook("execute.before", (event) => {
    if (!MUTATION_TOOLS.has(event.tool)) return Effect.void
    return Effect.try({
      try: () => {
        for (const target of mutationTargets(event.tool, event.input, ctx.location.directory))
          assertMutablePath(target)
      },
      catch: () => new Tool.Error({ message: MESSAGE }),
    })
  })

export function mutationTargets(tool: string, input: unknown, directory: string) {
  if (!MUTATION_TOOLS.has(tool)) return []
  if (tool === "patch") return patchTargets(input, directory)
  if (!isRecord(input) || typeof input.path !== "string") return []
  return [path.resolve(directory, input.path)]
}

function patchTargets(input: unknown, directory: string) {
  if (!isRecord(input) || typeof input.patchText !== "string") return []
  const parsed = Patch.parse(input.patchText)
  if (Result.isFailure(parsed)) return []
  return parsed.success.flatMap((hunk) => {
    const written = hunk.type === "update" && hunk.movePath ? [hunk.path, hunk.movePath] : [hunk.path]
    return written.map((target) => path.resolve(directory, target))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
