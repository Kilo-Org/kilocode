import { describe, expect, test } from "bun:test"
import type { SessionConfigOption } from "@agentclientprotocol/sdk"
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
    { id: "code", name: "Code", variant: "high" },
    { id: "ask", name: "Ask" },
  ],
  defaultModeID: "code",
  availableCommands: [],
  defaultModel: model,
}

const sdk = {} as KiloClient

function services(input: { sdk?: KiloClient; snapshot?: Directory.Snapshot } = {}) {
  const snap = input.snapshot ?? snapshot
  const directory: Directory.Interface = {
    get: () => Effect.succeed(snap),
    refresh: () => Effect.succeed(snap),
    variants: Directory.variants,
  }
  const runtime = ManagedRuntime.make(ACPSession.defaultLayer)
  const session = runtime.runSync(ACPSession.Service.use((service) => Effect.succeed(service)))
  const service = ACPService.make({ sdk: input.sdk ?? sdk, directory, session })
  return { session, service }
}

function createSdk(calls: unknown[]) {
  return {
    session: {
      create: (input: unknown) => {
        calls.push(input)
        return Promise.resolve({ data: { id: "session-a" } })
      },
    },
  } as unknown as KiloClient
}

function promptSdk(calls: unknown[]) {
  return {
    session: {
      prompt: (input: unknown) => {
        calls.push(input)
        return Promise.resolve({ data: {} })
      },
    },
  } as unknown as KiloClient
}

function option(result: { configOptions?: readonly SessionConfigOption[] | null }, id: string) {
  return result.configOptions?.find(
    (item): item is Extract<SessionConfigOption, { type: "select" }> => item.id === id && item.type === "select",
  )
}

describe("ACP service mode variants", () => {
  test("uses configured default mode variant for new sessions", async () => {
    const calls: unknown[] = []
    const state = services({ sdk: createSdk(calls) })

    const result = await Effect.runPromise(state.service.newSession({ cwd: snapshot.directory, mcpServers: [] }))

    expect(calls).toEqual([
      {
        directory: snapshot.directory,
        agent: "code",
        model: {
          providerID,
          id: modelID,
          variant: "high",
        },
      },
    ])
    expect(option(result, "effort")?.currentValue).toBe("high")
  })

  test("uses configured mode variant when prompting without an explicit session variant", async () => {
    const calls: unknown[] = []
    const state = services({ sdk: promptSdk(calls) })
    await Effect.runPromise(state.session.create({ id: "session-a", cwd: snapshot.directory, model, modeId: "code" }))

    await Effect.runPromise(
      state.service.prompt({ sessionId: "session-a", prompt: [{ type: "text", text: "hello" }] }),
    )

    expect(calls).toEqual([
      {
        sessionID: "session-a",
        model: { providerID, modelID },
        variant: "high",
        parts: [{ type: "text", text: "hello" }],
        agent: "code",
        directory: snapshot.directory,
      },
    ])
  })

  test("shows configured mode variant after clearing stale variants on mode switch", async () => {
    const state = services()
    await Effect.runPromise(state.session.create({ id: "session-a", cwd: snapshot.directory, model, variant: "default" }))

    const result = await Effect.runPromise(
      state.service.setSessionConfigOption({ sessionId: "session-a", configId: "mode", value: "code" }),
    )

    expect(await Effect.runPromise(state.session.getMode("session-a"))).toBe("code")
    expect(await Effect.runPromise(state.session.getVariant("session-a"))).toBeUndefined()
    expect(option(result, "effort")?.currentValue).toBe("high")
  })

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
