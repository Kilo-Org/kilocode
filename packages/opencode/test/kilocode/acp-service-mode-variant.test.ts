import { describe, expect, test } from "bun:test"
import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import type { KiloClient } from "@kilocode/sdk/v2"
import { Effect, ManagedRuntime } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Directory } from "../../src/acp/directory"
import * as ACPService from "../../src/acp/service"
import { ACPSession } from "../../src/acp/session"
import type { Provider } from "../../src/provider/provider"

const providerID = ProviderV2.ID.make("test")
const modelID = ModelV2.ID.make("test-model")
const model = { providerID, modelID }
const variants = { default: {}, high: {}, low: {} }
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
  availableCommands: [{ name: "init", description: "Initialize", source: "command", template: "", hints: [] }],
  defaultModel: model,
}

const lowSnapshot: Directory.Snapshot = {
  ...snapshot,
  availableModes: [{ id: "code", name: "Code", variant: "low" }],
  availableCommands: [],
}

const staleSnapshot: Directory.Snapshot = {
  ...snapshot,
  availableModes: [{ id: "code", name: "Code", variant: "default" }],
  availableCommands: [],
}

const sdk = {} as KiloClient

function services(input: { sdk?: KiloClient; snapshot?: Directory.Snapshot; directory?: Directory.Interface } = {}) {
  const snap = input.snapshot ?? snapshot
  const directory = input.directory ?? {
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

function sessionSdk(calls: { prompts: Array<{ variant?: string }>; commands: Array<{ variant?: string }> }) {
  const ids = ["session-high", "session-low"]
  return {
    session: {
      create: () => Promise.resolve({ data: { id: ids.shift() ?? "session-extra" } }),
      get: () => Promise.resolve({ data: {} }),
      messages: () => Promise.resolve({ data: [] }),
      prompt: (input: { variant?: string }) => {
        calls.prompts.push(input)
        return Promise.resolve({ data: {} })
      },
      command: (input: { variant?: string }) => {
        calls.commands.push(input)
        return Promise.resolve({ data: {} })
      },
      fork: () => Promise.resolve({ data: { id: "session-fork" } }),
    },
    mcp: {
      add: () => Promise.resolve({ data: {} }),
    },
  } as unknown as KiloClient
}

function refreshed(items: readonly Directory.Snapshot[]) {
  const snapshots = [...items]
  const calls: string[] = []
  const directory: Directory.Interface = {
    get: () => {
      calls.push("get")
      return Effect.succeed(staleSnapshot)
    },
    refresh: () => {
      calls.push("refresh")
      const snapshot = snapshots.shift()
      if (snapshot) return Effect.succeed(snapshot)
      return Effect.die(new Error("unexpected directory refresh"))
    },
    variants: Directory.variants,
  }
  return { calls, directory }
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

  test("refreshes the snapshot for each new session", async () => {
    const source = refreshed([snapshot, lowSnapshot])
    const state = services({
      sdk: sessionSdk({ prompts: [], commands: [] }),
      directory: source.directory,
    })

    const high = await Effect.runPromise(state.service.newSession({ cwd: snapshot.directory, mcpServers: [] }))
    const low = await Effect.runPromise(state.service.newSession({ cwd: snapshot.directory, mcpServers: [] }))

    expect(option(high, "effort")?.currentValue).toBe("high")
    expect(option(low, "effort")?.currentValue).toBe("low")
    expect(source.calls).toEqual(["refresh", "refresh"])
  })

  test("refreshes the snapshot for load resume and fork boundaries", async () => {
    for (const run of [
      (service: ACPService.Interface) => service.loadSession({ cwd: snapshot.directory, sessionId: "session-load", mcpServers: [] }),
      (service: ACPService.Interface) => service.resumeSession({ cwd: snapshot.directory, sessionId: "session-resume", mcpServers: [] }),
      (service: ACPService.Interface) => service.forkSession({ cwd: snapshot.directory, sessionId: "session-parent", mcpServers: [] }),
    ]) {
      const source = refreshed([snapshot])
      const state = services({
        sdk: sessionSdk({ prompts: [], commands: [] }),
        directory: source.directory,
      })

      const result = await Effect.runPromise(run(state.service))

      expect(option(result, "effort")?.currentValue).toBe("high")
      expect(source.calls).toEqual(["refresh"])
    }
  })

  test("keeps an active session snapshot after a later load", async () => {
    const calls: { prompts: Array<{ variant?: string }>; commands: Array<{ variant?: string }> } = {
      prompts: [],
      commands: [],
    }
    const source = refreshed([snapshot, lowSnapshot])
    const state = services({ sdk: sessionSdk(calls), directory: source.directory })
    const created = await Effect.runPromise(state.service.newSession({ cwd: snapshot.directory, mcpServers: [] }))
    await Effect.runPromise(state.session.setVariant(created.sessionId, undefined))
    await Effect.runPromise(state.service.loadSession({ cwd: snapshot.directory, sessionId: "session-load", mcpServers: [] }))

    await Effect.runPromise(
      state.service.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "hello" }] }),
    )
    await Effect.runPromise(
      state.service.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "/init" }] }),
    )

    expect(calls.prompts[0]?.variant).toBe("high")
    expect(calls.commands[0]?.variant).toBe("high")
    expect(source.calls).toEqual(["refresh", "refresh"])
  })
})
