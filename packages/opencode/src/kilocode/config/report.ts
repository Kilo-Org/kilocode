import { Effect } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import { InstanceRef } from "@/effect/instance-ref"
import type { InstanceContext } from "@/project/instance-context"

export async function report(ctx: InstanceContext, message: string) {
  const [{ AppRuntime }, { EventV2Bridge }, { Session }] = await Promise.all([
    import("@/effect/app-runtime"),
    import("@/event-v2-bridge"),
    import("@/session/session"),
  ])
  return AppRuntime.runPromise(
    EventV2Bridge.Service.use((events) =>
      events.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() }),
    ).pipe(Effect.provideService(InstanceRef, ctx)),
  )
}
