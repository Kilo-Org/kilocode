import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Skill } from "../../../src/skill"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance, testInstanceStoreLayer } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import * as SkillPaths from "../../../src/kilocode/skill/paths"

const node = AppNodeBuilder.build(CrossSpawnSpawner.node)
const skills = AppNodeBuilder.build(Skill.node, [
  [RuntimeFlags.node, RuntimeFlags.layer({ disableExternalSkills: true, disableClaudeCodeSkills: true })],
])
const it = testEffect(Layer.mergeAll(skills, node, testInstanceStoreLayer))

const fixture = (name: string) => `---
name: ${name}
description: ${name} skill.
---

# ${name}
`

const write = (dir: string, ...parts: string[]) =>
  Effect.promise(() => Bun.write(path.join(dir, ...parts, "SKILL.md"), fixture(parts.at(-1)!)))

const names = (list: readonly Skill.Info[]) =>
  list
    .map((x) => x.name)
    .filter((n) => n.endsWith("-skill"))
    .sort()

describe("kilocode skills.paths resolution", () => {
  test("rooted detects a leading slash but not drive or UNC paths", () => {
    expect(SkillPaths.rooted("/.github/skills")).toBe(true)
    expect(SkillPaths.rooted("\\.github\\skills")).toBe(true)
    expect(SkillPaths.rooted(".github/skills")).toBe(false)
    expect(SkillPaths.rooted("./skills")).toBe(false)
    expect(SkillPaths.rooted("C:\\skills")).toBe(false)
    expect(SkillPaths.rooted("\\\\server\\share")).toBe(false)
    expect(SkillPaths.rooted("//server/share")).toBe(false)
  })

  // Issue #14181: "/.github/skills" configured in the VS Code settings must load the repo skills.
  it.live("leading slash falls back to the project root when the absolute path does not exist", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* write(dir, ".github", "skills", "slash-skill")
          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(names(list)).toEqual(["slash-skill"])
          const found = list.find((x) => x.name === "slash-skill")!
          expect(found.location).toBe(path.join(dir, ".github", "skills", "slash-skill", "SKILL.md"))
          expect(found.trusted).not.toBe(true)
        }),
      { git: true, config: { skills: { paths: ["/.github/skills"] } } },
    ),
  )

  it.live("relative, dot-relative, and real absolute entries keep loading", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* write(dir, ".github", "skills", "rel-skill")
          yield* write(dir, "team", "skills", "dot-skill")
          yield* write(dir, "abs", "skills", "abs-skill")
          // The absolute entry needs the tmpdir, so write the config before the first config read.
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, "kilo.json"),
              JSON.stringify({
                skills: { paths: [".github/skills", "./team/skills", path.join(dir, "abs", "skills")] },
              }),
            ),
          )
          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(names(list)).toEqual(["abs-skill", "dot-skill", "rel-skill"])
        }),
      { git: true },
    ),
  )

  it.live("a leading slash that matches nothing is still skipped", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* write(dir, ".kilo", "skills", "project-skill")
          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(names(list)).toEqual(["project-skill"])
        }),
      { git: true, config: { skills: { paths: ["/does-not-exist/skills"] } } },
    ),
  )
})
