import fs from "fs/promises"
import path from "path"
import { Config } from "@/config/config"
import { Skill } from "@/skill"
import { Effect } from "effect"
import * as Paths from "./paths"
import type { Metadata, Type } from "./types"

type Entry = [string, { type: Type }]

async function files(dirs: string[]): Promise<Entry[]> {
  const out: Entry[] = []
  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir)
      out.push(
        ...entries
          .filter((file) => file.endsWith(".md"))
          .map((file) => [path.basename(file, ".md"), { type: "agent" as const }] as Entry),
      )
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn(`Failed to detect marketplace agents from ${dir}:`, err)
    }
  }
  return out
}

function config(cfg: Config.Info): Entry[] {
  return [
    ...Object.keys(cfg.mcp ?? {}).map((key) => [key, { type: "mcp" as const }] as Entry),
    ...Object.keys(cfg.agent ?? {}).map((key) => [key, { type: "agent" as const }] as Entry),
  ]
}

function inside(file: string, dir: string) {
  const base = path.resolve(dir)
  const target = path.resolve(file)
  return target === base || target.startsWith(base + path.sep)
}

function skill(skills: Skill.Info[], dirs: string[]): Entry[] {
  return skills
    .filter((item) => dirs.some((dir) => inside(item.location, dir)))
    .map((item) => [item.name, { type: "skill" as const }] as Entry)
}

export const detect = Effect.fn("Marketplace.detect")(function* (ctx: Paths.Ctx) {
  const cfg = yield* Config.Service
  const svc = yield* Skill.Service
  const skills = yield* svc.all()
  const dirs = yield* svc.dirs()
  const project = Object.fromEntries([
    ...(yield* Effect.promise(() => files(Paths.agents("project", ctx)))),
    ...config(yield* cfg.get()),
    ...skill(
      skills,
      dirs.filter((dir) => Paths.skillRoots("project", ctx).some((root) => inside(dir, root))),
    ),
  ])
  const global = Object.fromEntries([
    ...(yield* Effect.promise(() => files(Paths.agents("global", ctx)))),
    ...config(yield* cfg.getGlobal()),
    ...skill(
      skills,
      dirs.filter((dir) => Paths.skillRoots("global", ctx).some((root) => inside(dir, root))),
    ),
  ])
  return { project, global } satisfies Metadata
})
