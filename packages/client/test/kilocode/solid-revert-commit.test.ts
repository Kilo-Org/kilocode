import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInfo } from "../../src/promise"

// A queued prompt keeps the ID of its admission and is delivered after the steps that ran while it waited, so its ID
// sorts before theirs. Committing a revert to it must keep those earlier steps, as the server does by sequence.
test("a committed revert cuts the transcript at the boundary's position", async () => {
  const setup = fixture([
    { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
    { id: "msg_3", type: "synthetic", text: "step before the queued prompt", time: { created: 3 } },
    { id: "msg_2", type: "user", text: "queued", time: { created: 4 } },
    { id: "msg_4", type: "synthetic", text: "answer", time: { created: 5 } },
  ])
  try {
    await setup.data.session.message.sync("ses_one")
    setup.emit({
      id: "evt_commit",
      created: 6,
      type: "session.revert.committed",
      durable: { aggregateID: "ses_one", seq: 6, version: 1 },
      data: { sessionID: "ses_one", to: "msg_2" },
    } as OpenCodeEvent)

    expect(setup.data.session.message.list("ses_one").map((item) => item.id)).toEqual(["msg_1", "msg_3"])
  } finally {
    setup.dispose()
  }
})

test("a committed revert to an unloaded boundary falls back to ID order", async () => {
  const setup = fixture([
    { id: "msg_5", type: "user", text: "kept", time: { created: 1 } },
    { id: "msg_7", type: "user", text: "removed", time: { created: 2 } },
  ])
  try {
    await setup.data.session.message.sync("ses_one")
    setup.emit({
      id: "evt_commit",
      created: 3,
      type: "session.revert.committed",
      durable: { aggregateID: "ses_one", seq: 3, version: 1 },
      data: { sessionID: "ses_one", to: "msg_6" },
    } as OpenCodeEvent)

    expect(setup.data.session.message.list("ses_one").map((item) => item.id)).toEqual(["msg_5"])
  } finally {
    setup.dispose()
  }
})

function fixture(messages: Array<{ id: string; type: "user" | "synthetic"; text: string; time: { created: number } }>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (!url.pathname.endsWith("/message")) return Response.json({ data: [] })
      return Response.json({ data: [...messages].reverse(), cursor: {} })
    },
  })
  return createRoot((dispose) => {
    const data = createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    })
    data.session.remember(info("ses_one"))
    return {
      data,
      dispose,
      emit: (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details })),
    }
  })
}

function info(id: string): SessionInfo {
  return {
    id,
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory: "/project" },
  }
}
