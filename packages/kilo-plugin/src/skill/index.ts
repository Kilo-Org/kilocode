import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { define } from "@opencode/plugin/effect/plugin"
import { Event } from "@opencode/schema/config"
import { KiloSkillRpc } from "@opencode/schema/kilocode/skill"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Option, Schedule, Scope } from "effect"
import path from "path"
import { SkillRemove } from "./remove"

// Deletes only the manifest of a skill that a configured skill directory discovered. The config skill plugin
// rescans on `config.updated`, so a removal also reaches the registry and every connected client.
export const KiloSkillPlugin = define<Bus.Service | FSUtil.Service | Global.Service | Scope.Scope>({
  id: "kilocode.skill",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const global = yield* Global.Service
    const fs = yield* FSUtil.Service
    const config = yield* Effect.serviceOption(Config.Service)
    if (Option.isNone(config)) return yield* Effect.die(new Error("Kilo skill removal requires location config"))
    const cache = path.join(global.cache, "skills")

    const roots = Effect.fn("KiloSkillPlugin.roots")(function* () {
      const entries = yield* config.value.entries()
      return SkillRemove.roots(entries, ctx.location.directory, global.home)
    })

    const removable = Effect.fn("KiloSkillPlugin.removable")(function* () {
      const skills = (yield* ctx.skill.list().pipe(Effect.orDie)).data
      return yield* Effect.filter(SkillRemove.targets(skills, yield* roots(), cache), (file) => fs.isFile(file))
    })

    const arrive = Effect.fn("KiloSkillPlugin.arrive")(function* (file: string) {
      const gone = ctx.skill.list().pipe(
        Effect.orDie,
        Effect.map((result) => !result.data.some((skill) => skill.path === file)),
      )
      yield* Effect.repeat(gone, { until: (done) => done, schedule: Schedule.spaced("25 millis") }).pipe(
        Effect.timeout("2 seconds"),
        Effect.ignore,
      )
    })

    yield* ctx.rpc
      .register(KiloSkillRpc.Definition, {
        removable: () => removable(),
        remove: (input, context) =>
          Effect.gen(function* () {
            const skills = (yield* ctx.skill.list().pipe(Effect.orDie)).data
            const result = SkillRemove.target(input.path, skills, yield* roots(), cache)
            if (result._tag === "failure")
              return yield* Effect.fail(
                context.error(
                  result.reason,
                  result.reason === "not_found" ? "Skill not found in the registry" : "Skill cannot be removed",
                ),
              )
            if (!(yield* fs.isFile(result.path)))
              return yield* Effect.fail(context.error("not_removable", "Skill manifest not found"))
            yield* fs
              .remove(result.path)
              .pipe(
                Effect.mapError((error) =>
                  context.error("remove_failed", `Could not remove the skill manifest: ${error.message}`),
                ),
              )
            yield* bus.publish(Event.Updated, {})
            yield* arrive(result.path)
            return {}
          }),
      })
      .pipe(Effect.orDie)
  }),
})
