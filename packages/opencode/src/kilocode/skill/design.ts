import path from "path"
import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import type { Skill } from "@/skill"

const NAME = "project-design"
const DESCRIPTION =
  "Use this when creating or modifying UI so visual choices follow the project's DESIGN.md design system, including colors, typography, layout, components, and style guardrails."
const FILE = "DESIGN.md"
const FALLBACKS = [
  FILE,
  path.join("docs", FILE),
  path.join("docs", "design", FILE),
  path.join("docs", "design-system", FILE),
  path.join("design", FILE),
  path.join("design-system", FILE),
]

export const add = Effect.fnUntraced(function* (
  fs: AppFileSystem.Interface,
  skills: Record<string, Skill.Info>,
  directory: string,
  worktree: string,
) {
  if (skills[NAME]) return

  const filepath = yield* find(fs, directory, worktree)
  if (!filepath) return

  const content = yield* fs.readFileString(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!content) return

  skills[NAME] = {
    name: NAME,
    description: DESCRIPTION,
    location: filepath,
    content,
  }
})

const find = Effect.fnUntraced(function* (fs: AppFileSystem.Interface, directory: string, worktree: string) {
  const matches = yield* fs.findUp(FILE, directory, worktree).pipe(Effect.catch(() => Effect.succeed([] as string[])))
  if (matches.length > 0) return path.resolve(matches[0])

  for (const item of FALLBACKS) {
    const filepath = path.resolve(path.join(worktree, item))
    if (yield* fs.existsSafe(filepath)) return filepath
  }

  return undefined
})

export const ProjectDesignSkill = { add }
