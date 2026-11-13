// A Settings or Profile scope must not load the sidebar data: the session list and the Kilo Gateway catalog status.
// The chat scope still loads both, so the sidebar and the Agent Manager keep their behavior.
import { describe, expect, mock, test } from "bun:test"
import type { OpenCodeClient } from "@opencode/client"

// One Solid instance for the module and the test, so effects run and `createRoot` owns them.
const CLIENT_SOLID = "solid-js/dist/solid.js"
mock.module("solid-js", () => import(CLIENT_SOLID))

const { createRoot, createSignal } = (await import(CLIENT_SOLID)) as {
  createRoot: <T>(fn: (dispose: () => void) => T) => T
  createSignal: <T>(value: T) => [() => T, (value: T) => void]
}
const { createV2Scope } = await import("../webview-ui/src/v2/scope")
const { events } = await import("../webview-ui/src/v2/events")

type Status = "connecting" | "connected"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeScope(input: { chat: boolean }) {
  const calls: string[] = []
  const api = {
    session: {
      list: async () => {
        calls.push("session.list")
        return { data: [] }
      },
    },
    rpc: () => ({
      get: async () => {
        calls.push("handshake")
        return { version: "1.2.3" }
      },
      "catalog.status": async () => {
        calls.push("catalog.status")
        return {}
      },
      models: async () => {
        calls.push("models")
        return []
      },
      authStatus: async () => undefined,
      events: { on: () => () => {} },
      pending: async () => ({ sessions: [] }),
    }),
  } as unknown as OpenCodeClient
  const [status] = createSignal<Status>("connected")
  const connection = { status } as unknown as Parameters<typeof createV2Scope>[0]["connection"]
  const dispose = createRoot((dispose) => {
    createV2Scope({
      api,
      connection,
      event: events(),
      directory: "/workspace",
      bindings: () => ({}),
      selection: () => false,
      chat: input.chat,
      onCommand: () => {},
      open: () => {},
    })
    return dispose
  })
  return { calls, dispose }
}

describe("createV2Scope", () => {
  test("a Settings scope skips the session list and the catalog status", async () => {
    const scope = makeScope({ chat: false })
    try {
      await tick()
      expect(scope.calls).toContain("handshake")
      expect(scope.calls).not.toContain("session.list")
      expect(scope.calls).not.toContain("catalog.status")
    } finally {
      scope.dispose()
    }
  })

  test("a chat scope still loads both", async () => {
    const scope = makeScope({ chat: true })
    try {
      await tick()
      expect(scope.calls).toContain("session.list")
      expect(scope.calls).toContain("catalog.status")
    } finally {
      scope.dispose()
    }
  })
})
