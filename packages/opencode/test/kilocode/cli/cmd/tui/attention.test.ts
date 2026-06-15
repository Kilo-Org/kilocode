import { describe, expect, test } from "bun:test"
import Attention from "@/kilocode/plugins/attention"
import type { Event, Session, SessionNetworkWait, SuggestionRequest } from "@kilocode/sdk/v2"
import type { TuiAttentionNotifyInput } from "@kilocode/plugin/tui"
import { createTuiPluginApi } from "../../../../fixture/tui-plugin"

async function setup() {
  const notifications: TuiAttentionNotifyInput[] = []
  const handlers = new Map<Event["type"], ((event: Event) => void)[]>()
  const session = (id: string, title: string, parentID?: string): Session => ({
    id,
    title,
    slug: id,
    projectID: "project",
    directory: "/workspace",
    ...(parentID && { parentID }),
    version: "0.0.0-test",
    time: { created: 0, updated: 0 },
  })
  const sessions: Record<string, Session> = {
    session: session("session", "Demo session"),
    subagent: session("subagent", "Subagent session", "session"),
  }

  await Attention.tui(
    createTuiPluginApi({
      attention: {
        async notify(input) {
          notifications.push(input)
          return { ok: true, notification: true, sound: true }
        },
      },
      event: {
        on: <Type extends Event["type"]>(type: Type, handler: (event: Extract<Event, { type: Type }>) => void) => {
          const list = handlers.get(type) ?? []
          const wrapped = handler as (event: Event) => void
          list.push(wrapped)
          handlers.set(type, list)
          return () => {
            handlers.set(
              type,
              (handlers.get(type) ?? []).filter((item) => item !== wrapped),
            )
          }
        },
      },
      state: {
        session: {
          get: (sessionID: string) => sessions[sessionID],
        },
      },
    }),
    undefined,
    {} as never,
  )

  return {
    notifications,
    emit(event: Event) {
      for (const handler of handlers.get(event.type) ?? []) handler(event)
    },
  }
}

function suggestion(id: string, sessionID = "session"): SuggestionRequest {
  return {
    id,
    sessionID,
    text: "Review the changes",
    actions: [{ label: "Review", prompt: "/local-review-uncommitted" }],
  }
}

function wait(id: string, sessionID = "session"): SessionNetworkWait {
  return {
    id,
    sessionID,
    message: "Network connection failed",
    restored: false,
    time: { created: 0 },
  }
}

const suggestionNotification: TuiAttentionNotifyInput = {
  title: "Demo session",
  message: "Suggestion needs input",
  notification: { when: "blurred" },
  sound: { name: "question", when: "always" },
}

const networkNotification: TuiAttentionNotifyInput = {
  title: "Demo session",
  message: "Network connection needs input",
  notification: { when: "blurred" },
  sound: { name: "question", when: "always" },
}

describe("Kilo attention TUI plugin", () => {
  test("requests upstream attention for suggestions and network prompts", async () => {
    const harness = await setup()

    harness.emit({ id: "event-1", type: "suggestion.shown", properties: suggestion("suggestion-1") })
    harness.emit({ id: "event-2", type: "session.network.asked", properties: wait("network-1") })

    expect(harness.notifications).toEqual([suggestionNotification, networkNotification])
  })

  test("dedupes pending prompts until they are resolved", async () => {
    const harness = await setup()

    harness.emit({ id: "event-1", type: "suggestion.shown", properties: suggestion("suggestion-1") })
    harness.emit({ id: "event-2", type: "suggestion.shown", properties: suggestion("suggestion-1") })
    harness.emit({
      id: "event-3",
      type: "suggestion.dismissed",
      properties: { sessionID: "session", requestID: "suggestion-1" },
    })
    harness.emit({ id: "event-4", type: "suggestion.shown", properties: suggestion("suggestion-1") })

    harness.emit({ id: "event-5", type: "session.network.asked", properties: wait("network-1") })
    harness.emit({ id: "event-6", type: "session.network.asked", properties: wait("network-1") })
    harness.emit({
      id: "event-7",
      type: "session.network.replied",
      properties: { sessionID: "session", requestID: "network-1" },
    })
    harness.emit({ id: "event-8", type: "session.network.asked", properties: wait("network-1") })

    expect(harness.notifications).toEqual([
      suggestionNotification,
      suggestionNotification,
      networkNotification,
      networkNotification,
    ])
  })

  test("uses sound-only attention for subagent prompts", async () => {
    const harness = await setup()

    harness.emit({
      id: "event-1",
      type: "suggestion.shown",
      properties: suggestion("suggestion-1", "subagent"),
    })
    harness.emit({
      id: "event-2",
      type: "session.network.asked",
      properties: wait("network-1", "subagent"),
    })

    expect(harness.notifications).toEqual([
      {
        title: "Subagent session",
        message: "Suggestion needs input",
        notification: false,
        sound: { name: "question", when: "always" },
      },
      {
        title: "Subagent session",
        message: "Network connection needs input",
        notification: false,
        sound: { name: "question", when: "always" },
      },
    ])
  })
})
