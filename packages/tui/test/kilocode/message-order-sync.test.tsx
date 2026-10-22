/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@kilocode/sdk/v2"
import { tmpdir } from "../fixture/fixture"
import { json, mount, wait } from "../cli/cmd/tui/sync-fixture"

const sessionID = "ses_order"
const partID = "prt_order"
const directory = "/tmp/opencode/packages/tui"
let seq = 0
const session = {
  id: sessionID,
  title: "order",
  time: { created: 0, updated: 0 },
  version: "1.15.13",
  directory,
}
const base = {
  sessionID,
  role: "assistant" as const,
  agent: "build",
  modelID: "model",
  providerID: "test",
  mode: "build",
  parentID: "msg_user",
  path: { cwd: directory, root: directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}
const old = { ...base, id: "msg_ff0cb2300001Z6YIo5V52u114f", time: { created: 1, completed: 2 } }
const next = { ...base, id: "msg_019f1d3da001955TwEJ8qKEbj3", time: { created: 3 } }

function wrap(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

function sync1(id: string, info: (typeof base & { id: string; time: { created: number } }) | undefined): GlobalEvent {
  return {
    directory,
    project: "proj_test",
    payload: {
      type: "sync",
      syncEvent: {
        id,
        type: "message.updated.1",
        seq: ++seq,
        aggregateID: sessionID,
        data: { sessionID, info },
      },
    },
  } as GlobalEvent
}

function serve(infos: (typeof old)[]) {
  return (url: URL) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      return json(infos.map((info) => ({ info, parts: [] })))
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }
}

test("a later message with a lexicographically earlier id stays at the tail", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}/message`) {
      return json([{ info: old, parts: [{ id: partID, sessionID, messageID: old.id, type: "text", text: "old" }] }])
    }
    return serve([])(url)
  }, tmp.path)
  try {
    await sync.session.sync(sessionID)
    await wait(() => sync.data.message[sessionID]?.some((item) => item.id === old.id) ?? false)
    emit(
      wrap({
        id: "evt_next",
        type: "message.updated",
        properties: { sessionID, info: next },
      }),
    )
    await wait(() => sync.data.message[sessionID]?.some((item) => item.id === next.id) ?? false)
    const ids = (sync.data.message[sessionID] ?? []).map((item) => item.id)
    expect(ids[0]).toBe(old.id)
    expect(ids.at(-1)).toBe(next.id)
  } finally {
    app.renderer.destroy()
  }
})

test("eviction at the window cap drops the oldest message, not the newest", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const infos = Array.from({ length: 100 }, (_, index) => ({
    ...base,
    id: `msg_ff0c${String(index).padStart(4, "0")}`,
    time: { created: index + 1, completed: index + 2 },
  }))
  const { app, emit, sync } = await mount(serve(infos), tmp.path)
  try {
    await sync.session.sync(sessionID)
    await wait(() => sync.data.message[sessionID]?.length === 100)
    emit(
      wrap({
        id: "evt_next",
        type: "message.updated",
        properties: { sessionID, info: { ...next, time: { created: 200 } } },
      }),
    )
    await wait(() => sync.data.message[sessionID]?.some((item) => item.id === next.id) ?? false)
    const ids = (sync.data.message[sessionID] ?? []).map((item) => item.id)
    expect(ids).toHaveLength(100)
    expect(ids.at(-1)).toBe(next.id)
    expect(ids).not.toContain(infos[0].id)
    expect(ids[0]).toBe(infos[1].id)
  } finally {
    app.renderer.destroy()
  }
})

test("the versioned sync channel also keeps a wrapped id at the tail", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mount(serve([old]), tmp.path)
  try {
    await sync.session.sync(sessionID)
    await wait(() => sync.data.message[sessionID]?.some((item) => item.id === old.id) ?? false)
    emit(sync1("evt_next_v1", next))
    await wait(() => sync.data.message[sessionID]?.some((item) => item.id === next.id) ?? false)
    const ids = (sync.data.message[sessionID] ?? []).map((item) => item.id)
    expect(ids[0]).toBe(old.id)
    expect(ids.at(-1)).toBe(next.id)
  } finally {
    app.renderer.destroy()
  }
})
