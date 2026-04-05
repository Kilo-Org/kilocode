import { beforeEach, describe, expect, it, mock } from "bun:test"

const parseSession = mock(async () => ({
  project: {
    id: "project-local",
    worktree: "/workspace/testing",
    sandboxes: ["/workspace/testing"],
    timeCreated: 1,
    timeUpdated: 1,
  },
  session: {
    id: "ses_local",
    projectID: "project-local",
    slug: "legacy-task-1",
    directory: "/workspace/testing",
    title: "Legacy task",
    version: "v2",
    timeCreated: 1,
    timeUpdated: 1,
  },
  messages: [],
  parts: [],
}))

mock.module("../../../src/legacy-migration/sessions/parser", () => ({
  parseSession,
}))

const { migrate } = await import("../../../src/legacy-migration/sessions/migrate")

function ctx() {
  return {
    globalStorageUri: { path: "/storage" },
    globalState: {
      get: (key: string) => {
        if (key === "taskHistory") return [{ id: "legacy-task-1", workspace: "/workspace/testing" }]
        return undefined
      },
      update: async () => undefined,
    },
  }
}

function client() {
  const calls: Array<{ name: string; body: unknown }> = []
  return {
    calls,
    kilocode: {
      sessionImport: {
        project: async (body: unknown) => {
          calls.push({ name: "project", body })
          return { data: { id: "project-real" } }
        },
        session: async (body: unknown) => {
          calls.push({ name: "session", body })
          return { data: { ok: true } }
        },
        message: async (body: unknown) => {
          calls.push({ name: "message", body })
          return { data: { ok: true } }
        },
        part: async (body: unknown) => {
          calls.push({ name: "part", body })
          return { data: { ok: true } }
        },
      },
    },
  }
}

describe("legacy migration migrate", () => {
  beforeEach(() => {
    parseSession.mockClear()
  })

  it("inserts project then session then message then part in the correct order", async () => {
    const calls: string[] = []
    const api = {
      kilocode: {
        sessionImport: {
          project: async () => {
            calls.push("project")
            return { data: { id: "project-real" } }
          },
          session: async () => {
            calls.push("session")
            return { data: { ok: true } }
          },
          message: async () => {
            calls.push("message")
            return { data: { ok: true } }
          },
          part: async () => {
            calls.push("part")
            return { data: { ok: true } }
          },
        },
      },
    }

    parseSession.mockResolvedValueOnce({
      project: {
        id: "project-local",
        worktree: "/workspace/testing",
        sandboxes: ["/workspace/testing"],
        timeCreated: 1,
        timeUpdated: 1,
      },
      session: {
        id: "ses_local",
        projectID: "project-local",
        slug: "legacy-task-1",
        directory: "/workspace/testing",
        title: "Legacy task",
        version: "v2",
        timeCreated: 1,
        timeUpdated: 1,
      },
      messages: [
        {
          id: "msg_1",
          sessionID: "ses_local",
          timeCreated: 1,
          data: {
            role: "user",
            time: { created: 1 },
            agent: "user",
            model: { providerID: "legacy", modelID: "legacy" },
          },
        },
      ] as never,
      parts: [
        {
          id: "prt_1",
          sessionID: "ses_local",
          messageID: "msg_1",
          timeCreated: 1,
          data: {
            type: "text",
            text: "hello",
            time: { start: 1, end: 1 },
          },
        },
      ] as never,
    })

    await migrate("legacy-task-1", ctx() as never, api as never)

    expect(calls).toEqual(["project", "session", "message", "part"])
  })

  it("uses the projectID returned by backend when inserting the session", async () => {
    const api = client()

    await migrate("legacy-task-1", ctx() as never, api as never)

    const call = api.calls.find((x) => x.name === "session")
    expect(call).toBeDefined()
    expect((call?.body as { projectID: string }).projectID).toBe("project-real")
  })

  it("returns ok false without throwing when one backend insert fails", async () => {
    const api = {
      kilocode: {
        sessionImport: {
          project: async () => ({ data: { id: "project-real" } }),
          session: async () => {
            throw new Error("session failed")
          },
          message: async () => ({ data: { ok: true } }),
          part: async () => ({ data: { ok: true } }),
        },
      },
    }

    const result = await migrate("legacy-task-1", ctx() as never, api as never)

    expect(result.ok).toBe(false)
  })

  it("skips message and part imports when backend reports the session already exists", async () => {
    const calls: string[] = []
    const api = {
      kilocode: {
        sessionImport: {
          project: async () => {
            calls.push("project")
            return { data: { id: "project-real" } }
          },
          session: async () => {
            calls.push("session")
            return { data: { ok: true, skipped: true } }
          },
          message: async () => {
            calls.push("message")
            return { data: { ok: true } }
          },
          part: async () => {
            calls.push("part")
            return { data: { ok: true } }
          },
        },
      },
    }

    const result = await migrate("legacy-task-1", ctx() as never, api as never)

    expect(result.ok).toBe(true)
    expect(result).toHaveProperty("skipped", true)
    expect(calls).toEqual(["project", "session"])
  })
})
