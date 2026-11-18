export * as KiloWorkflowDelivery from "./workflow-delivery.js"

import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Agent } from "../../agent.js"
import type { PublishInput } from "../../bus.js"
import { Model } from "../../model.js"
import { AgentNotFoundError } from "../../session/error.js"
import { SessionInbox } from "../../session/inbox.js"
import { SessionEvent } from "../../session/event.js"
import { SessionRunnerModel } from "../../session/runner/model.js"
import { SessionStore } from "../../session/store.js"
import { SessionStored } from "../../session/stored.js"

const decode = Schema.decodeUnknownSync(Schema.Struct({ selection: SessionStored.UserPayload.fields.selection }))
const selectionFor = (row: SessionInbox.Pending) => (row.type === "user" ? decode(row.payload).selection : undefined)

export const override: LayerNode.Replacement = SessionInbox.policyNode.replace(
  makeLocationNode({
    service: SessionInbox.Policy,
    deps: [Agent.node, Model.node, SessionStore.node],
    layer: Layer.effect(
      SessionInbox.Policy,
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const models = yield* Model.Service
        const store = yield* SessionStore.Service
        return SessionInbox.Policy.of({
          policy: {
            batchSize(rows, after) {
              // Prompts with distinct selections must not be delivered to the same model step.
              if (after && selectionFor(after)) return 0
              const index = rows.findIndex((row) => selectionFor(row) !== undefined)
              return index === -1 ? rows.length : Math.max(after ? 0 : 1, index)
            },
            prepare: Effect.fn("KiloWorkflowDelivery.prepare")(function* (sessionID, row) {
              const selection = selectionFor(row)
              if (!selection) return

              if (selection.agent && !(yield* agents.get(selection.agent)))
                return yield* new AgentNotFoundError({ sessionID, agent: selection.agent })
              const model = selection.model
              if (
                model &&
                !(yield* models.available()).some(
                  (item) => item.providerID === model.providerID && item.id === model.id,
                )
              )
                return yield* new SessionRunnerModel.ModelUnavailableError({
                  providerID: model.providerID,
                  modelID: model.id,
                })

              const current = yield* store.get(sessionID)
              const events: PublishInput[] = []
              if (selection.agent && selection.agent !== current?.agent)
                events.push([SessionEvent.AgentSelected, { sessionID, agent: selection.agent }])

              const previous = current?.model
              if (
                model &&
                (!previous ||
                  model.providerID !== previous.providerID ||
                  model.id !== previous.id ||
                  (model.variant ?? "default") !== (previous.variant ?? "default"))
              )
                events.push([SessionEvent.ModelSelected, { sessionID, model }])

              const [first, ...rest] = events
              return first ? [first, ...rest] : undefined
            }),
          },
        })
      }),
    ),
  }),
)
