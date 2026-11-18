import { describe, expect, it } from "bun:test"
import { openFile } from "../webview-ui/agent-manager/pr/pr-panel-actions"
import type { WebviewMessage } from "../webview-ui/src/types/messages/agent-manager"

describe("PR panel file actions", () => {
  it("opens a PR file against the worktree even when the worktree has no session", () => {
    const posted: WebviewMessage[] = []

    openFile((message) => posted.push(message), "wt-feature", "src/hello.ts", 2)

    expect(posted).toEqual([
      { type: "agentManager.openFile", sessionId: "wt-feature", filePath: "src/hello.ts", line: 2 },
    ])
  })
})
