import { Generate } from "@opencode/core/generate"
import { Service, type Info } from "@opencode/core/model"
import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import { KiloBranchNameRpc } from "@opencode/schema/kilocode/branch-name"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Effect, Option } from "effect"
import { BranchNameGenerate } from "./generate"

// The `kilocode.branch-name` RPC: the recent user messages of a session, then one stateless call that keeps the branch
// naming instructions in the system prompt and the messages in the user prompt. The model is the provider's small model
// when the invoking provider is known, else the title agent model, else the small model of the default provider, else
// the default model.
export const KiloBranchNamePlugin = define({
  id: "kilocode.branch-name",
  effect: Effect.fn("KiloBranchNamePlugin")(function* (ctx) {
    const models = yield* Effect.serviceOption(Service)
    if (Option.isNone(models)) return yield* Effect.die(new Error("Kilo branch names require location models"))
    const generate = yield* Effect.serviceOption(Generate.Service)
    if (Option.isNone(generate)) return yield* Effect.die(new Error("Kilo branch names require stateless generation"))

    const model = Effect.fn("KiloBranchNamePlugin.model")(function* (input: {
      providerID?: string
      modelID?: string
    }) {
      if (input.providerID) {
        const providerID = Provider.ID.make(input.providerID)
        const small = yield* models.value.small(providerID)
        if (small) return reference(small)
        if (input.modelID) {
          const exact = yield* models.value.get(providerID, Model.ID.make(input.modelID))
          if (exact) return reference(exact)
        }
      }

      const available = yield* models.value.available()
      const title = yield* ctx.agent.get({ agentID: Agent.ID.make("title") }).pipe(
        Effect.map((result) => result.data.model),
        Effect.orElseSucceed(() => undefined),
      )
      const configured =
        title && available.find((item) => item.providerID === title.providerID && item.id === title.id)
      if (configured) return reference(configured, title.variant)
      const primary = yield* models.value.default()
      if (!primary) return undefined
      return reference((yield* models.value.small(primary.providerID)) ?? primary)
    })

    const runtime: BranchNameGenerate.Runtime = {
      model,
      text: (input) =>
        generate.value.text({
          prompt: input.prompt,
          system: input.system,
          generation: { temperature: input.temperature },
          ...(input.model ? { model: input.model } : {}),
        }),
    }

    yield* ctx.rpc
      .register(KiloBranchNameRpc.Definition, {
        generate: (input) =>
          Effect.gen(function* () {
            // The plugin reads the session transcript from the location context, so the RPC input carries no history.
            const history = yield* ctx.session.context({ sessionID: input.sessionID }).pipe(Effect.orDie)
            const branch = yield* BranchNameGenerate.generate(
              {
                messages: BranchNameGenerate.messages(BranchNameGenerate.userMessages(history), input.prompt),
                ...(input.providerID ? { providerID: input.providerID } : {}),
                ...(input.modelID ? { modelID: input.modelID } : {}),
              },
              runtime,
            )
            return { branch }
          }),
      })
      .pipe(Effect.orDie)
  }),
})

const MINIMAL = ["none", "minimal", "low"]

function reference(info: Info, variant?: string) {
  const selected = variant ?? MINIMAL.find((id) => info.variants.some((item) => item.id === id))
  return Model.Ref.make({
    providerID: info.providerID,
    id: info.id,
    ...(selected ? { variant: Model.VariantID.make(selected) } : {}),
  })
}
