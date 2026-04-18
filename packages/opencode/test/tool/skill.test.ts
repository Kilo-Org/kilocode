import { Effect } from "effect"
import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { Permission } from "../../src/permission"
import type { Tool } from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { SkillTool, SkillDescription } from "../../src/tool/skill"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.skill", () => {
  test("description lists skill location URL", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill", "tool-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill
`,
        )
      },
    })

    const home = process.env.KILO_TEST_HOME
    process.env.KILO_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const desc = await Effect.runPromise(
            SkillDescription({ name: "build", mode: "primary" as const, permission: [], options: {} }),
          )
          expect(desc).toContain(`**tool-skill**: Skill for tool tests.`)
        },
      })
    } finally {
      process.env.KILO_TEST_HOME = home
    }
  })

  test("description sorts skills by name and is stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".opencode", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.KILO_TEST_HOME
    process.env.KILO_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
          const first = await Effect.runPromise(SkillDescription(agent))
          const second = await Effect.runPromise(SkillDescription(agent))

          expect(first).toBe(second)

          const alpha = first.indexOf("**alpha-skill**: Alpha skill.")
          const middle = first.indexOf("**middle-skill**: Middle skill.")
          const zeta = first.indexOf("**zeta-skill**: Zeta skill.")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.KILO_TEST_HOME = home
    }
  })

  test("execute returns skill content block with files", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill", "tool-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill

Use this skill.
`,
        )
        await Bun.write(path.join(skillDir, "scripts", "demo.txt"), "demo")
      },
    })

    const home = process.env.KILO_TEST_HOME
    process.env.KILO_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await SkillTool.init()
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: async (req) => {
              requests.push(req)
            },
          }

          const result = await tool.execute({ name: "tool-skill" }, ctx)
          const dir = path.join(tmp.path, ".opencode", "skill", "tool-skill")
          const file = path.resolve(dir, "scripts", "demo.txt")

          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("skill")
          expect(requests[0].patterns).toContain("tool-skill")
          expect(requests[0].always).toContain("tool-skill")

          expect(result.metadata.dir).toBe(dir)
          expect(result.output).toContain(`<skill_content name="tool-skill">`)
          expect(result.output).toContain(`Base directory for this skill: ${pathToFileURL(dir).href}`)
          expect(result.output).toContain(`<file>${file}</file>`)
        },
      })
    } finally {
      process.env.KILO_TEST_HOME = home
    }
  })

  test("built-in kilo-config includes named command lookup guidance", async () => {
    await using tmp = await tmpdir({ git: true })

    const home = process.env.KILO_TEST_HOME
    process.env.KILO_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await SkillTool.init()
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: async () => {},
          }

          const result = await tool.execute({ name: "kilo-config" }, ctx)

          expect(tool.description).toContain("where it loads things from")
          expect(result.metadata.dir).toBe("builtin")
          expect(result.output).toContain("Finding a named command")
          expect(result.output).toContain("~/.config/kilo/")
          expect(result.output).toContain("~/.kilocode/")
          expect(result.output).toContain("**/command/")
          expect(result.output).toContain("explicit search")
        },
      })
    } finally {
      process.env.KILO_TEST_HOME = home
    }
  })
})
