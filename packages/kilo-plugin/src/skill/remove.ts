export * as SkillRemove from "./remove.js"

import { FSUtil } from "@opencode/util/fs-util"
import path from "path"

export type Entry =
  | { readonly type: "directory"; readonly path: string }
  | { readonly type: "document"; readonly info: { readonly skills?: readonly string[] } }

export type SkillPath = { readonly path: string }

export type Failure = "not_found" | "not_removable"
export type Target = { readonly _tag: "target"; readonly path: string } | { readonly _tag: "failure"; readonly reason: Failure }

const failure = (reason: Failure): Target => ({ _tag: "failure", reason })

/** Skill roots from the config entries, as the config skill plugin reads them. */
export function roots(entries: readonly Entry[], directory: string, home: string) {
  const result: string[] = []
  const add = (value: string) => {
    if (!result.includes(value)) result.push(value)
  }
  for (const entry of entries) {
    if (entry.type === "directory") {
      add(path.resolve(entry.path, "skill"))
      add(path.resolve(entry.path, "skills"))
      continue
    }
    for (const item of entry.info.skills ?? []) {
      if (URL.canParse(item) && /^(https?:)$/.test(new URL(item).protocol)) continue
      const expanded = item.startsWith("~/") ? path.join(home, item.slice(2)) : item
      add(path.resolve(path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)))
    }
  }
  return result
}

/** The file a removal may delete for `requested`: a registered skill manifest inside a configured root. */
export function target(requested: string, skills: readonly SkillPath[], skillRoots: readonly string[], cache: string): Target {
  if (!path.isAbsolute(requested)) return failure("not_removable")
  const file = path.resolve(requested)
  if (!skills.some((skill) => path.resolve(skill.path) === file)) return failure("not_found")
  if (FSUtil.contains(path.resolve(cache), file)) return failure("not_removable")
  const root = skillRoots.map((value) => path.resolve(value)).find((value) => value !== file && FSUtil.contains(value, file))
  if (!root) return failure("not_removable")
  // A directory skill has SKILL.md; a flat skill is a top-level .md file directly in its root.
  if (path.basename(file) !== "SKILL.md" && !(path.dirname(file) === root && file.endsWith(".md")))
    return failure("not_removable")
  return { _tag: "target", path: file }
}

/** Registered skills that a removal may delete. */
export function targets(skills: readonly SkillPath[], skillRoots: readonly string[], cache: string) {
  return skills.flatMap((skill) => {
    const result = target(skill.path, skills, skillRoots, cache)
    return result._tag === "target" ? [result.path] : []
  })
}
