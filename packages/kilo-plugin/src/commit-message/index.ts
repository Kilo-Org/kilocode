import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Model } from "@opencode/core/model"
import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import { KiloCommitMessageRpc } from "@opencode/schema/kilocode/commit-message"
import { Effect, Option } from "effect"
import { CommitMessageGenerate } from "./generate"
import { CommitMessageGit } from "./git-context"

// The `kilocode.commit-message` RPC: the git context of a repository, then one `generate.text` call with the commit
// message instructions. The custom prompt is the `commit_message.prompt` config key of the location.
export const KiloCommitMessagePlugin = define({
  id: "kilocode.commit-message",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Effect.serviceOption(Config.Service)
    const models = yield* Effect.serviceOption(Model.Service)
    if (Option.isNone(config) || Option.isNone(models))
      return yield* Effect.die(new Error("Kilo commit messages require location config and models"))

    // The configured small model (`small_model` becomes the title agent model) when it is available, else the small
    // model of the default provider (the host gates the Kilo small model on Kilo credentials, so a local-only setup
    // keeps its own provider), else the default model. A model without a configured variant runs at its lowest
    // reasoning variant.
    const model = Effect.fn("KiloCommitMessagePlugin.model")(function* () {
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

    const runtime: CommitMessageGenerate.Runtime = {
      context: (path, selectedFiles) => Effect.sync(() => CommitMessageGit.getGitContext(path, selectedFiles)),
      model,
      text: (input) => ctx.generate.text(input).pipe(Effect.map((result) => result.text)),
    }

    yield* ctx.rpc
      .register(KiloCommitMessageRpc.Definition, {
        generate: (input, context) =>
          Effect.gen(function* () {
            const prompt = KiloConfigPolicy.commitMessagePrompt(yield* config.value.entries())
            return yield* CommitMessageGenerate.generate({ ...input, prompt }, runtime).pipe(
              Effect.mapError((error) =>
                error._tag === "CommitMessage.NoChangesError"
                  ? context.error("no_changes", error.message)
                  : context.error("failed", error.message),
              ),
            )
          }),
      })
      .pipe(Effect.orDie)
  }),
})

const MINIMAL = ["none", "minimal", "low"]

function reference(info: Model.Info, variant?: string) {
  const selected = variant ?? MINIMAL.find((id) => info.variants.some((item) => item.id === id))
  return Model.Ref.make({
    providerID: info.providerID,
    id: info.id,
    ...(selected ? { variant: Model.VariantID.make(selected) } : {}),
  })
}
