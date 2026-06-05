import { describe, expect, test } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2"
import { Effect, ManagedRuntime } from "effect"
import { Directory } from "../../src/acp/directory"
import * as ACPService from "../../src/acp/service"
import { ACPSession } from "../../src/acp/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "../../src/provider/provider"

const providerID = ProviderID.make("test")
const modelID = ModelID.make("test-model")
const model = { providerID, modelID }
const variants = { default: {}, high: {} }
const provider = {
  id: providerID,
  name: "Test",
  models: {
    [modelID]: {
      id: modelID,
      name: "Test Model",
      variants,
    },
  },
} as unknown as Provider.Info

const snapshot: Directory.Snapshot = {
  directory: "/tmp/project",
  providers: { [providerID]: provider },
  modelOptions: [{ providerID, providerName: "Test", modelID, modelName: "Test Model" }],
  variantsByModel: { [Directory.modelKey(model)]: variants },
  availableModes: [
    { id: "code", name: "Code" },
    { id: "ask", name: "Ask" },
  ],
  defaultModeID: "code",
  availableCommands: [],
  defaultModel: model,
}

const directory: Directory.Interface = {
  get: () => Effect.succeed(snapshot),
  refresh: () => Effect.succeed(snapshot),
  variants: Directory.variants,
}

const sdk = {} as KiloClient

function services() {
  const runtime = ManagedRuntime.make(ACPSession.defaultLayer)
  const session = runtime.runSync(ACPSession.Service.use((service) => Effect.succeed(service)))
  const service = ACPService.make({ sdk, directory, session })
  return { session, service }
}

describe("ACP service mode variants", () => {
  test("clears stale variants when changing the mode config option", async () => {
    const state = services()
    await Effect.runPromise(state.session.create({ id: "session-a", cwd: snapshot.directory, model, variant: "high" }))

    await Effect.runPromise(state.service.setSessionConfigOption({ sessionId: "session-a", configId: "mode", value: "ask" }))

    expect(await Effect.runPromise(state.session.getMode("session-a"))).toBe("ask")
    expect(await Effect.runPromise(state.session.getVariant("session-a"))).toBeUndefined()
  })

  test("clears stale variants when setting the session mode directly", async () => {
    const state = services()
    await Effect.runPromise(state.session.create({ id: "session-a", cwd: snapshot.directory, model, variant: "high" }))

    await Effect.runPromise(state.service.setSessionMode({ sessionId: "session-a", modeId: "ask" }))

    expect(await Effect.runPromise(state.session.getMode("session-a"))).toBe("ask")
    expect(await Effect.runPromise(state.session.getVariant("session-a"))).toBeUndefined()
  })

  test("preserves variants when restoring mode state", async () => {
    const state = services()
    await Effect.runPromise(state.session.create({ id: "session-a", cwd: snapshot.directory, model, variant: "high" }))

    await Effect.runPromise(state.session.setMode("session-a", "ask"))

    expect(await Effect.runPromise(state.session.getMode("session-a"))).toBe("ask")
    expect(await Effect.runPromise(state.session.getVariant("session-a"))).toBe("high")
  })
})
