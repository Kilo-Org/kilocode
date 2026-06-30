/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { BackgroundProcessInfo, GlobalEvent } from "@kilocode/sdk/v2"
import { normalizeSyncEvent } from "../../src/cli/cmd/tui/context/event"
import { mount, wait } from "../cli/cmd/tui/sync-fixture"

function processInfo(id: string, sessionID: string, lifetime: BackgroundProcessInfo["lifetime"], updated: number) {
  return {
    id,
    sessionID,
    command: "bun run dev",
    cwd: "/tmp/opencode",
    ports: [],
    status: "running",
    lifetime,
    ready: false,
    output: "",
    time: { started: 1, updated },
  } satisfies BackgroundProcessInfo
}

describe("TUI sync event wire format", () => {
  test("normalizes the runtime sync envelope", () => {
    const event = normalizeSyncEvent({
      type: "sync",
      syncEvent: {
        type: "message.part.updated.1",
        id: "evt_1",
        seq: 3,
        aggregateID: "ses_1",
        data: {
          sessionID: "ses_1",
          part: {
            id: "prt_1",
            sessionID: "ses_1",
            messageID: "msg_1",
            type: "text",
            text: "response",
          },
          time: 1,
        },
      },
    })

    expect(event?.type).toBe("sync")
    expect(event?.name).toBe("message.part.updated.1")
    expect(event?.id).toBe("evt_1")
    expect(event?.seq).toBe(3)
    expect(String(event?.aggregateID)).toBe("ses_1")
    if (event?.name !== "message.part.updated.1") throw new Error("Expected message part update")
    expect(event.data.part).toMatchObject({
      id: "prt_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "text",
      text: "response",
    })
  })

  test("preserves generated SDK sync payloads", () => {
    const payload = {
      type: "sync",
      name: "message.removed.1",
      id: "evt_2",
      seq: 4,
      aggregateID: "sessionID",
      data: { sessionID: "ses_1", messageID: "msg_1" },
    } as const

    expect(normalizeSyncEvent(payload)).toBe(payload)
  })

  test("ignores non-sync events", () => {
    expect(normalizeSyncEvent({ type: "session.status" })).toBeUndefined()
  })

  test("ignores background process events from another project scope", async () => {
    const { app, emit, sync } = await mount()

    try {
      emit({
        directory: "/tmp/opencode/packages/opencode",
        project: "proj_test",
        payload: {
          type: "background_process.updated",
          properties: {
            info: processInfo("bgp_other_clone", "ses_other", "persistent", 1),
            scope: "/tmp/independent-clone",
          },
        },
      } as unknown as GlobalEvent)
      await Bun.sleep(50)
      expect(Object.values(sync.data.background_process).flat()).toEqual([])
    } finally {
      app.renderer.destroy()
    }
  })

  test("syncs persistent process events across git worktrees", async () => {
    const { app, emit, sync } = await mount()
    const sessionID = "ses_project_process"
    const processID = "bgp_project_process"

    try {
      emit({
        directory: "/tmp/other-worktree",
        project: "proj_test",
        payload: {
          type: "background_process.updated",
          properties: {
            info: processInfo(processID, sessionID, "persistent", 1),
            scope: "/tmp/project-root",
          },
        },
      } as unknown as GlobalEvent)
      await wait(() => sync.data.background_process[sessionID]?.some((item) => item.id === processID))

      emit({
        directory: "/tmp/other-worktree",
        project: "proj_test",
        payload: {
          type: "background_process.deleted",
          properties: { sessionID, processID, scope: "/tmp/project-root" },
        },
      } as unknown as GlobalEvent)
      await wait(() => sync.data.background_process[sessionID] === undefined)
    } finally {
      app.renderer.destroy()
    }
  })

  test("moves inherited processes between session buckets", async () => {
    const { app, emit, sync } = await mount()
    const child = "ses_child"
    const parent = "ses_parent"
    const id = "bgp_transfer"

    try {
      emit({
        directory: "/tmp/opencode/packages/opencode",
        project: "proj_test",
        payload: {
          type: "background_process.updated",
          properties: { info: processInfo(id, child, "parent", 1), scope: "/tmp/opencode/packages/opencode" },
        },
      } as unknown as GlobalEvent)
      await wait(() => sync.data.background_process[child]?.some((item) => item.id === id))

      emit({
        directory: "/tmp/opencode/packages/opencode",
        project: "proj_test",
        payload: {
          type: "background_process.updated",
          properties: { info: processInfo(id, parent, "session", 2), scope: "/tmp/opencode/packages/opencode" },
        },
      } as unknown as GlobalEvent)
      await wait(() => sync.data.background_process[parent]?.some((item) => item.id === id))

      expect(sync.data.background_process[child]).toBeUndefined()
      expect(
        Object.values(sync.data.background_process)
          .flat()
          .filter((item) => item.id === id),
      ).toHaveLength(1)
    } finally {
      app.renderer.destroy()
    }
  })

  test("does not restore stale ownership from an in-flight bootstrap", async () => {
    let requests = 0
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => {
      resolve = done
    })
    const child = "ses_stale_child"
    const parent = "ses_fresh_parent"
    const id = "bgp_bootstrap_transfer"
    const { app, emit, sync } = await mount((url) => {
      if (url.pathname !== "/background-process") return
      requests += 1
      if (requests === 1) return new Response("[]", { headers: { "content-type": "application/json" } })
      return pending
    })

    try {
      const bootstrap = sync.bootstrap()
      await wait(() => requests === 2)
      emit({
        directory: "/tmp/opencode/packages/opencode",
        project: "proj_test",
        payload: {
          type: "background_process.updated",
          properties: { info: processInfo(id, parent, "session", 2), scope: "/tmp/opencode/packages/opencode" },
        },
      } as unknown as GlobalEvent)
      await wait(() => sync.data.background_process[parent]?.some((item) => item.id === id))
      resolve(
        new Response(JSON.stringify([processInfo(id, child, "parent", 1)]), {
          headers: { "content-type": "application/json" },
        }),
      )
      await bootstrap

      expect(sync.data.background_process[child]).toBeUndefined()
      expect(sync.data.background_process[parent]?.[0]?.id).toBe(id)
    } finally {
      app.renderer.destroy()
    }
  })

  test("keeps persistent processes when their owner session is deleted", async () => {
    const { app, emit, sync } = await mount()
    const sessionID = "ses_owner"

    try {
      for (const info of [
        processInfo("bgp_normal", sessionID, "session", 1),
        processInfo("bgp_persistent", sessionID, "persistent", 1),
      ]) {
        emit({
          directory: "/tmp/opencode/packages/opencode",
          project: "proj_test",
          payload: {
            type: "background_process.updated",
            properties: { info, scope: "/tmp/opencode/packages/opencode" },
          },
        } as unknown as GlobalEvent)
      }
      await wait(() => sync.data.background_process[sessionID]?.length === 2)

      emit({
        directory: "/tmp/opencode/packages/opencode",
        project: "proj_test",
        payload: {
          type: "sync",
          syncEvent: {
            type: "session.deleted.1",
            id: "evt_deleted",
            seq: 0,
            aggregateID: sessionID,
            data: { sessionID },
          },
        },
      } as unknown as GlobalEvent)
      await wait(() => sync.data.background_process[sessionID]?.length === 1)

      expect(sync.data.background_process[sessionID]?.[0]?.id).toBe("bgp_persistent")
    } finally {
      app.renderer.destroy()
    }
  })

  test("applies runtime sync envelopes to the TUI message store", async () => {
    const { app, emit, sync } = await mount()
    const sessionID = "ses_wire"
    const messageID = "msg_wire"

    try {
      emit({
        directory: "/tmp/opencode/packages/opencode",
        project: "proj_test",
        payload: {
          type: "sync",
          syncEvent: {
            type: "message.updated.1",
            id: "evt_message",
            seq: 0,
            aggregateID: sessionID,
            data: {
              sessionID,
              info: {
                id: messageID,
                sessionID,
                role: "assistant",
                parentID: "msg_parent",
                mode: "code",
                agent: "code",
                path: { cwd: "/tmp/opencode", root: "/tmp/opencode" },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                modelID: "kilo-auto/free",
                providerID: "kilo",
                time: { created: 1 },
              },
            },
          },
        },
      } as unknown as GlobalEvent)
      emit({
        directory: "/tmp/opencode/packages/opencode",
        project: "proj_test",
        payload: {
          type: "sync",
          syncEvent: {
            type: "message.part.updated.1",
            id: "evt_part",
            seq: 1,
            aggregateID: sessionID,
            data: {
              sessionID,
              part: {
                id: "prt_wire",
                sessionID,
                messageID,
                type: "text",
                text: "rendered response",
              },
              time: 2,
            },
          },
        },
      } as unknown as GlobalEvent)

      await wait(() => sync.data.part[messageID]?.[0]?.type === "text")
      expect(sync.data.message[sessionID]?.[0]?.id).toBe(messageID)
      expect(sync.data.part[messageID]?.[0]).toMatchObject({ type: "text", text: "rendered response" })
    } finally {
      app.renderer.destroy()
    }
  })
})
