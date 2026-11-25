// End-to-end scope recovery: draft pruning across Wave-1/Wave-2 catalog reloads and auto-clearing stale banner
// failures on auth/catalog recovery without hiding brand-new post-recovery errors.
import { describe, expect, mock, test } from "bun:test"
import { ClientError, type ModelInfo, type ModelRef, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"

const CLIENT_SOLID = "solid-js/dist/solid.js"
await mock.module("solid-js", () => import(CLIENT_SOLID))
const CLIENT_STORE = "solid-js/store/dist/store.js"
await mock.module("solid-js/store", () => import(CLIENT_STORE))

const { createRoot, createSignal } = await import("solid-js")
const { events } = await import("../webview-ui/src/v2/events")
const { createV2Scope } = await import("../webview-ui/src/v2/scope")

const DIRECTORY = "/workspace"
const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

function modelInfo(providerID: string, id: string, enabled = true): ModelInfo {
  return {
    id,
    modelID: id,
    providerID,
    name: id,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled,
    limit: { context: 200_000, output: 32_000 },
  } as unknown as ModelInfo
}

function switchedEvent(integrationID: string, credentialID: string | null) {
  return {
    id: `evt_switch_${Date.now()}_${Math.random()}`,
    created: Date.now(),
    type: "credential.switched",
    data: { integrationID, credentialID },
  } as unknown as OpenCodeEvent
}

function catalogEvent(type: "model.updated" | "provider.updated") {
  return {
    id: `evt_${type}_${Date.now()}_${Math.random()}`,
    created: Date.now(),
    type,
    location: { directory: DIRECTORY },
    data: {},
  } as unknown as OpenCodeEvent
}

function makeScope(initialModels: ModelInfo[]) {
  const event = events()
  const state = {
    models: initialModels,
    kiloFailure: null as KiloGatewayRpc.CatalogFailure | null,
  }
  const api = {
    session: { list: async () => ({ data: [] }) },
    plugin: { list: async () => ({ data: [{ id: "kilocode.handshake" }] }) },
    model: {
      list: async () => ({ location: { directory: DIRECTORY }, data: [...state.models] }),
    },
    provider: {
      list: async () => ({ location: { directory: DIRECTORY }, data: [] }),
    },
    rpc: () => ({
      get: async () => ({ version: "1.2.3" }),
      "catalog.status": async () => ({ failure: state.kiloFailure }),
      models: async () => [],
      authStatus: async () => ({ authenticated: true, organizationID: null }),
    }),
  } as unknown as OpenCodeClient
  const [status] = createSignal<"connected">("connected")
  const setup = createRoot((dispose) => ({
    scope: createV2Scope({
      api,
      connection: { status } as unknown as Parameters<typeof createV2Scope>[0]["connection"],
      event,
      directory: DIRECTORY,
      bindings: () => ({}),
      selection: () => false,
      chat: false,
      onCommand: () => {},
      open: () => {},
    }),
    dispose,
  }))
  return { ...setup, event, state }
}

describe("scope draft revalidation on catalog reload", () => {
  test("preserves drafts across empty Wave-1 reload and prunes stale/disabled drafts once Wave-2 settles", async () => {
    const free: ModelRef = { providerID: "kilo", id: "kilo-auto/free" }
    const claude: ModelRef = { providerID: "kilo", id: "claude-sonnet-4" }
    const disabled: ModelRef = { providerID: "kilo", id: "legacy-model" }
    const committing: ModelRef = { providerID: "kilo", id: "in-flight-model" }

    const setup = makeScope([modelInfo("kilo", "kilo-auto/free"), modelInfo("kilo", "claude-sonnet-4")])
    try {
      await setup.scope.data.location.model.sync()
      setup.scope.drafts.set("ses_stale", free, undefined)
      setup.scope.drafts.set("ses_valid", claude, undefined)
      setup.scope.drafts.set("ses_disabled", disabled, undefined)
      setup.scope.drafts.set("ses_committing", committing, undefined)
      setup.scope.drafts.commit("ses_committing", committing)

      // Wave 1: catalog temporarily empties on credential.switched — drafts must NOT be wiped transiently.
      setup.state.models = []
      setup.event.emit(switchedEvent("kilo", "cred_2"))
      await tick()
      expect(setup.scope.data.location.model.list()).toEqual([])
      expect(setup.scope.drafts.get("ses_stale")).toEqual(free)
      expect(setup.scope.drafts.get("ses_valid")).toEqual(claude)
      expect(setup.scope.drafts.get("ses_disabled")).toEqual(disabled)
      expect(setup.scope.drafts.get("ses_committing")).toEqual(committing)

      // Wave 2: authenticated team catalog lands without kilo-auto/free and with legacy-model disabled.
      setup.state.models = [modelInfo("kilo", "claude-sonnet-4", true), modelInfo("kilo", "legacy-model", false)]
      setup.event.emit(catalogEvent("model.updated"))
      await tick()

      expect(setup.scope.drafts.get("ses_stale")).toBeUndefined()
      expect(setup.scope.drafts.get("ses_disabled")).toBeUndefined()
      expect(setup.scope.drafts.get("ses_valid")).toEqual(claude)
      expect(setup.scope.drafts.get("ses_committing")).toEqual(committing)
    } finally {
      setup.dispose()
    }
  })
})

describe("scope failure clearing on auth/catalog recovery", () => {
  test("clears pre-login and Wave-1 failures after credential.switched + catalog recovery without hiding post-recovery errors", async () => {
    const setup = makeScope([modelInfo("kilo", "kilo-auto/free")])
    try {
      await setup.scope.data.location.model.sync()

      // Pre-login error reported during 401 / logout
      setup.scope.report(new ClientError("UnexpectedStatus", { cause: { status: 401 }, detail: "401" }))
      expect(setup.scope.failure()?.auth).toBe(true)

      // Wave 1: credential.switched empties catalog transiently — failure stays until models recover
      setup.state.models = []
      setup.event.emit(switchedEvent("kilo", "cred_new"))
      await tick()
      expect(setup.scope.failure()).toBeDefined()

      // Transient Wave-1 error reported while catalog is empty
      setup.scope.report(new Error("Model unavailable during Wave 1"))
      expect(setup.scope.failure()?.message).toBe("Model unavailable during Wave 1")

      // Wave 2: usable models return -> stale Wave-1 failure clears automatically
      setup.state.models = [modelInfo("kilo", "claude-sonnet-4")]
      setup.event.emit(catalogEvent("model.updated"))
      await tick()
      expect(setup.scope.failure()).toBeUndefined()

      // Brand-new post-recovery error must remain visible, even across later periodic model refreshes
      setup.scope.report(new Error("Brand new post-recovery failure"))
      expect(setup.scope.failure()?.message).toBe("Brand new post-recovery failure")

      setup.event.emit(catalogEvent("model.updated"))
      await tick()
      expect(setup.scope.failure()?.message).toBe("Brand new post-recovery failure")
    } finally {
      setup.dispose()
    }
  })

  test("preserves recovery across a multi-provider Wave 1 where another provider remains enabled", async () => {
    const setup = makeScope([modelInfo("openai", "gpt-5"), modelInfo("kilo", "claude-sonnet-4")])
    try {
      await setup.scope.data.location.model.sync()
      setup.scope.report({ type: "provider.auth", message: "Kilo token expired" })
      expect(setup.scope.failure()?.auth).toBe(true)

      // Wave 1: Kilo temporarily disappears while OpenAI stays present
      setup.state.models = [modelInfo("openai", "gpt-5")]
      setup.event.emit(switchedEvent("kilo", "cred_new"))
      await tick()
      expect(setup.scope.failure()).toBeUndefined()

      // Transient error during Kilo Wave 1 before Kilo returns in Wave 2
      setup.scope.report(new Error("Kilo Wave 1 error"))
      expect(setup.scope.failure()?.message).toBe("Kilo Wave 1 error")

      // Wave 2: Kilo models return -> clears Wave-1 error and ends recovery window
      setup.state.models = [modelInfo("openai", "gpt-5"), modelInfo("kilo", "claude-sonnet-4")]
      setup.event.emit(catalogEvent("model.updated"))
      await tick()
      expect(setup.scope.failure()).toBeUndefined()

      // Post-recovery error is not hidden
      setup.scope.report(new Error("Post-recovery error"))
      setup.event.emit(catalogEvent("model.updated"))
      await tick()
      expect(setup.scope.failure()?.message).toBe("Post-recovery error")
    } finally {
      setup.dispose()
    }
  })

  test("clears stale failure when model.updated recovers from an empty catalog, but not when only disabled models arrive", async () => {
    const setup = makeScope([])
    try {
      await setup.scope.data.location.model.sync()
      setup.scope.report(new Error("No usable models"))
      expect(setup.scope.failure()?.message).toBe("No usable models")

      // Catalog updates with only disabled models -> still not usable, keep failure
      setup.state.models = [modelInfo("kilo", "claude-sonnet-4", false)]
      setup.event.emit(catalogEvent("model.updated"))
      await tick()
      expect(setup.scope.failure()?.message).toBe("No usable models")

      // Usable enabled model arrives -> clears stale failure
      setup.state.models = [modelInfo("kilo", "claude-sonnet-4", true)]
      setup.event.emit(catalogEvent("provider.updated"))
      setup.event.emit(catalogEvent("model.updated"))
      await tick()
      expect(setup.scope.failure()).toBeUndefined()
    } finally {
      setup.dispose()
    }
  })

  test("clears auth failure when model.updated adds newly enabled models without clearing unrelated non-auth errors", async () => {
    const setup = makeScope([modelInfo("kilo", "kilo-auto/free")])
    try {
      await setup.scope.data.location.model.sync()

      // Non-auth error stays visible when new models are added without credential.switched
      setup.scope.report(new Error("Rate limited"))
      setup.state.models = [modelInfo("kilo", "kilo-auto/free"), modelInfo("kilo", "claude-sonnet-4")]
      setup.event.emit(catalogEvent("model.updated"))
      await tick()
      expect(setup.scope.failure()?.message).toBe("Rate limited")

      // Auth failure clears when model.updated adds newly enabled models
      setup.scope.report({ type: "provider.auth", status: 401, message: "Unauthorized" })
      expect(setup.scope.failure()?.auth).toBe(true)
      setup.state.models = [
        modelInfo("kilo", "kilo-auto/free"),
        modelInfo("kilo", "claude-sonnet-4"),
        modelInfo("kilo", "gpt-5"),
      ]
      setup.event.emit(catalogEvent("model.updated"))
      await tick()
      expect(setup.scope.failure()).toBeUndefined()
    } finally {
      setup.dispose()
    }
  })
})
