import { describe, expect } from "bun:test"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SkillPlugin } from "@opencode/core/plugin/skill"
import { Skill } from "@opencode/core/skill"
import { Document, Info } from "@opencode/schema/config"
import { AbsolutePath } from "@opencode/schema/schema"
import { Effect, Layer, Stream } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { host } from "../../core/test/plugin/host"
import { KiloSkillConfigPlugin } from "../src/skill/config"

const it = testEffect(AppNodeBuilder.build(Skill.node))
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () => Effect.succeed([new Document({ type: "document", info: new Info({}) })]),
    changes: () => Stream.never,
  }),
)
const context = (skill: Skill.Interface) =>
  host({
    app: { name: "kilo2", version: "1.2.3", channel: "beta" },
    skill: {
      list: () => Effect.die("unused skill.list"),
      transform: skill.transform,
      reload: skill.reload,
    },
  })

describe("Kilo builtin config skill", () => {
  it.effect("hides the upstream built-in skills and registers the Kilo config guide", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const ctx = context(skill)
      yield* SkillPlugin.Plugin.effect(ctx).pipe(Effect.provide(config))
      expect((yield* skill.list()).map((item) => String(item.id))).toEqual(["opencode", "report"])

      yield* KiloSkillConfigPlugin.Plugin.effect(ctx)
      const items = yield* skill.list()
      expect(items.map((item) => String(item.id))).toEqual(["kilo-config"])
      expect(String(items[0]?.name)).toBe("kilo-config")
      expect(items[0]?.path).toBe(AbsolutePath.make("/builtin/kilo-config.md"))
      expect(items[0]?.description).toContain("kilo2.json")
      expect(items[0]?.description).toContain("/periodic")
      expect(items[0]?.description).toContain("service install")
      expect(items[0]?.content).toContain("kilo2.json")
      expect(items[0]?.content).toContain(".kilo2")
      expect(items[0]?.content).toContain("KILO2_CONFIG")
      expect(items[0]?.content).toContain("/periodic")
      expect(items[0]?.content).toContain("flow_create")
      expect(items[0]?.content).toContain("schedule_wakeup")
      expect(items[0]?.content).toContain("service install")
      expect(items[0]?.content).toContain("press `r` to repair")
    }),
  )

  it.effect("keeps a user skill that overrides the built-in config guide", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const ctx = context(skill)
      yield* SkillPlugin.Plugin.effect(ctx).pipe(Effect.provide(config))
      yield* KiloSkillConfigPlugin.Plugin.effect(ctx)
      yield* skill.transform((editor) => {
        editor.add(
          Skill.Info.make({
            id: Skill.ID.make("kilo-config"),
            name: Skill.Name.make("kilo-config"),
            description: "User override",
            path: AbsolutePath.make("/repo/.kilo2/skills/kilo-config/SKILL.md"),
            content: "User content",
          }),
        )
      })

      const items = yield* skill.list()
      expect(items).toHaveLength(1)
      expect(items[0]?.description).toBe("User override")
      expect(items[0]?.path).toBe(AbsolutePath.make("/repo/.kilo2/skills/kilo-config/SKILL.md"))
    }),
  )
})
