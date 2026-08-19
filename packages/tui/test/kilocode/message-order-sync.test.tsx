/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@kilocode/sdk/v2"
import { tmpdir } from "../fixture/fixture"
import { json, mount, wait } from "../cli/cmd/tui/sync-fixture"

const sessionID = "ses_order"
const partID = "prt_order"
const directory = "/tmp/opencode/packages/tui"
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

function wrap(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

test("a later message with a lexicographically earlier id stays at the tail", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const old = { ...base, id: "msg_ff0cb2300001Z6YIo5V52u114f", time: { created: 1, completed: 2 } }
  const next = { ...base, id: "msg_019f1d3da001955TwEJ8qKEbj3", time: { created: 3 } }
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      return json([{ info: old, parts: [{ id: partID, sessionID, messageID: old.id, type: "text", text: "old" }] }])
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)
  try {
    await sync.session.sync(sessionID)
    await wait(() => sync.data.message[sessionID]?.some((item) => item.id === old.id) === true)
    emit(
      wrap({
        id: "evt_next",
        type: "message.updated",
        properties: { sessionID, info: next },
      }),
    )
    await wait(() => sync.data.message[sessionID]?.some((item) => item.id === next.id) === true)
    const ids = (sync.data.message[sessionID] ?? []).map((item) => item.id)
    expect(ids[0]).toBe(old.id)
    expect(ids.at(-1)).toBe(next.id)
  } finally {
    app.renderer.destroy()
  }
})
