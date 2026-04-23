import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { Permission } from "../../src/permission"
import type { Tool } from "../../src/tool"
import { Instance } from "../../src/project/instance"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node))

describe("tool.skill", () => {
  it.live("description lists skill location URL", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const skill = path.join(dir, ".opencode", "skill", "tool-skill")
          yield* Effect.promise(() =>
            Bun.write(
              path.join(skill, "SKILL.md"),
              `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill
`,
            ),
          )
          const home = process.env.KILO_TEST_HOME
          process.env.KILO_TEST_HOME = dir
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              process.env.KILO_TEST_HOME = home
            }),
          )
          const registry = yield* ToolRegistry.Service
          const desc =
            (yield* registry.tools({
              providerID: "opencode" as any,
              modelID: "gpt-5" as any,
              agent: { name: "build", mode: "primary", permission: [], options: {} },
            })).find((tool) => tool.id === SkillTool.id)?.description ?? ""
          expect(desc).toContain("**tool-skill**: Skill for tool tests.")
        }),
      { git: true },
    ),
  )

  it.live("description sorts skills by name and is stable across calls", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          for (const [name, description] of [
            ["zeta-skill", "Zeta skill."],
            ["alpha-skill", "Alpha skill."],
            ["middle-skill", "Middle skill."],
          ]) {
            const skill = path.join(dir, ".opencode", "skill", name)
            yield* Effect.promise(() =>
              Bun.write(
                path.join(skill, "SKILL.md"),
                `---
name: ${name}
description: ${description}
---

# ${name}
`,
              ),
            )
          }
          const home = process.env.KILO_TEST_HOME
          process.env.KILO_TEST_HOME = dir
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              process.env.KILO_TEST_HOME = home
            }),
          )

          const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
          const registry = yield* ToolRegistry.Service
          const load = Effect.fnUntraced(function* () {
            return (
              (yield* registry.tools({
                providerID: "opencode" as any,
                modelID: "gpt-5" as any,
                agent,
              })).find((tool) => tool.id === SkillTool.id)?.description ?? ""
            )
          })
          const first = yield* load()
          const second = yield* load()

          expect(first).toBe(second)

          const alpha = first.indexOf("**alpha-skill**: Alpha skill.")
          const middle = first.indexOf("**middle-skill**: Middle skill.")
          const zeta = first.indexOf("**zeta-skill**: Zeta skill.")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        }),
      { git: true },
    ),
  )

  it.live("execute returns skill content block with files", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const skill = path.join(dir, ".opencode", "skill", "tool-skill")
          yield* Effect.promise(() =>
            Bun.write(
              path.join(skill, "SKILL.md"),
              `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill

Use this skill.
`,
            ),
          )
          yield* Effect.promise(() => Bun.write(path.join(skill, "scripts", "demo.txt"), "demo"))

          const home = process.env.KILO_TEST_HOME
          process.env.KILO_TEST_HOME = dir
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              process.env.KILO_TEST_HOME = home
            }),
          )

          const registry = yield* ToolRegistry.Service
          const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
          const tool = (yield* registry.tools({
            providerID: "opencode" as any,
            modelID: "gpt-5" as any,
            agent,
          })).find((tool) => tool.id === SkillTool.id)
          if (!tool) throw new Error("Skill tool not found")

          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: (req) =>
              Effect.sync(() => {
                requests.push(req)
              }),
          }

          const result = yield* tool.execute({ name: "tool-skill" }, ctx)
          const file = path.resolve(skill, "scripts", "demo.txt")

          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("skill")
          expect(requests[0].patterns).toContain("tool-skill")
          expect(requests[0].always).toContain("tool-skill")
          expect(result.metadata.dir).toBe(skill)
          expect(result.output).toContain(`<skill_content name="tool-skill">`)
          expect(result.output).toContain(`Base directory for this skill: ${pathToFileURL(skill).href}`)
          expect(result.output).toContain(`<file>${file}</file>`)
        }),
      { git: true },
    ),
  )

  // kilocode_change start
  it.live("built-in kilo-config includes named command lookup guidance", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const home = process.env.KILO_TEST_HOME
          process.env.KILO_TEST_HOME = dir
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              process.env.KILO_TEST_HOME = home
            }),
          )

          const registry = yield* ToolRegistry.Service
          const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
          const tool = (yield* registry.tools({
            providerID: "opencode" as any,
            modelID: "gpt-5" as any,
            agent,
          })).find((t) => t.id === SkillTool.id)
          if (!tool) throw new Error("Skill tool not found")

          const ctx: Tool.Context = {
            ...baseCtx,
            ask: () => Effect.void,
          }

          const result = yield* tool.execute({ name: "kilo-config" }, ctx)

          expect(result.metadata.dir).toBe("builtin")
          expect(result.output).toContain("Finding a named command")
          expect(result.output).toContain("~/.config/kilo/")
          expect(result.output).toContain("~/.kilocode/")
          expect(result.output).toContain("**/command/")
          expect(result.output).toContain("explicit search")
        }),
      { git: true },
    ),
  )
  // kilocode_change end
})
