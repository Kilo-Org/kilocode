import * as InstanceState from "@/effect/instance-state"
import { AgentBuilder } from "@/kilocode/agent/builder"
import { InstanceStore } from "@/project/instance-store"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AgentBuilderID, AgentBuilderInput, AgentBuilderSaveInput } from "../groups/agent-builder"

export const agentBuilderHandlers = HttpApiBuilder.group(InstanceHttpApi, "agent-builder", (handlers) =>
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service

    const preview = Effect.fn("AgentBuilderHttpApi.preview")(function* (ctx: {
      payload: typeof AgentBuilderInput.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() => AgentBuilder.preview(instance, normalize(ctx.payload)))
    })

    const save = Effect.fn("AgentBuilderHttpApi.save")(function* (ctx: {
      params: { id: typeof AgentBuilderID.Type }
      payload: typeof AgentBuilderSaveInput.Type
    }) {
      const instance = yield* InstanceState.context
      const input = normalize({ ...ctx.payload, id: ctx.params.id })
      const output = yield* Effect.promise(() => AgentBuilder.save(instance, input))
      yield* store.dispose(instance)
      return output
    })

    return handlers.handle("preview", preview).handle("save", save)
  }),
)

function normalize(input: typeof AgentBuilderInput.Type): AgentBuilder.Input {
  return {
    ...input,
    scope: input.scope ?? "project",
    mode: input.mode ?? "primary",
    prompt: input.prompt.trim(),
    tools: input.tools ? [...input.tools] : undefined,
  }
}
