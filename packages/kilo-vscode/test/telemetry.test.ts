import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  AutocompleteTelemetry,
  AutocompleteTelemetryEvent,
  captureAutocompleteTelemetry,
} from "../src/services/autocomplete/classic-auto-complete/AutocompleteTelemetry"
import { registerTelemetry } from "../src/services/telemetry"
import { TelemetryProxy } from "../src/services/telemetry/telemetry-proxy"

// The extension's telemetry wiring as `activate` composes it: `registerTelemetry` sets the properties provider, the
// autocomplete sink and the consent sync, and the server lifecycle hooks connect it to the running server. A local
// stand-in answers the `kilocode.telemetry` RPC routes and records what the extension sends.
type Call = { method: string; authorization: string | null; input: { event?: string; properties?: Record<string, unknown>; enabled?: boolean } }

const calls: Call[] = []
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const match = /^\/api\/rpc\/kilocode\.telemetry\/(\w+)$/.exec(url.pathname)
    if (!match) return Response.json({ _tag: "RpcError", type: "failed", message: "unknown route" }, { status: 400 })
    const body = (await request.json()) as { input: Call["input"] }
    calls.push({ method: match[1]!, authorization: request.headers.get("authorization"), input: body.input })
    if (match[1] === "capture") return Response.json({ output: { captured: true } })
    const enabled = body.input.enabled === true
    return Response.json({ output: { enabled, consent: enabled, config: true } })
  },
})
const started = { url: `http://127.0.0.1:${server.port}`, authorization: "Basic test-token" }

const env = vscode.env as { isTelemetryEnabled: boolean; onDidChangeTelemetryEnabled: unknown }
const original = { enabled: env.isTelemetryEnabled, change: env.onDidChangeTelemetryEnabled }
const listeners: Array<(enabled: boolean) => void> = []
const subscribe = (listener: (enabled: boolean) => void) => {
  listeners.push(listener)
  return {
    dispose: () => {
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    },
  }
}

const settle = async (count: number) => {
  for (let attempt = 0; attempt < 100 && calls.length < count; attempt++) await Bun.sleep(10)
}

function setup() {
  const subscriptions: { dispose(): unknown }[] = []
  const hooks = registerTelemetry({ context: { subscriptions }, version: "9.9.9", proxy: new TelemetryProxy() })
  return { hooks, dispose: () => subscriptions.forEach((item) => item.dispose()) }
}

describe("registerTelemetry", () => {
  // The vscode mock is shared by every test file in the process, so it is changed per test and restored after each.
  beforeEach(() => {
    calls.length = 0
    env.isTelemetryEnabled = true
    env.onDidChangeTelemetryEnabled = subscribe
  })

  afterEach(() => {
    env.isTelemetryEnabled = original.enabled
    env.onDidChangeTelemetryEnabled = original.change
  })

  afterAll(() => server.stop(true))

  it("records consent on a started server, then the autocomplete events of the default sink arrive", async () => {
    const telemetry = setup()
    telemetry.hooks.started(started)
    // The same default AutocompleteTelemetry the autocomplete service manager constructs.
    new AutocompleteTelemetry().captureAcceptSuggestion(42)
    await settle(2)
    expect(calls.map((call) => call.method)).toEqual(["setEnabled", "capture"])
    expect(calls[0]).toMatchObject({ authorization: "Basic test-token", input: { enabled: true } })
    expect(calls[1]!.input).toEqual({
      event: "Autocomplete Accept Suggestion",
      properties: {
        appName: "kilo-code",
        appVersion: "9.9.9",
        platform: "vscode",
        editorName: "VS Code",
        vscodeVersion: "1.90.0",
        machineId: "test-machine",
        vscodeIsTelemetryEnabled: true,
        suggestionLength: 42,
        autocompleteType: "inline",
      },
    })
    telemetry.dispose()
  })

  it("forwards the service-level autocomplete events too", async () => {
    const telemetry = setup()
    telemetry.hooks.started(started)
    captureAutocompleteTelemetry(AutocompleteTelemetryEvent.GHOST_SERVICE_DISABLED)
    await settle(2)
    expect(calls[1]!.input.event).toBe("Ghost Service Disabled")
    telemetry.dispose()
  })

  it("sends nothing while VS Code telemetry is off, and records the withdrawn consent", async () => {
    env.isTelemetryEnabled = false
    const telemetry = setup()
    telemetry.hooks.started(started)
    new AutocompleteTelemetry().captureAcceptSuggestion(1)
    await settle(1)
    await Bun.sleep(50)
    expect(calls.map((call) => [call.method, call.input.enabled])).toEqual([["setEnabled", false]])
    telemetry.dispose()
  })

  it("follows a consent change at runtime", async () => {
    const telemetry = setup()
    telemetry.hooks.started(started)
    await settle(1)
    env.isTelemetryEnabled = false
    listeners.forEach((listener) => listener(false))
    await settle(2)
    expect(calls.map((call) => [call.method, call.input.enabled])).toEqual([
      ["setEnabled", true],
      ["setEnabled", false],
    ])
    telemetry.dispose()
    expect(listeners).toHaveLength(0)
  })

  it("records consent again on every server start", async () => {
    const telemetry = setup()
    telemetry.hooks.started(started)
    await settle(1)
    telemetry.hooks.stopped()
    env.isTelemetryEnabled = false
    telemetry.hooks.started(started)
    await settle(2)
    expect(calls.map((call) => [call.method, call.input.enabled])).toEqual([
      ["setEnabled", true],
      ["setEnabled", false],
    ])
    telemetry.dispose()
  })

  it("delivers consent changes in order", async () => {
    const telemetry = setup()
    telemetry.hooks.started(started)
    listeners.forEach((listener) => listener(false))
    listeners.forEach((listener) => listener(true))
    listeners.forEach((listener) => listener(false))
    await settle(4)
    expect(calls.map((call) => call.input.enabled)).toEqual([true, false, true, false])
    telemetry.dispose()
  })

  it("a failed consent call does not block later events", async () => {
    const proxy = new TelemetryProxy(() => {})
    const captured: string[] = []
    proxy.configure(started, () => ({
      setEnabled: () => Promise.reject(new Error("server unavailable")),
      capture: async (input) => captured.push(input.event),
    }))
    proxy.capture("Task Created")
    await Bun.sleep(20)
    expect(captured).toEqual(["Task Created"])
  })

  it("drops an event queued for a server that was replaced", async () => {
    const proxy = new TelemetryProxy(() => {})
    const consent = Promise.withResolvers<void>()
    const first: string[] = []
    const second: string[] = []
    proxy.configure(started, () => ({ setEnabled: () => consent.promise, capture: async (input) => first.push(input.event) }))
    proxy.capture("Task Created")
    proxy.reset()
    proxy.configure(started, () => ({ setEnabled: async () => {}, capture: async (input) => second.push(input.event) }))
    consent.resolve()
    proxy.capture("Task Completed")
    await Bun.sleep(20)
    expect(first).toEqual([])
    expect(second).toEqual(["Task Completed"])
  })

  it("drops events while no server runs", async () => {
    const telemetry = setup()
    new AutocompleteTelemetry().captureAcceptSuggestion(1)
    telemetry.hooks.started(started)
    telemetry.hooks.stopped()
    new AutocompleteTelemetry().captureAcceptSuggestion(2)
    await settle(1)
    await Bun.sleep(50)
    expect(calls.map((call) => call.method)).toEqual(["setEnabled"])
    telemetry.dispose()
  })

  it("unregisters the autocomplete sink on dispose", async () => {
    const telemetry = setup()
    telemetry.hooks.started(started)
    telemetry.dispose()
    new AutocompleteTelemetry().captureAcceptSuggestion(1)
    await settle(1)
    await Bun.sleep(50)
    expect(calls.map((call) => call.method)).toEqual(["setEnabled"])
  })
})
