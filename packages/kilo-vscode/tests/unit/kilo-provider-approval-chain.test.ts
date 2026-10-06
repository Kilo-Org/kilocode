import { describe, expect, it } from "bun:test"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type Message = Record<string, unknown>
type Internals = {
  onBeforeMessage: ((msg: Message) => Promise<Message | null>) | null
  setAutoApproveController(ctrl: unknown): void
  setApproveForMeController(ctrl: unknown): void
}

function controller(calls: string[]) {
  return {
    active: () => false,
    visible: () => true,
    approve: async () => false,
    toggle: async () => {
      calls.push("toggle")
      return true
    },
    onChange: () => ({ dispose: () => undefined }),
  }
}

function provider() {
  const connection = { onStateChange: () => ({ dispose: () => undefined }) }
  const context = { subscriptions: [], globalState: { get: () => undefined, update: async () => undefined } }
  return new KiloProvider({ fsPath: "/ext" } as never, connection as never, context as never) as unknown as Internals
}

describe("KiloProvider approval interceptors", () => {
  it("routes each bridge's messages and forwards everything else", async () => {
    const calls: string[] = []
    const kilo = provider()
    kilo.setAutoApproveController(controller(calls))
    kilo.setApproveForMeController(controller(calls))

    expect(await kilo.onBeforeMessage!({ type: "toggleAutoApprove" })).toBeNull()
    expect(await kilo.onBeforeMessage!({ type: "toggleApproveForMe" })).toBeNull()
    expect(await kilo.onBeforeMessage!({ type: "other" })).toEqual({ type: "other" })
    expect(calls).toEqual(["toggle", "toggle"])
  })

  it("does not recurse when a controller is registered twice", async () => {
    const kilo = provider()
    kilo.setAutoApproveController(controller([]))
    kilo.setAutoApproveController(controller([]))
    kilo.setApproveForMeController(controller([]))
    kilo.setApproveForMeController(controller([]))

    expect(await kilo.onBeforeMessage!({ type: "other" })).toEqual({ type: "other" })
  })
})
