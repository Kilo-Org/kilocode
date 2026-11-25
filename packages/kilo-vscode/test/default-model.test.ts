// Guard against out-of-order and post-disposal `api.model.default` responses during catalog reloads (Wave 1 vs Wave 2).
import { describe, expect, mock, test } from "bun:test"
import type { ModelInfo, ModelRef } from "@opencode/client"
import type { Accessor, Setter } from "solid-js"

// The package resolves the server build of Solid outside a renderer, where effects never run.
const CLIENT_SOLID = "solid-js/dist/solid.js"
await mock.module("solid-js", () => import(CLIENT_SOLID))

const { createRoot, createSignal } = (await import(CLIENT_SOLID)) as {
  createRoot: <T>(fn: (dispose: () => void) => T) => T
  createSignal: <T>(value: T) => [Accessor<T>, Setter<T>]
}
const { createDefaultModel } = await import("../webview-ui/src/v2/model-default")

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const entry = (providerID: string, id: string) => ({ providerID, id, enabled: true }) as unknown as ModelInfo

function makeDefaultModel() {
  const [list, setList] = createSignal<ModelInfo[] | undefined>(undefined)
  const reported: unknown[] = []
  const calls: Array<{
    resolve: (value: { data?: { providerID: string; id: string } }) => void
    reject: (error: unknown) => void
  }> = []

  const setup = createRoot((dispose) => {
    const model: Accessor<ModelRef | undefined> = createDefaultModel({
      directory: "/workspace",
      data: {
        location: {
          model: { list },
        },
      },
      api: {
        model: {
          default: () =>
            new Promise<{ data?: { providerID: string; id: string } }>((resolve, reject) =>
              calls.push({ resolve, reject }),
            ),
        },
      },
      report: (error: unknown) => reported.push(error),
    })
    return { model, dispose }
  })

  return { ...setup, setList, calls, reported }
}

describe("createDefaultModel", () => {
  test("ignores a slower Wave-1 response that resolves after Wave-2", async () => {
    const setup = makeDefaultModel()
    try {
      // Wave 1: logged-out / transitional catalog
      setup.setList([entry("kilo", "kilo-auto/free")])
      await tick()
      expect(setup.calls).toHaveLength(1)

      // Wave 2: authenticated catalog lands before Wave 1 answers
      setup.setList([entry("kilo", "claude-sonnet-4")])
      await tick()
      expect(setup.calls).toHaveLength(2)

      // Wave 2 resolves first with the authenticated default
      setup.calls[1]!.resolve({ data: { providerID: "kilo", id: "claude-sonnet-4" } })
      await tick()
      expect(setup.model()).toEqual({ providerID: "kilo", id: "claude-sonnet-4" })

      // Slower Wave 1 resolves late with free fallback (or undefined) and must not overwrite Wave 2
      setup.calls[0]!.resolve({ data: { providerID: "kilo", id: "kilo-auto/free" } })
      await tick()
      expect(setup.model()).toEqual({ providerID: "kilo", id: "claude-sonnet-4" })
      expect(setup.reported).toEqual([])
    } finally {
      setup.dispose()
    }
  })

  test("ignores a stale rejection when a newer read superseded it, but reports the latest failure", async () => {
    const setup = makeDefaultModel()
    try {
      setup.setList([])
      await tick()
      setup.setList([entry("kilo", "claude-sonnet-4")])
      await tick()
      expect(setup.calls).toHaveLength(2)

      setup.calls[1]!.resolve({ data: { providerID: "kilo", id: "claude-sonnet-4" } })
      await tick()
      expect(setup.model()).toEqual({ providerID: "kilo", id: "claude-sonnet-4" })

      // Stale Wave-1 error must be silently dropped
      setup.calls[0]!.reject(new Error("Wave 1 401"))
      await tick()
      expect(setup.reported).toEqual([])
      expect(setup.model()).toEqual({ providerID: "kilo", id: "claude-sonnet-4" })

      // Latest read failing must still report
      setup.setList([entry("kilo", "gpt-5")])
      await tick()
      expect(setup.calls).toHaveLength(3)
      const latestError = new Error("server down")
      setup.calls[2]!.reject(latestError)
      await tick()
      expect(setup.reported).toEqual([latestError])
    } finally {
      setup.dispose()
    }
  })

  test("drops late answers and errors after owner disposal", async () => {
    const setup = makeDefaultModel()
    setup.setList([entry("kilo", "claude-sonnet-4")])
    await tick()
    expect(setup.calls).toHaveLength(1)

    setup.dispose()
    setup.calls[0]!.resolve({ data: { providerID: "kilo", id: "claude-sonnet-4" } })
    await tick()
    expect(setup.model()).toBeUndefined()
    expect(setup.reported).toEqual([])

    const setupErr = makeDefaultModel()
    setupErr.setList([entry("kilo", "claude-sonnet-4")])
    await tick()
    setupErr.dispose()
    setupErr.calls[0]!.reject(new Error("late failure"))
    await tick()
    expect(setupErr.reported).toEqual([])
  })

  test("invalidates an in-flight read when model list becomes undefined", async () => {
    const setup = makeDefaultModel()
    try {
      setup.setList([entry("kilo", "kilo-auto/free")])
      await tick()
      expect(setup.calls).toHaveLength(1)

      setup.setList(undefined)
      await tick()

      setup.calls[0]!.resolve({ data: { providerID: "kilo", id: "kilo-auto/free" } })
      await tick()
      expect(setup.model()).toBeUndefined()
    } finally {
      setup.dispose()
    }
  })
})
