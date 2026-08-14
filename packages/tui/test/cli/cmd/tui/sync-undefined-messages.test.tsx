/** @jsxImportSource @opentui/solid */
/**
 * Reproducer for #26560 — TUI crashes with
 *   `TypeError: undefined is not an object (evaluating 'f.data.map')`
 * when entering a session whose messages endpoint returns a non-2xx.
 * The failure path is `sync.tsx#sync.session.sync` reading
 * `messages.data!` while the SDK leaves `data` undefined on error.
 */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount } from "./sync-fixture"

const sessionID = "ses_undef"

describe("tui sync (#26560)", () => {
  test("entering a session whose messages endpoint errors does not crash sync", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    const sessionPayload = {
      id: sessionID,
      title: "broken",
      time: { created: 0, updated: 0 },
      version: "1.14.42",
      directory,
      project_id: "proj_test",
    }
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json(sessionPayload)
      if (url.pathname === `/session/${sessionID}/messages`) return json({}, { status: 500 })
      if (url.pathname === `/session/${sessionID}/todo`) return json([])
      if (url.pathname === `/session/${sessionID}/diff`) return json([])
      if (url.pathname === "/session") return json([sessionPayload])
      return undefined
    }, tmp.path)

    try {
      await expect(sync.session.sync(sessionID)).resolves.toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })

  // kilocode_change start - a failed fetch must not latch fullSyncedSessions
  test("a failed messages fetch does not latch an empty transcript", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    const sessionPayload = {
      id: sessionID,
      title: "broken",
      time: { created: 0, updated: 0 },
      version: "1.14.42",
      directory,
      project_id: "proj_test",
    }
    let calls = 0
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json(sessionPayload)
      if (url.pathname === `/session/${sessionID}/message` || url.pathname === `/session/${sessionID}/messages`) {
        calls += 1
        if (calls === 1) return json({}, { status: 500 })
        return json([
          {
            info: {
              id: "msg_recovered",
              sessionID,
              role: "assistant",
              agent: "build",
              modelID: "model",
              providerID: "test",
              mode: "build",
              parentID: "msg_user",
              path: { cwd: directory, root: directory },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: 1, completed: 2 },
            },
            parts: [{ id: "prt_recovered", sessionID, messageID: "msg_recovered", type: "text", text: "recovered" }],
          },
        ])
      }
      if (url.pathname === `/session/${sessionID}/todo`) return json([])
      if (url.pathname === `/session/${sessionID}/diff`) return json([])
      if (url.pathname === "/session") return json([sessionPayload])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      expect(sync.data.message[sessionID] ?? []).toEqual([])
      await sync.session.sync(sessionID)
      expect(sync.data.message[sessionID]?.[0]?.id).toBe("msg_recovered")
    } finally {
      app.renderer.destroy()
    }
  })
  // kilocode_change end
})
