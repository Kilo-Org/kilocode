import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"
import { Skill } from "../../src/skill"
import * as KiloSkill from "../../src/kilocode/skill-remove"
import { BUILTIN_SKILLS } from "../../src/kilocode/skills/builtin"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer))

it.instance(
  "built-in skills are present in empty project",
  () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const skills = yield* skill.all()
      for (const builtin of BUILTIN_SKILLS) {
        const found = skills.find((s) => s.name === builtin.name)
        expect(found).toBeDefined()
        expect(found!.location).toBe(Skill.BUILTIN_LOCATION)
        expect(found!.description).toBe(builtin.description)
        expect(found!.content.length).toBeGreaterThan(0)
      }
    }),
  { git: true },
)

it.instance(
  "built-in skill has correct metadata",
  () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const item = yield* skill.get("kilo-config")
      expect(item).toBeDefined()
      expect(item!.name).toBe("kilo-config")
      expect(item!.location).toBe(Skill.BUILTIN_LOCATION)
      expect(item!.content).toContain("kilo")
    }),
  { git: true },
)

it.instance(
  "kilo-config is protected from removal",
  () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const item = yield* skill.get("kilo-config")
      expect(item).toBeDefined()
      expect(KiloSkill.builtin(item!.location)).toBe(true)
    }),
  { git: true },
)

it.instance(
  "user skill overrides built-in with same name",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const dir = path.join(instance.directory, ".kilo", "skill", "kilo-config")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "SKILL.md"),
          `---
name: kilo-config
description: User override of kilo-config.
---

# Custom kilo-config

User-provided content.
`,
        ),
      )

      const skill = yield* Skill.Service
      const item = yield* skill.get("kilo-config")
      expect(item).toBeDefined()
      expect(item!.description).toBe("User override of kilo-config.")
      expect(item!.location).not.toBe(Skill.BUILTIN_LOCATION)
      expect(item!.location).toContain(path.join("skill", "kilo-config", "SKILL.md"))
    }),
  { git: true },
)
