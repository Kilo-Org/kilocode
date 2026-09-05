import { disabledIndexingStatus } from "@kilocode/indexing/status"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import { IndexingRpc } from "./indexing-rpc"

/** Publish actual disabled status without importing or starting the indexing engine. */
export function createDisabledIndexingPlugin() {
  return define({
    id: "kilo.indexing-status",
    effect: (ctx) =>
      ctx.rpc
        .register(IndexingRpc, {
          status: () => Effect.succeed(disabledIndexingStatus("Codebase indexing is disabled for this project.")),
        })
        .pipe(Effect.asVoid, Effect.orDie),
  })
}
