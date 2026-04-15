import { afterEach, test, expect } from "bun:test"
import path from "path"
import { Skill } from "../../src/skill"
import { Instance } from "../../src/project/instance"
import { BUILTIN_SKILLS } from "../../src/kilocode/skills/builtin"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("built-in skills are present in empty project", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      for (const builtin of BUILTIN_SKILLS) {
        const found = skills.find((s) => s.name === builtin.name)
        expect(found).toBeDefined()
        expect(found!.location).toBe(Skill.BUILTIN_LOCATION)
        expect(found!.description).toBe(builtin.description)
        expect(found!.content.length).toBeGreaterThan(0)
      }
    },
  })
})

test("built-in skill has correct metadata", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("kilo-config")
      expect(skill).toBeDefined()
      expect(skill!.name).toBe("kilo-config")
      expect(skill!.location).toBe(Skill.BUILTIN_LOCATION)
      expect(skill!.content).toContain("kilo")
    },
  })
})

test("user skill overrides built-in with same name", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".kilo", "skill", "kilo-config")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: kilo-config
description: User override of kilo-config.
---

# Custom kilo-config

User-provided content.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("kilo-config")
      expect(skill).toBeDefined()
      expect(skill!.description).toBe("User override of kilo-config.")
      expect(skill!.location).not.toBe(Skill.BUILTIN_LOCATION)
      expect(skill!.location).toContain(path.join("skill", "kilo-config", "SKILL.md"))
    },
  })
})
