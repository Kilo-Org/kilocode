import { describe, expect, it, spyOn } from "bun:test"
import { interceptMessage } from "../../src/kilo-provider/git-changes-request"

describe("permission message interception", () => {
  it("acknowledges a dropped approval so the webview stops waiting", async () => {
    const messages: unknown[] = []
    const result = await interceptMessage(
      { type: "permissionResponse", permissionId: "p1", sessionID: "s1" },
      {
        before: async () => null,
        workspaceDir: () => "/workspace",
        post: (message) => messages.push(message),
        error: String,
      },
    )

    expect(result).toBeNull()
    expect(messages).toEqual([{ type: "permissionError", permissionID: "p1" }])
  })

  it("acknowledges an interceptor failure", async () => {
    const messages: unknown[] = []
    const log = spyOn(console, "error").mockImplementation(() => {})
    try {
      await interceptMessage(
        { type: "permissionResponse", permissionId: "p1", sessionID: "s1" },
        {
          before: async () => {
            throw new Error("Project unavailable")
          },
          workspaceDir: () => "/workspace",
          post: (message) => messages.push(message),
          error: String,
        },
      )
      expect(messages).toEqual([{ type: "permissionError", permissionID: "p1" }])
    } finally {
      log.mockRestore()
    }
  })

  it("passes routed approvals through without an error", async () => {
    const messages: unknown[] = []
    const message = { type: "permissionResponse", permissionId: "p1", sessionID: "s1" }
    const result = await interceptMessage(message, {
      before: async (msg) => msg,
      workspaceDir: () => "/workspace",
      post: (msg) => messages.push(msg),
      error: String,
    })

    expect(result).toBe(message)
    expect(messages).toEqual([])
  })
})
