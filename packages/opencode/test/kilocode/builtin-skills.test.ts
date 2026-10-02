import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
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
import { ReadTool } from "../../src/tool/read"
import { ToolRegistry } from "../../src/tool/registry"
import { ToolJsonSchema } from "../../src/tool/json-schema"
import * as KiloSkill from "../../src/kilocode/skill-remove"
import { BUILTIN_SKILLS } from "../../src/kilocode/skills/builtin"
import { TestInstance, tmpdir } from "../fixture/fixture"
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
    [
      [
        Global.node,
        Layer.effect(
          Global.Service,
          Effect.gen(function* () {
            const dir = yield* Effect.acquireRelease(
              Effect.promise(() => tmpdir()),
              (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
            )
            return Global.make({ tmp: dir.path })
          }),
        ),
      ],
    ],
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

function load(id: string = SkillTool.id) {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const tool = (yield* registry.tools({
      providerID: ProviderV2.ID.opencode,
      modelID: ModelV2.ID.make("gpt-5"),
      agent: { name: "code", mode: "primary", permission: [], options: {} },
    })).find((tool) => tool.id === id)
    if (!tool) throw new Error(`Tool "${id}" not found`)
    return tool
  })
}

it.instance(
  "built-in skills are present in empty project",
  () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const global = yield* Global.Service
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
        expect(found).not.toHaveProperty("files")
        expect(builtin.description.length).toBeLessThan(160)
        for (const verbose of [true, false]) {
          const catalog = Skill.fmt(skills, { verbose })
          expect(catalog).not.toContain(builtin.content.trim())
          for (const body of Object.values(builtin.files ?? {})) {
            expect(catalog).not.toContain(body.split("\n").at(0)!)
          }
        }
      }
      expect(yield* Effect.promise(() => fs.readdir(global.tmp))).toEqual([])
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
      expect(item!.content).toContain("Use `read`")
      expect(item!.content.length).toBeLessThan(1500)
    }),
  { git: true },
)

it.instance(
  "kilo-config is protected from removal",
  () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const tool = yield* load()
      yield* tool.execute({ name: "kilo-config" }, ctx)
      const item = yield* skill.get("kilo-config")
      expect(item).toBeDefined()
      expect(item!.location).toBe(Skill.BUILTIN_LOCATION)
      expect(KiloSkill.builtin(item!.location)).toBe(true)
      expect(() => KiloSkill.target(item!.location, [item!])).toThrow("cannot remove built-in skill")
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
      const global = yield* Global.Service
      expect(result.metadata.dir).toBe(dir)
      expect(result.output).toContain("User-provided content.")
      expect(result.output).toContain(`Base directory for this skill: ${dir}`)
      for (const builtin of BUILTIN_SKILLS) {
        expect(result.output).not.toContain(builtin.content.trim())
        for (const file of Object.keys(builtin.files ?? {})) {
          expect(result.output).not.toContain(file)
        }
      }
      expect(yield* Effect.promise(() => fs.readdir(global.tmp))).toEqual([])
    }),
  { git: true },
)

it.instance(
  "loads a name-only compact guide and reads only the selected reference with inert shell examples",
  () =>
    Effect.gen(function* () {
      const tool = yield* load()
      expect(ToolJsonSchema.fromTool(tool)).toEqual({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { name: { type: "string", description: "The name of the skill from available_skills" } },
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
      const global = yield* Global.Service
      expect(yield* Effect.promise(() => fs.readdir(global.tmp))).toEqual([])
      const root = yield* tool.execute({ name: builtin.name }, context)
      const dir = root.metadata.dir
      expect(typeof dir).toBe("string")
      if (typeof dir !== "string") throw new Error("Skill directory not found")
      expect(path.isAbsolute(dir)).toBe(true)
      expect(path.dirname(dir)).toBe(path.join(global.tmp, "skills", builtin.name))
      expect(path.basename(dir)).toMatch(/^[a-f0-9]+$/)
      expect(root.output).toContain(builtin.content.trim())
      expect(root.output).toContain(`Base directory for this skill: ${dir}`)
      expect(root.output).toContain("<skill_files>")
      expect(yield* Effect.promise(() => Bun.file(path.join(dir, "SKILL.md")).text())).toBe(builtin.content)
      const refs = Object.entries(builtin.files!)
      expect(refs.map(([file]) => file).sort()).toEqual([
        "references/agent-manager.md",
        "references/configuration.md",
        "references/customization.md",
        "references/tools.md",
        "references/tui.md",
      ])
      for (const [file, body] of refs) {
        expect(root.output).toContain(`](${file})`)
        expect(root.output).toContain(`<file>${path.join(dir, file)}</file>`)
        expect(root.output).not.toContain(body.split("\n").at(0)!)
        expect(yield* Effect.promise(() => Bun.file(path.join(dir, file)).text())).toBe(body)
      }
      expect(requests).toEqual([
        { permission: "skill", patterns: ["kilo-config"], always: ["kilo-config"], metadata: {} },
      ])

      const read = yield* load(ReadTool.id)
      const file = "references/customization.md"
      const result = yield* read.execute({ filePath: path.join(dir, file) }, context)
      expect(result.metadata.display).toMatchObject({ type: "file", text: builtin.files![file].trimEnd() })
      expect(result.output).not.toContain(builtin.content.trim())
      for (const [other, body] of refs) {
        if (other === file) continue
        expect(result.output).not.toContain(body.split("\n").at(0)!)
      }
      expect(result.output).toContain("Finding a named command")
      expect(result.output).toContain("~/.config/kilo/")
      expect(result.output).toContain("~/.kilocode/")
      expect(result.output).toContain("**/command/")
      expect(result.output).toContain("explicit search")
      expect(result.output).toContain("`` !`cmd` ``")
      expect(result.output).not.toContain("[skill shell command failed]")
      expect(requests.map((req) => req.permission)).toEqual(["skill", "external_directory", "read"])
    }),
  { git: true },
)

it.instance(
  "reuses the materialized directory and restores a removed reference",
  () =>
    Effect.gen(function* () {
      const tool = yield* load()
      const builtin = BUILTIN_SKILLS.at(0)!
      const first = yield* tool.execute({ name: builtin.name }, ctx)
      const second = yield* tool.execute({ name: builtin.name }, ctx)
      expect(second.metadata.dir).toBe(first.metadata.dir)
      const dir = first.metadata.dir
      if (typeof dir !== "string") throw new Error("Skill directory not found")
      const file = "references/configuration.md"
      yield* Effect.promise(() => fs.unlink(path.join(dir, file)))
      expect(yield* Effect.promise(() => Bun.file(path.join(dir, file)).exists())).toBe(false)
      const repaired = yield* tool.execute({ name: builtin.name }, ctx)
      expect(repaired.metadata.dir).toBe(dir)
      expect(repaired.output).toContain(`<file>${path.join(dir, file)}</file>`)
      expect(yield* Effect.promise(() => Bun.file(path.join(dir, file)).text())).toBe(builtin.files![file])
    }),
  { git: true },
)

it.instance(
  "skill denial prevents loading and materializing built-in files",
  () =>
    Effect.gen(function* () {
      const tool = yield* load()
      const permission = yield* Permission.Service
      const global = yield* Global.Service
      const exit = yield* tool
        .execute(
          { name: "kilo-config" },
          {
            ...ctx,
            ask: (req) =>
              permission
                .ask({
                  ...req,
                  sessionID: ctx.sessionID,
                  ruleset: Permission.fromConfig({ skill: { "kilo-config": "deny" } }),
                })
                .pipe(Effect.asVoid, Effect.orDie),
          },
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.DeniedError)
      expect(yield* Effect.promise(() => fs.readdir(global.tmp))).toEqual([])
    }),
  { git: true },
)

it.instance(
  "reading a bundled reference honors ordinary read permission denial",
  () =>
    Effect.gen(function* () {
      const tool = yield* load()
      const root = yield* tool.execute({ name: "kilo-config" }, ctx)
      const dir = root.metadata.dir
      if (typeof dir !== "string") throw new Error("Skill directory not found")
      const read = yield* load(ReadTool.id)
      const permission = yield* Permission.Service
      const requests: Parameters<Tool.Context["ask"]>[0][] = []
      const exit = yield* read
        .execute(
          { filePath: path.join(dir, "references/configuration.md") },
          {
            ...ctx,
            ask: (req) =>
              Effect.gen(function* () {
                requests.push(req)
                yield* permission.ask({
                  ...req,
                  sessionID: ctx.sessionID,
                  ruleset: Permission.fromConfig({ external_directory: "allow", read: "deny" }),
                })
              }).pipe(Effect.orDie),
          },
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.DeniedError)
      expect(requests.map((req) => req.permission)).toEqual(["external_directory", "read"])
    }),
  { git: true },
)
