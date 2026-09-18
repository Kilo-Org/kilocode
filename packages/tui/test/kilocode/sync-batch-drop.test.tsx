/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { GlobalEvent } from "@kilocode/sdk/v2"
import { tmpdir } from "../fixture/fixture"
import { directory, mount, wait } from "../cli/cmd/tui/sync-fixture"

const view = "ses_view"
const bg = "ses_bg"
const message = "msg_view"

function wrap(payload: unknown): GlobalEvent {
  return { directory, project: "proj_test", payload } as GlobalEvent
}

const busy = wrap({
  id: "evt_busy",
  type: "session.status",
  properties: { sessionID: view, status: { type: "busy" } },
})

const idle = wrap({
  id: "evt_idle",
  type: "session.idle",
  properties: { sessionID: view },
})

const removed = wrap({
  id: "evt_removed",
  type: "message.part.removed",
  properties: { sessionID: bg, messageID: "msg_bg", partID: "prt_bg" },
})

const good = wrap({
  id: "evt_good",
  type: "message.updated",
  properties: {
    sessionID: view,
    info: {
      id: message,
      sessionID: view,
      role: "user",
      time: { created: 1 },
      path: { cwd: directory, root: directory },
    },
  },
})

describe("tui sync batch drop", () => {
  test("part.removed for an unhydrated session does not drop later events in the batch", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount(undefined, tmp.path)

    try {
      emit(busy)
      emit(removed)
      emit(good)
      await wait(() => sync.data.message[view]?.some((item) => item.id === message) ?? false)

      expect(sync.data.message[view]?.map((item) => item.id)).toEqual([message])
    } finally {
      app.renderer.destroy()
    }
  })

  test("session.idle returns the status to idle after busy", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount(undefined, tmp.path)

    try {
      emit(busy)
      await wait(() => sync.data.session_status[view]?.type === "busy")

      emit(idle)
      await wait(() => sync.data.session_status[view]?.type === "idle")

      expect(sync.data.session_status[view]).toEqual({ type: "idle" })
    } finally {
      app.renderer.destroy()
    }
  })
})
