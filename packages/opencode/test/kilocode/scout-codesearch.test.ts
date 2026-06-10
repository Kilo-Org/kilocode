import { afterEach, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { Skill } from "../../src/skill"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const layer = Agent.layer.pipe(
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(RuntimeFlags.layer({ experimentalScout: true })),
)
const it = testEffect(layer)

afterEach(async () => {
  await disposeAllInstances()
})

it.instance("keeps codesearch available to Scout", () =>
  Effect.gen(function* () {
    const scout = yield* Agent.Service.use((service) => service.get("scout"))
    expect(scout).toBeDefined()
    expect(Permission.evaluate("codesearch", "*", scout!.permission).action).toBe("allow")
  }),
)
