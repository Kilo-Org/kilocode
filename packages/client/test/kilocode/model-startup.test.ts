import { afterEach, expect, jest, test } from "bun:test"
import { waitForModel } from "../../src/kilocode/model-startup"
import { OpenCode, type ModelInfo } from "../../src/promise"

const location = { directory: "/cold worktree" }
const selected = { providerID: "kilo", id: "fixture", variant: "high" }
const model: ModelInfo = {
  ...selected,
  modelID: selected.id,
  name: "Fixture",
  enabled: true,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [],
  time: { released: 0 },
  cost: [],
  status: "active",
  limit: { context: 128000, output: 4096 },
}

afterEach(() => jest.useRealTimers())

function fixture() {
  const state = {
    models: [] as ModelInfo[],
    failure: null as { kind: "network" } | null,
    unavailable: false,
    requests: [] as Request[],
  }
  const client = OpenCode.make({
    baseUrl: "https://catalogue.test",
    fetch: async (input, init) => {
      const request = new Request(input, init)
      state.requests.push(request)
      if (new URL(request.url).pathname === "/api/model") return Response.json({ location, data: state.models })
      if (state.unavailable)
        return Response.json({ _tag: "RpcError", type: "rpc.unavailable", message: "RPC unavailable" }, { status: 400 })
      return Response.json({ output: { failure: state.failure } })
    },
  })
  return { client, state }
}

// Drain native Response parsing before advancing the controlled polling clock.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

test("ready models do not wait or consult the unrelated Gateway", async () => {
  const { client, state } = fixture()
  state.models = [{ ...model, providerID: "local" }]
  expect(await waitForModel(client, { location, model: { ...selected, providerID: "local" } })).toBe(true)
  expect(state.requests).toHaveLength(1)
})

test.each([{ types: [] }, { types: ["text/plain"] }])(
  "default readiness accepts native text capability formats %j",
  async (input) => {
    const { client, state } = fixture()
    state.models = [{ ...model, capabilities: { ...model.capabilities, input: input.types, output: input.types } }]
    expect(await waitForModel(client, { location })).toBe(true)
    expect(state.requests).toHaveLength(1)
  },
)

test.each([undefined, selected])("waits through an empty catalog for %j before dispatching once", async (requested) => {
  jest.useFakeTimers()
  const { client, state } = fixture()
  const dispatched: string[] = []
  const pending = waitForModel(client, { location, model: requested }).then((ready) => {
    if (ready) dispatched.push("prompt")
    return ready
  })
  await flush()
  expect(dispatched).toEqual([])
  expect(state.requests.map((request) => new URL(request.url).pathname)).toEqual([
    "/api/model",
    "/api/rpc/kilocode.gateway/catalog.status",
  ])
  state.models = [model]
  jest.advanceTimersByTime(100)
  expect(await pending).toBe(true)
  expect(dispatched).toEqual(["prompt"])
  expect(
    state.requests.every(
      (request) => new URL(request.url).searchParams.get("location[directory]") === location.directory,
    ),
  ).toBe(true)
  expect(selected.variant).toBe("high")
  expect(jest.getTimerCount()).toBe(0)
})

test("an unrelated ready provider does not satisfy an explicit selection", async () => {
  jest.useFakeTimers()
  const { client, state } = fixture()
  state.models = [{ ...model, providerID: "local" }]
  const pending = waitForModel(client, { location, model: selected })
  await flush()
  expect(state.requests).toHaveLength(2)
  state.models.push(model)
  jest.advanceTimersByTime(100)
  expect(await pending).toBe(true)
})

test("a settled provider missing the selected model is not retried", async () => {
  const { client, state } = fixture()
  state.models = [{ ...model, id: "other" }]
  expect(await waitForModel(client, { location, model: selected })).toBe(false)
  expect(state.requests).toHaveLength(1)
})

test("disabled and non-chat selections are unavailable", async () => {
  for (const unavailable of [
    { ...model, enabled: false },
    { ...model, type: "image" },
  ]) {
    const { client, state } = fixture()
    state.models = [unavailable]
    expect(await waitForModel(client, { location, model: selected })).toBe(false)
  }
})

test("a known Gateway failure ends the wait without hiding the native error", async () => {
  const { client, state } = fixture()
  state.failure = { kind: "network" }
  expect(await waitForModel(client, { location, model: selected })).toBe(false)
  expect(state.requests).toHaveLength(2)
})

test("the Gateway RPC can register after the first empty model read", async () => {
  jest.useFakeTimers()
  const { client, state } = fixture()
  state.unavailable = true
  const pending = waitForModel(client, { location, model: selected })
  await flush()
  state.unavailable = false
  state.models = [model]
  jest.advanceTimersByTime(100)
  expect(await pending).toBe(true)
})

test("cancellation stops polling and prevents delayed admission", async () => {
  jest.useFakeTimers()
  const { client, state } = fixture()
  const controller = new AbortController()
  const pending = waitForModel(client, { location, model: selected, signal: controller.signal }).catch((error) => error)
  await flush()
  const cancelled = new Error("cancelled")
  controller.abort(cancelled)
  expect(await pending).toBe(cancelled)
  state.models = [model]
  jest.advanceTimersByTime(1000)
  expect(state.requests).toHaveLength(2)
  expect(jest.getTimerCount()).toBe(0)
})

test("an already aborted request never reads or submits", async () => {
  const { client, state } = fixture()
  const cancelled = new Error("cancelled")
  expect(await waitForModel(client, { location, signal: AbortSignal.abort(cancelled) }).catch((error) => error)).toBe(
    cancelled,
  )
  expect(state.requests).toEqual([])
})

test("the readiness deadline is bounded and does not claim an absent model is ready", async () => {
  jest.useFakeTimers()
  const { client, state } = fixture()
  const pending = waitForModel(client, { location, model: selected })
  await flush()
  jest.advanceTimersByTime(30_000)
  expect(await pending).toBe(false)
  expect(state.requests).toHaveLength(2)
  expect(jest.getTimerCount()).toBe(0)
})

test("the deadline also aborts a stalled catalog request", async () => {
  jest.useFakeTimers()
  const signals: AbortSignal[] = []
  const client = OpenCode.make({
    baseUrl: "https://catalogue.test",
    fetch: (input, init) => {
      const signal = new Request(input, init).signal
      signals.push(signal)
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    },
  })
  const pending = waitForModel(client, { location })
  await flush()
  jest.advanceTimersByTime(30_000)
  expect(await pending).toBe(false)
  expect(signals).toHaveLength(1)
  expect(signals[0]?.aborted).toBe(true)
})

test("catalog transport errors are not retried", async () => {
  const requests: string[] = []
  const client = OpenCode.make({
    baseUrl: "https://catalogue.test",
    fetch: async (input) => {
      requests.push(String(input))
      return Response.json(
        { _tag: "ServiceUnavailableError", message: "Fixture failure", service: "plugin" },
        { status: 503 },
      )
    },
  })
  await expect(waitForModel(client, { location, model: selected })).rejects.toMatchObject({
    message: "Fixture failure",
  })
  expect(requests).toHaveLength(1)
})
