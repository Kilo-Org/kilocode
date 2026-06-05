import { describe, expect, it } from "bun:test"
import { renameSession } from "../../src/kilo-provider/rename-session"
import { SESSION_TITLE_LIMIT } from "../../src/shared/session-title"

type Params = { sessionID: string; directory?: string; title?: string }

function client() {
  const calls: Params[] = []
  return {
    calls,
    value: {
      session: {
        update: async (params: Params) => {
          calls.push(params)
          return {
            data: {
              id: params.sessionID,
              title: params.title,
              time: { created: 1, updated: 2 },
            },
          }
        },
      },
    },
  }
}

describe("renameSession", () => {
  it("normalizes and persists a valid title through the backend client", async () => {
    const api = client()

    const updated = await renameSession({
      client: api.value as never,
      sessionID: "ses_1",
      title: "  Rename active session  ",
      directory: "/repo",
    })

    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]).toEqual({ sessionID: "ses_1", directory: "/repo", title: "Rename active session" })
    expect(updated.title).toBe("Rename active session")
  })

  it("rejects unsafe titles before they reach the backend", async () => {
    const api = client()
    const input = [" ", "a".repeat(SESSION_TITLE_LIMIT + 1), "Title\nSecond line", "Title\u202espoof"]

    for (const title of input) {
      await expect(
        renameSession({ client: api.value as never, sessionID: "ses_1", title, directory: "/repo" }),
      ).rejects.toThrow("Invalid session title")
    }

    expect(api.calls).toEqual([])
  })
})
