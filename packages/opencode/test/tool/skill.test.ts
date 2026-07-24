import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Cause, Effect, Exit, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { Permission } from "../../src/permission"
import type { Tool } from "@/tool/tool"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances, provideTmpdirInstance, TestInstance } from "../fixture/fixture" // kilocode_change
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node).pipe(Layer.provide(Ripgrep.defaultLayer)))

// kilocode_change - skip on windows: address windows ci failures #9496
const unix = process.platform !== "win32" ? it.instance : it.instance.skip

describe("tool.skill", () => {
  unix("execute returns skill content block with files", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const skill = path.join(dir, ".kilo", "skill", "tool-skill") // kilocode_change
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

      expect(tool.description).toContain("tool-skill") // kilocode_change - include concise available-skill context
      expect(tool.description).toContain("Skill for tool tests.") // kilocode_change

      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
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
  )

  it.instance("execute preserves not found message", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
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

      const exit = yield* tool
        .execute(
          { name: "missing-skill" },
          {
            ...baseCtx,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(Error)
        if (error instanceof Error) expect(error.message).toContain('Skill "missing-skill" not found.')
      }
    }),
  )

  // kilocode_change start
  unix("reuses parsed skills until the ignore policy changes", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const skill = path.join(dir, ".kilo", "skill", "cache-skill", "SKILL.md")
      yield* Effect.promise(() =>
        Bun.write(skill, `---\nname: cache-skill\ndescription: Initial description.\n---\n\nInitial content.\n`),
      )

      const home = process.env.KILO_TEST_HOME
      process.env.KILO_TEST_HOME = dir
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          process.env.KILO_TEST_HOME = home
        }),
      )

      const registry = yield* ToolRegistry.Service
      const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
      const tools = () => registry.tools({ providerID: "opencode" as any, modelID: "gpt-5" as any, agent })
      expect((yield* tools()).find((tool) => tool.id === SkillTool.id)?.description).toContain("Initial description.")

      yield* Effect.promise(() =>
        Bun.write(skill, `---\nname: cache-skill\ndescription: Changed description.\n---\n\nChanged content.\n`),
      )
      expect((yield* tools()).find((tool) => tool.id === SkillTool.id)?.description).toContain("Initial description.")

      yield* Effect.promise(() => Bun.write(path.join(dir, ".kilocodeignore"), ".kilo/skill/cache-skill/\n"))
      expect((yield* tools()).find((tool) => tool.id === SkillTool.id)?.description).not.toContain("cache-skill")
    }),
  )
  // kilocode_change end

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
