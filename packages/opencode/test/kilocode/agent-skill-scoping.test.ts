import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "../../src/agent/agent"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, Skill.defaultLayer, SystemPrompt.defaultLayer))

const skill = (dir: string, name: string) =>
  Effect.promise(async () => {
    const root = path.join(dir, ".kilo", "skills", name)
    await fs.mkdir(root, { recursive: true })
    await Bun.write(
      path.join(root, "SKILL.md"),
      `---
name: ${name}
description: Guidance for ${name}.
---

# ${name}
`,
    )
  })

it.instance(
  "scopes system-prompt skill metadata with per-agent permissions",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const prompt = yield* SystemPrompt.Service
      const guide = yield* agents.get("guide")
      const output = yield* prompt.skills(guide)

      expect(output).toContain("<name>skill-creator</name>")
      expect(output).not.toContain("<name>subagent-creator</name>")
      expect(output).not.toContain("<name>kilo-config</name>")
    }),
  {
    config: {
      agent: {
        guide: {
          mode: "primary",
          permission: {
            skill: {
              "*": "deny",
              "skill-creator": "allow",
            },
          },
        },
      },
    },
    init: (dir) => Effect.all([skill(dir, "skill-creator"), skill(dir, "subagent-creator")], { concurrency: 2 }),
  },
)
