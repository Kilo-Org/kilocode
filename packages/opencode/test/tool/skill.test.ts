import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Cause, Effect, Exit, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import path from "path"
import type { Permission } from "../../src/permission"
import type { Tool } from "@/tool/tool"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "@/tool/registry"
import { ToolJsonSchema } from "@/tool/json-schema"
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

const it = testEffect(LayerNode.compile(LayerNode.group([ToolRegistry.node, CrossSpawnSpawner.node, Ripgrep.node])))

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

      expect(tool.description).not.toContain("tool-skill")
      expect(tool.description).not.toContain("Skill for tool tests.")
      expect(tool.description).not.toContain("# Tool Skill")
      expect(tool.description).toContain("skills listed in the system prompt")
      expect(ToolJsonSchema.fromTool(tool)).toMatchObject({
        type: "object",
        properties: {
          name: { type: "string", description: "The name of the skill from available_skills" },
        },
        required: ["name"],
      })

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
      expect(result.output).toContain("Use this skill.")
      expect(result.output).toContain(`Base directory for this skill: ${skill}`)
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
  it.live("built-in kilo-config keeps rendered shell examples inert", () =>
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

          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: (req) =>
              Effect.sync(() => {
                requests.push(req)
              }),
          }

          const result = yield* tool.execute({ name: "kilo-config" }, ctx)

          expect(result.metadata.dir).toBe("builtin")
          expect(result.output).toContain("Finding a named command")
          expect(result.output).toContain("~/.config/kilo/")
          expect(result.output).toContain("~/.kilocode/")
          expect(result.output).toContain("**/command/")
          expect(result.output).toContain("explicit search")
          expect(result.output).toContain("`` !`cmd` ``")
          expect(result.output).not.toContain("[skill shell command failed]")
          expect(requests.map((request) => request.permission)).toEqual(["skill"])
        }),
      { git: true },
    ),
  )
  // kilocode_change end
})
