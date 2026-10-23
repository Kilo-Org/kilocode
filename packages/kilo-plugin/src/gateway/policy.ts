import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Effect, Option, Stream } from "effect"

// Config can add model aliases after Gateway discovery. Apply policy to the final inventory too.
export const KiloGatewayPolicyPlugin = define({
  id: "kilocode.gateway.policy",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Effect.serviceOption(Config.Service)
    if (Option.isNone(config)) return yield* Effect.die(new Error("Kilo Gateway requires location config"))
    const gateway = ctx.rpc(KiloGatewayRpc.Definition)
    let training = new Set<string>()
    let recommended: string | undefined
    const reload = Effect.gen(function* () {
      const policy = yield* KiloConfigPolicy.get(config.value)
      const models = policy.hide_prompt_training_models
        ? yield* gateway.models({}).pipe(Effect.orElseSucceed(() => []))
        : []
      training = new Set(models.filter((model) => model.mayTrainOnYourPrompts === true).map((model) => model.id))
      recommended = models.find((model) => model.recommended)?.id
      yield* ctx.model.reload()
    })
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated" || event.type === "provider.updated"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* reload
    yield* ctx.model.transform((editor) => {
      const selected = editor.default.get()
      const selectedModel = selected && editor.get(selected.providerID, selected.modelID)
      const rejected = selected?.providerID === "kilo" && training.has(selectedModel?.modelID ?? selected.modelID)
      for (const model of editor.list("kilo")) {
        if (training.has(model.modelID ?? model.id)) editor.remove("kilo", model.id)
      }
      if (!rejected) return
      const allowed = editor.list("kilo").filter((model) => model.enabled !== false && model.status === "active")
      const replacement = allowed.find((model) => model.id === recommended) ?? allowed[0]
      if (replacement) editor.default.set("kilo", replacement.id)
    })
  }),
})
