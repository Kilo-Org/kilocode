// The composer's model drafts live in the directory scope, so they outlive the chat view: the sidebar history view and
// an Agent Manager worktree switch remount it. The scope drops a draft once the session reports the committed model,
// and when the session is deleted.
import { describe, expect, test } from "bun:test"
import type { ModelRef, OpenCodeClient, OpenCodeEvent } from "@opencode/client"
import { createRoot, createSignal } from "solid-js"
import { events } from "../webview-ui/src/v2/events"
import { createV2Scope } from "../webview-ui/src/v2/scope"

const model = (variant: string): ModelRef => ({ providerID: "kilo", id: "claude", variant })

const selected = (variant: string) =>
  ({
    id: `evt_${variant}`,
    created: 1,
    type: "session.model.selected",
    durable: { aggregateID: "ses_one", seq: 1, version: 1 },
    data: { sessionID: "ses_one", model: model(variant), previous: model("low") },
  }) as unknown as OpenCodeEvent

const deleted = () =>
  ({
    id: "evt_deleted",
    created: 2,
    type: "session.deleted",
    durable: { aggregateID: "ses_one", seq: 2, version: 1 },
    data: { sessionID: "ses_one" },
  }) as unknown as OpenCodeEvent

function makeScope() {
  const event = events()
  const api = {
    session: { list: async () => ({ data: [] }) },
    rpc: () => ({
      get: async () => ({ version: "1.2.3" }),
      "catalog.status": async () => ({}),
      models: async () => [],
      authStatus: async () => undefined,
    }),
  } as unknown as OpenCodeClient
  const [status] = createSignal<"connected">("connected")
  return createRoot((dispose) => ({
    scope: createV2Scope({
      api,
      connection: { status } as unknown as Parameters<typeof createV2Scope>[0]["connection"],
      event,
      directory: "/workspace",
      bindings: () => ({}),
      selection: () => false,
      chat: false,
      onCommand: () => {},
      open: () => {},
    }),
    event,
    dispose,
  }))
}

describe("scope model drafts", () => {
  test("the echo of the committed model drops the draft, another model keeps it", () => {
    const setup = makeScope()
    try {
      setup.scope.drafts.set("ses_one", model("high"))
      setup.event.emit(selected("medium"))
      expect(setup.scope.drafts.get("ses_one")).toEqual(model("high"))
      setup.event.emit(selected("high"))
      expect(setup.scope.drafts.get("ses_one")).toBeUndefined()
    } finally {
      setup.dispose()
    }
  })

  test("a deleted session drops its draft", () => {
    const setup = makeScope()
    try {
      setup.scope.drafts.set("ses_one", model("high"))
      setup.event.emit(deleted())
      expect(setup.scope.drafts.get("ses_one")).toBeUndefined()
    } finally {
      setup.dispose()
    }
  })
})
