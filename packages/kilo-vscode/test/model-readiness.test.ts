import { afterEach, beforeEach, expect, jest, test } from "bun:test"
import { OpenCode, type ModelInfo, type ModelRef } from "@opencode/client"
import { setImmediate } from "node:timers/promises"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type {
  createRoot,
  createSignal,
  createData,
  events,
  createModelReadiness,
  createPromptStartup,
} from "./fixtures/model-readiness"

const bundle = await Bun.build({ entrypoints: [`${import.meta.dir}/fixtures/model-readiness.ts`], target: "browser" })
const entry = bundle.outputs[0]
if (!entry) throw new Error("Missing model readiness bundle")
const source = Buffer.from(await entry.arrayBuffer()).toString("base64")
// SAFETY: The browser bundle preserves the typed fixture exports.
const runtime = (await import(`data:text/javascript;base64,${source}`)) as {
  createRoot: typeof createRoot
  createSignal: typeof createSignal
  createData: typeof createData
  events: typeof events
  createModelReadiness: typeof createModelReadiness
  createPromptStartup: typeof createPromptStartup
}

const selected: ModelRef = { providerID: "kilo", id: "delayed", variant: "high" }
const model = (ref: ModelRef): ModelInfo =>
  ({ ...ref, enabled: true, capabilities: { input: ["text"], output: ["text"] } }) as ModelInfo

function fixture(ref: ModelRef | undefined = selected, models: ModelInfo[] = []) {
  const state: { models: ModelInfo[]; failure: KiloGatewayRpc.CatalogFailure | null } = { models, failure: null }
  const calls: string[] = []
  const errors: unknown[] = []
  const api = OpenCode.make({
    baseUrl: "http://kilo.invalid",
    fetch: Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const request = new Request(...args)
        const url = new URL(request.url)
        calls.push(url.pathname)
        if (url.pathname === "/api/model")
          return Response.json({ location: { directory: "/worktree" }, data: state.models })
        if (url.pathname.endsWith("/catalog.status")) return Response.json({ output: { failure: state.failure } })
        throw new Error(`Unexpected readiness request: ${url.pathname}`)
      },
      { preconnect: fetch.preconnect },
    ),
  })
  return runtime.createRoot((dispose) => {
    const event = runtime.events()
    const data = runtime.createData({ api: () => api, directory: "/worktree", event })
    const [selected, select] = runtime.createSignal(ref)
    const [prepared, prepare] = runtime.createSignal(true)
    const ready = runtime.createModelReadiness(
      {
        api,
        data,
        directory: "/worktree",
        connection: { status: () => "connected" },
        report: (error: unknown) => errors.push(error),
      } as never,
      selected,
      prepared,
    )
    return {
      state,
      calls,
      errors,
      ready,
      selected,
      select,
      prepare,
      data,
      publish(models: ModelInfo[]) {
        state.models = models
        event.emit({
          type: "model.updated",
          id: "evt_models",
          created: 1,
          data: {},
          location: { directory: "/worktree" },
        })
      },
      [Symbol.dispose]: dispose,
    }
  })
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test("an empty catalog and saved model do not unlock Send; a located model publication does", async () => {
  using setup = fixture()
  await setup.data.location.model.sync()
  await setImmediate()
  expect(setup.ready()).toBe(false)
  expect(setup.selected()).toEqual(selected)

  setup.publish([model({ providerID: "other", id: "ready" })])
  await setImmediate()
  expect(setup.ready()).toBe(false)
  expect(setup.selected()).toEqual(selected)

  setup.publish([model(selected)])
  await setImmediate()
  expect(setup.ready()).toBe(true)
  expect(setup.data.location.model.list()?.[0]?.id).toBe(selected.id)
  expect(setup.errors).toEqual([])
})

test("a ready non-Kilo model never waits for an unrelated Gateway", async () => {
  const picked = { providerID: "other", id: "ready" }
  using setup = fixture(picked, [model(picked)])
  await setup.data.location.model.sync()
  await setImmediate()
  expect(setup.ready()).toBe(true)
  expect(setup.calls.every((path) => path === "/api/model")).toBe(true)
})

test("selection inputs must finish loading even when the catalog is available", async () => {
  using setup = fixture(selected, [model(selected)])
  setup.prepare(false)
  await setup.data.location.model.sync()
  await setImmediate()
  expect(setup.ready()).toBe(false)
  setup.prepare(true)
  expect(setup.ready()).toBe(true)
})

test("a settled catalog failure leaves the normal send error path available", async () => {
  using setup = fixture()
  setup.state.failure = { kind: "unauthorized", status: 401 }
  await setup.data.location.model.sync()
  await setImmediate()
  expect(setup.ready()).toBe(true)
  expect(setup.selected()).toEqual(selected)
  expect(setup.data.location.model.list()).toEqual([])
})

test("a catalog that never arrives has a bounded wait, without changing the requested model", async () => {
  using setup = fixture()
  await setup.data.location.model.sync()
  await setImmediate()
  expect(setup.ready()).toBe(false)
  jest.advanceTimersByTime(30_000)
  await setImmediate()
  expect(setup.ready()).toBe(true)
  expect(setup.selected()).toEqual(selected)
})

test("disposing the view cancels its catalog wait without reporting a late error", async () => {
  const setup = fixture()
  await setup.data.location.model.sync()
  await setImmediate()
  const reads = setup.calls.length
  setup[Symbol.dispose]()
  setup.state.models = [model(selected)]
  jest.runAllTimers()
  await setImmediate()
  expect(setup.calls).toHaveLength(reads)
  expect(setup.errors).toEqual([])
})

test("Stop cancels only that session's client-side initial prompt and disposal cancels the rest", () => {
  const setup = runtime.createRoot((dispose) => ({ startup: runtime.createPromptStartup(), dispose }))
  const first = setup.startup.start("ses_first")
  const second = setup.startup.start("ses_second")
  expect(setup.startup.pending("ses_first")).toBe(true)
  expect(setup.startup.cancel("ses_first")).toBe(true)
  expect(first.signal.aborted).toBe(true)
  expect(second.signal.aborted).toBe(false)
  expect(setup.startup.pending("ses_first")).toBe(false)
  setup.dispose()
  expect(second.signal.aborted).toBe(true)
})
