import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { expect } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import fs from "fs/promises"
import path from "path"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"
import type { Tool } from "../../src/tool/tool"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "../../src/tool/registry"
import { ToolJsonSchema } from "../../src/tool/json-schema"
import * as KiloSkill from "../../src/kilocode/skill-remove"
import { BUILTIN_SKILLS } from "../../src/kilocode/skills/builtin"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Skill.node,
      ToolRegistry.node,
      Permission.node,
      Global.node,
      CrossSpawnSpawner.node,
      Ripgrep.node,
    ]),
  ),
)

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_builtin"),
  messageID: MessageID.make("msg_builtin"),
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

function load() {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const tool = (yield* registry.tools({
      providerID: ProviderV2.ID.opencode,
      modelID: ModelV2.ID.make("gpt-5"),
      agent: { name: "code", mode: "primary", permission: [], options: {} },
    })).find((tool) => tool.id === SkillTool.id)
    if (!tool) throw new Error("Skill tool not found")
    return tool
  })
}

it.instance(
  "built-in skills are present in empty project",
  () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const skills = yield* skill.all()
      expect(skills.filter((item) => item.location === Skill.BUILTIN_LOCATION).map((item) => item.name)).toEqual([
        "kilo-config",
      ])
      for (const builtin of BUILTIN_SKILLS) {
        const found = skills.find((s) => s.name === builtin.name)
        expect(found).toBeDefined()
        expect(found!.location).toBe(Skill.BUILTIN_LOCATION)
        expect(found!.description).toBe(builtin.description)
        expect(found!.content.length).toBeGreaterThan(0)
        expect(found).not.toHaveProperty("references")
        expect(builtin.description.length).toBeLessThan(160)
        for (const verbose of [true, false]) {
          const catalog = Skill.fmt(skills, { verbose })
          expect(catalog).not.toContain(builtin.content.trim())
          for (const body of Object.values(builtin.references ?? {})) {
            expect(catalog).not.toContain(body.split("\n").at(0)!)
          }
        }
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
      expect(item!.content.length).toBeLessThan(1500)
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
      const tool = yield* load()
      const result = yield* tool.execute({ name: "kilo-config" }, ctx)
      expect(result.output).toContain("User-provided content.")
      expect(result.output).not.toContain('reference:"configuration"')
      const exit = yield* tool.execute({ name: "kilo-config", reference: "configuration" }, ctx).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("not a built-in skill")
    }),
  { git: true },
)

it.instance(
  "loads the compact router and only the requested bundled reference with the same skill permission",
  () =>
    Effect.gen(function* () {
      const tool = yield* load()
      expect(ToolJsonSchema.fromTool(tool)).toMatchObject({
        properties: { name: { type: "string" }, reference: { type: "string" } },
        required: ["name"],
      })
      const requests: Parameters<Tool.Context["ask"]>[0][] = []
      const context = {
        ...ctx,
        ask: (req: Parameters<Tool.Context["ask"]>[0]) =>
          Effect.sync(() => {
            requests.push(req)
          }),
      }
      const builtin = BUILTIN_SKILLS.at(0)!
      const root = yield* tool.execute({ name: builtin.name }, context)
      expect(root.output).toContain(builtin.content.trim())
      expect(root.output.length).toBeLessThan(1600)
      expect(root.output).not.toContain("Base directory")
      expect(root.output).not.toContain("<skill_files>")
      const refs = Object.entries(builtin.references!)
      expect(refs).toHaveLength(5)
      for (const [reference, body] of refs) {
        expect(root.output).toContain(`skill({name:"kilo-config",reference:"${reference}"})`)
        expect(root.output).not.toContain(body.split("\n").at(0)!)
        const result = yield* tool.execute({ name: builtin.name, reference }, context)
        expect(result.output).toContain(body.trim())
        expect(result.output).not.toContain(builtin.content.trim())
        expect(result.output).not.toContain("Base directory")
        expect(result.metadata.dir).toBe(Skill.BUILTIN_LOCATION)
        for (const [other, text] of refs) {
          if (other === reference) continue
          expect(result.output).not.toContain(text.split("\n").at(0)!)
        }
      }
      expect(requests).toEqual(
        Array.from({ length: 6 }, () => ({
          permission: "skill",
          patterns: ["kilo-config"],
          always: ["kilo-config"],
          metadata: {},
        })),
      )
    }),
  { git: true },
)

it.instance(
  "rejects unknown references, paths, and inherited object properties",
  () =>
    Effect.gen(function* () {
      const tool = yield* load()
      for (const reference of ["missing", "", "../configuration", "/configuration", "__proto__", "toString"]) {
        const exit = yield* tool.execute({ name: "kilo-config", reference }, ctx).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(`Reference "${reference}" not found`)
      }
    }),
  { git: true },
)

it.instance(
  "skill denial blocks both the router and references",
  () =>
    Effect.gen(function* () {
      const tool = yield* load()
      const permission = yield* Permission.Service
      for (const params of [{ name: "kilo-config" }, { name: "kilo-config", reference: "configuration" }]) {
        const exit = yield* tool
          .execute(params, {
            ...ctx,
            ask: (req) =>
              permission
                .ask({
                  ...req,
                  sessionID: ctx.sessionID,
                  ruleset: Permission.fromConfig({ skill: { "kilo-config": "deny" } }),
                })
                .pipe(Effect.asVoid, Effect.orDie),
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.DeniedError)
      }
    }),
  { git: true },
)

const unix = process.platform !== "win32" ? it.instance : it.instance.skip

unix(
  "rejects references to trusted overrides and other user skills before shell injection",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const global = yield* Global.Service
      const dir = path.join(global.home, ".agents", "skills", `builtin-${crypto.randomUUID()}`)
      yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })))
      for (const name of ["kilo-config", "user-reference"]) {
        const marker = path.join(instance.directory, name)
        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, name, "SKILL.md"),
            `---\nname: ${name}\ndescription: User skill.\n---\n\nUser content.\n\n!\`printf ran > "${marker}"\`\n`,
          ),
        )
      }
      const skill = yield* Skill.Service
      const tool = yield* load()
      for (const name of ["kilo-config", "user-reference"]) {
        expect((yield* skill.require(name)).trusted).toBe(true)
        const requests: Parameters<Tool.Context["ask"]>[0][] = []
        const context = {
          ...ctx,
          ask: (req: Parameters<Tool.Context["ask"]>[0]) =>
            Effect.sync(() => {
              requests.push(req)
            }),
        }
        const marker = path.join(instance.directory, name)
        const exit = yield* tool.execute({ name, reference: "configuration" }, context).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("not a built-in skill")
        expect(requests.map((req) => req.permission)).toEqual(["skill"])
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)

        requests.length = 0
        const result = yield* tool.execute({ name }, context)
        expect(result.output).toContain("User content.")
        expect(result.output).not.toContain('reference:"configuration"')
        expect(requests.map((req) => req.permission)).toEqual(["skill", "bash"])
        expect(yield* Effect.promise(() => Bun.file(marker).text())).toBe("ran")
      }
    }),
  { git: true },
)
