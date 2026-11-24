export * as GatewayAutoPreview from "./auto-preview.js"

import { KiloAutoPreview } from "@kilocode/gateway-core"
import type { RpcHandlers } from "@opencode/plugin/effect/rpc"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type { Model } from "@opencode/schema/model"
import { Effect } from "effect"

type Methods = RpcHandlers<typeof KiloGatewayRpc.Definition>

export interface HandlerInput {
  readonly models: Effect.Effect<readonly Model.Info[]>
}

export function handlers(input: HandlerInput): Pick<Methods, "autoModel.preview"> {
  return {
    "autoModel.preview": (args, context) =>
      Effect.gen(function* () {
        const prompt = args.prompt.trim()
        if (!prompt)
          return yield* Effect.fail(context.error("failed", "Prompt is required to preview Auto Model selection"))
        const current = args.currentModel ? yield* resolveCurrentModel(args.currentModel, input.models) : undefined
        return KiloAutoPreview.preview({
          prompt,
          ...(args.agent ? { agent: args.agent } : {}),
          ...(current ? { currentModel: current } : {}),
          ...(args.profile ? { profile: args.profile } : {}),
        })
      }),
  }
}

function resolveCurrentModel(
  ref: NonNullable<KiloGatewayRpc.AutoModelPreviewInput["currentModel"]>,
  models: Effect.Effect<readonly Model.Info[]>,
) {
  return Effect.gen(function* () {
    const list = yield* models
    const found = list.find((item) => item.providerID === ref.providerID && item.id === ref.id)
    const cost = found?.cost.find((item) => item.tier === undefined) ?? found?.cost[0]
    return {
      providerID: ref.providerID,
      id: ref.id,
      ...(ref.name ?? found?.name ? { name: ref.name ?? found?.name } : {}),
      ...(cost ? { cost: { input: cost.input, output: cost.output } } : {}),
    }
  })
}
