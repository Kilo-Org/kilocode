// The worktree actions row is a shared webview component. A source check keeps both surfaces wired to it: a missing
// prop would silently drop a control that the other surface still shows, which a unit test cannot see.
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const read = (path: string) => readFileSync(resolve(import.meta.dir, path), "utf8").replace(/\r\n/g, "\n")

test("the Agent Manager chat wires the shared worktree actions row", () => {
  const app = read("../webview-ui/agent-manager/AgentManagerApp.tsx")

  expect(app).toContain("row={sessionActions}")
  expect(app).toContain("rowWhenEmpty={!!transfer.branch()}")
  expect(app).toContain("onNewWorktree={handleCreateWorktree}")
  expect(app).toContain("onMoveToWorktree=")
  expect(app).toContain("onConfigureWorktree={() => showNewWorktreeDialog()}")
  expect(app).toContain('to({ type: "agentManager.createWorktree", baseBranch: branch })')
})

test("the shared row shows Move to Worktree only with a known branch", () => {
  const row = read("../webview-ui/src/v2/session-actions-row.tsx")

  expect(row).toContain("props.hasMessages && props.branch && props.onMoveToWorktree")
})

test("the Agent Manager row needs a git repository and clears a stale branch on a project switch", () => {
  const app = read("../webview-ui/agent-manager/AgentManagerApp.tsx")

  expect(app).toContain("branch={isGitRepo() ? transfer.branch() : undefined}")
  expect(app).toContain("transfer.clear()")
})

test("the sidebar chat uses the same worktree actions row", () => {
  const chat = read("../webview-ui/src/v2/chat.tsx")

  expect(chat).toContain("<SessionActionsRow")
  expect(chat).toContain("onMoveToWorktree={session() ? moveToWorktree : undefined}")
  expect(chat).toContain("branch={transfer.branch()}")
})
