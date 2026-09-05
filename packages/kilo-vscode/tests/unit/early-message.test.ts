import { describe, expect, it } from "bun:test"
import { routeEarlyMessage } from "../../src/kilo-provider/early-message"

type Ctx = Parameters<typeof routeEarlyMessage>[1]

function context(copied: string[], posted: unknown[], fail = false) {
  return {
    copy: async (text: string) => {
      if (fail) throw new Error("clipboard unavailable")
      copied.push(text)
    },
    post: (message: unknown) => posted.push(message),
  } as Ctx
}

describe("routeEarlyMessage clipboard handling", () => {
  it("routes clipboard text to the host", async () => {
    const copied: string[] = []
    const posted: unknown[] = []

    const handled = await routeEarlyMessage(
      { type: "copyToClipboard", id: "copy-1", text: "message text" },
      context(copied, posted),
    )

    expect(handled).toBe(true)
    expect(copied).toEqual(["message text"])
    expect(posted).toEqual([{ type: "clipboardWriteResult", id: "copy-1", ok: true }])
  })

  it("reports host clipboard failures", async () => {
    const copied: string[] = []
    const posted: unknown[] = []

    const handled = await routeEarlyMessage(
      { type: "copyToClipboard", id: "copy-2", text: "message text" },
      context(copied, posted, true),
    )

    expect(handled).toBe(true)
    expect(copied).toEqual([])
    expect(posted).toEqual([{ type: "clipboardWriteResult", id: "copy-2", ok: false, error: "clipboard unavailable" }])
  })
})

describe("routeEarlyMessage resume", () => {
  it("forwards the original session, assistant, and request IDs without sending text", async () => {
    const calls: string[][] = []
    const ctx = {
      resume: async (...ids: string[]) => {
        calls.push(ids)
      },
    } as Ctx
    const message = { type: "resumeSession", sessionID: "ses_1", messageID: "msg_1", requestID: "request-1" }
    expect(await routeEarlyMessage(message, ctx)).toBe(true)
    expect(calls).toEqual([["ses_1", "msg_1", "request-1"]])
    expect(await routeEarlyMessage({ ...message, messageID: undefined }, ctx)).toBe(true)
    expect(calls).toHaveLength(1)
  })
})

describe("routeEarlyMessage activity", () => {
  it("forwards authoritative webview presentation state without interpreting session events", async () => {
    const calls: unknown[] = []
    const ctx = { activity: (state: unknown) => calls.push(state) } as Ctx
    for (const state of ["busy", "waiting", "done", "error", "idle"]) {
      expect(await routeEarlyMessage({ type: "sessionActivity", state }, ctx)).toBe(true)
    }
    expect(calls).toEqual(["busy", "waiting", "done", "error", "idle"])
  })
})

describe("routeEarlyMessage background jobs", () => {
  it("forwards board requests without losing owner, project, or revision", async () => {
    const calls: unknown[] = []
    const ctx = {
      board: async (message: Record<string, unknown>) => {
        calls.push(message)
        return true
      },
    } as Ctx
    const message = {
      type: "resetSessionBoard",
      sessionID: "ses_owner",
      requestID: "reset-1",
      projectId: "project-1",
      revision: 12,
    }
    expect(await routeEarlyMessage(message, ctx)).toBe(true)
    expect(calls).toEqual([message])
  })

  it("forwards list request correlation", async () => {
    const calls: unknown[] = []
    const ctx = {
      backgroundJobs: async (sessionID: string, requestID: string) => calls.push([sessionID, requestID]),
    } as Ctx

    expect(
      await routeEarlyMessage({ type: "requestBackgroundJobs", sessionID: "ses_parent", requestID: "request-1" }, ctx),
    ).toBe(true)
    expect(calls).toEqual([["ses_parent", "request-1"]])
  })

  it("forwards cancellation through the owning parent session", async () => {
    const calls: unknown[] = []
    const ctx = {
      cancelBackgroundJob: async (jobID: string, sessionID: string, requestID: string) =>
        calls.push([jobID, sessionID, requestID]),
    } as Ctx

    expect(
      await routeEarlyMessage(
        {
          type: "cancelBackgroundJob",
          jobID: "ses_child",
          sessionID: "ses_parent",
          requestID: "request-2",
        },
        ctx,
      ),
    ).toBe(true)
    expect(calls).toEqual([["ses_child", "ses_parent", "request-2"]])
  })

  it("forwards promotion for one child through its owning parent session", async () => {
    const calls: unknown[] = []
    const ctx = {
      promoteBackgroundJob: async (jobID: string, sessionID: string) => calls.push([jobID, sessionID]),
    } as Ctx

    expect(
      await routeEarlyMessage({ type: "promoteBackgroundJob", jobID: "ses_child_a", sessionID: "ses_parent" }, ctx),
    ).toBe(true)
    expect(calls).toEqual([["ses_child_a", "ses_parent"]])
  })
})
