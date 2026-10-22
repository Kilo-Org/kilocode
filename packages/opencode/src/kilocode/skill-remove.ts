import { unlink } from "node:fs/promises"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import { Skill } from "@/skill"

const LEGACY_BUILTIN_LOCATION = "<built-in>"

type Info = Pick<Skill.Info, "location">

export function builtin(location: string) {
  return location === Skill.BUILTIN_LOCATION || location === LEGACY_BUILTIN_LOCATION
}

export function target(location: string, skills: readonly Info[]) {
  if (builtin(location)) throw new Error("cannot remove built-in skill")

  const skill = skills.find((item) => item.location === location)
  if (!skill) throw new Error("skill not found in registry")
  if (builtin(skill.location)) throw new Error("cannot remove built-in skill")
  if (!path.isAbsolute(skill.location)) throw new Error("skill location must be absolute")

  const file = path.resolve(skill.location)
  if (path.basename(file) !== "SKILL.md") throw new Error("skill location must reference SKILL.md")

  const cache = path.join(Global.Path.cache, "skills")
  const relative = path.relative(cache, file)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("remove URL-backed skills from configuration")
  }
  return file
}

export async function remove(location: string, skills: readonly Info[]) {
  const file = target(location, skills)
  // Removing only the manifest disables discovery without recursively deleting user files.
  await unlink(file)
}
