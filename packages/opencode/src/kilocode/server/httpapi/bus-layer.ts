import { Bus } from "@/bus"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { Context, Effect, Layer } from "effect"

// `Server.listen` builds each listener's layer stack with a fresh MemoMap, but
// app code publishes through the module-level `Bus.publish` wrappers, whose
// `makeRuntime` runtime memoizes `Bus.layer` in the global `memoMap`. A Bus
// built per listener would have its own PubSubs, so SSE subscribers on that
// listener would never see those events. This layer ignores the caller's
// MemoMap and builds Bus through the global one, so every listener, the
// in-process handler, and the module-level wrappers share one Bus instance.
//
// The `Context.make` narrowing is required: `buildWithMemoMap` adds
// `CurrentMemoMap` (the global map) to the built context, and leaking it into
// the listener's context would change memoization for unrelated layers.
export const sharedBusLayer = Layer.fromBuild((_, scope) =>
  Layer.buildWithMemoMap(Bus.layer, memoMap, scope).pipe(
    Effect.map((ctx) => Context.make(Bus.Service, Context.get(ctx, Bus.Service))),
  ),
)
