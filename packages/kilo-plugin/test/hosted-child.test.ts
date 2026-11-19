import { expect, test } from "bun:test"
import { History } from "../src/hosted/live-history"

test("child pages are authorized by their root; missing pages and mismatched cursors never open another session", async () => {
  const target = { scope: "account", providerID: "kilo-cloud", workspaceID: "worktree", sessionID: "root" } as const
  const signal = new AbortController().signal
  const requests: string[] = []
  const history = new History(
    target,
    async (root, path) => {
      expect(root).toEqual(target)
      const url = new URL(path, "https://worker.invalid")
      expect(url.pathname).toBe("/trpc/getSessionMessagesPage")
      const input = JSON.parse(url.searchParams.get("input")!)
      expect(input.sessionId).toBe("workspace_control")
      requests.push(input.kiloSessionId)
      return Response.json({
        result: {
          data:
            input.kiloSessionId === "child"
              ? { kind: "success", info: { id: "child" }, messages: [], nextCursor: "ABC" }
              : null,
        },
      })
    },
    "workspace_control",
  )
  const result = await history.read(signal, undefined, "child")
  expect(result.before).toBeTruthy()
  await expect(history.read(signal, result.before, "some-other-child")).rejects.toThrow("cursor expired")
  await expect(history.read(signal, undefined, "missing")).rejects.toThrow("no captured history")
  expect(requests).toEqual(["child", "missing"])
})
