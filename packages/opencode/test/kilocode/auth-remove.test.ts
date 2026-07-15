import { expect } from "bun:test"
import { Auth } from "@/auth"
import { remove } from "@/kilocode/auth/remove"
import { ConnectorSchema } from "@opencode-ai/core/connector/schema"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

const database = Database.layerFromPath(":memory:")
const events = Layer.mock(EventV2.Service)({
  publish: (definition, data) =>
    Effect.succeed({ id: EventV2.ID.create(), type: definition.type, data }),
})
const credentials = Credential.layer.pipe(Layer.provide(database), Layer.provide(events))
const state = { removed: false }
const auth = Layer.mock(Auth.Service)({
  remove: () => Effect.sync(() => void (state.removed = true)),
})
const it = testEffect(Layer.mergeAll(database, credentials, auth))

it.effect("legacy provider logout removes every Core credential", () =>
  Effect.gen(function* () {
    state.removed = false
    const service = yield* Credential.Service
    const connectorID = ConnectorSchema.ID.make("anthropic")
    yield* service.create({
      connectorID,
      methodID: ConnectorSchema.MethodID.make("api-key"),
      label: "first",
      value: new Credential.Key({ type: "key", key: "first" }),
    })
    yield* service.create({
      connectorID,
      methodID: ConnectorSchema.MethodID.make("api-key"),
      label: "second",
      value: new Credential.Key({ type: "key", key: "second" }),
    })

    yield* remove("anthropic")

    expect(yield* service.forConnector(connectorID)).toEqual([])
    expect(yield* service.active(connectorID)).toBeUndefined()
    expect(state.removed).toBe(true)
  }),
)
