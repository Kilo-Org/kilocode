import { describe, expect, test } from "bun:test"
import { createData } from "@opencode/client/solid"
import { createRoot } from "solid-js"
import type { OpenCodeEvent } from "@opencode/client"
import { createChildSessions } from "../webview-ui/src/v2/child-session"

const parent = "ses_parent"
const child = "ses_child"

const info = (id: string, parentID?: string) => ({
  id,
  parentID,
  projectID: "project",
  agent: "code",
  model: { providerID: "test", id: "test-model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory: "/repo" },
})

function store() {
  const listeners: Array<(message: { name: string; details: OpenCodeEvent }) => void> = []
  const api = {
    session: {
      get: async ({ sessionID }: { sessionID: string }) => info(sessionID, sessionID === child ? parent : undefined),
      list: async () => ({ data: [], cursor: {} }),
      active: async () => ({ data: {} }),
    },
    message: { list: async () => ({ data: [], cursor: {} }) },
  }
  const event = {
    on: () => () => undefined,
    listen(handler: (message: { name: string; details: OpenCodeEvent }) => void) {
      listeners.push(handler)
      return () => undefined
    },
  }
  const emit = (details: object) =>
    listeners.forEach((handler) => handler({ name: (details as { type: string }).type, details: details as OpenCodeEvent }))
  return { api, event, emit }
}

const until = async (probe: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !probe(); attempt++) await Bun.sleep(1)
  expect(probe()).toBe(true)
}

describe("child session release", () => {
  test("a subagent view releases its own transcript, not the parent chat", async () => {
    let dispose = () => {}
    const input = store()
    await new Promise<void>((resolve) => {
      createRoot((disposeRoot) => {
        dispose = disposeRoot
        const data = createData({
          api: () => input.api as never,
          directory: "/repo",
          event: input.event as never,
        })
        void (async () => {
          input.emit({ type: "session.created", id: "created-parent", created: 1, data: { sessionID: parent } })
          input.emit({ type: "session.created", id: "created-child", created: 2, data: { sessionID: child } })
          await until(() => !!data.session.get(parent) && !!data.session.get(child))
          input.emit({
            type: "session.step.started",
            id: "step-parent",
            created: 3,
            data: {
              sessionID: parent,
              assistantMessageID: "msg_parent_step",
              agent: "code",
              model: { providerID: "test", id: "test-model" },
              started: 3,
            },
          })
          expect(data.session.message.list(parent)).toHaveLength(1)
          expect(data.session.root(child)).toBe(parent)

          // Closing an inspector subagent view used to evict the tree root, which blanked the parent transcript.
          const children = createChildSessions({ data, report: () => undefined })
          children.release(child)

          expect(data.session.message.list(parent)).toHaveLength(1)
          expect(data.session.message.list(child)).toHaveLength(0)
          resolve()
        })().catch((error) => {
          resolve()
          throw error
        })
      })
    })
    dispose()
  })
})
