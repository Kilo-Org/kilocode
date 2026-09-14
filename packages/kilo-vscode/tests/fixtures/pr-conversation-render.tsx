import assert from "node:assert/strict"
import type { WebviewMessage } from "../../webview-ui/src/types/messages"
import { harness } from "./comment-harness"

const { root, wait, mount, node } = await harness<WebviewMessage>()
const { PRConversation } = await import("../../webview-ui/agent-manager/pr/PRConversation")

const opened: string[] = []
const dispose = mount(() => (
  <PRConversation
    prNumber={42}
    prUrl="https://github.com/example/repo/pull/42"
    worktreeId="wt-timeline"
    hasEarlier
    description="Initial PR body"
    author="marius"
    createdAt={Date.now() - 120_000}
    items={[
      {
        kind: "commit",
        id: "C1",
        sha: "a".repeat(40),
        short: "aaaaaaa",
        message: "First commit",
        author: "marius",
        createdAt: Date.now() - 60_000,
        url: "https://github.com/example/repo/commit/aaaaaaa",
      },
      {
        kind: "commit",
        id: "C2",
        sha: "b".repeat(40),
        short: "bbbbbbb",
        message: "Second commit",
        author: "marius",
        createdAt: Date.now() - 50_000,
        url: "https://github.com/example/repo/commit/bbbbbbb",
      },
      {
        kind: "event",
        event: "force_pushed",
        id: "FP1",
        actor: "marius",
        detail: "aaaaaaa to bbbbbbb",
        createdAt: Date.now() - 40_000,
      },
      {
        kind: "event",
        event: "merged",
        id: "ME1",
        actor: "alice",
        detail: "main",
        createdAt: Date.now() - 35_000,
      },
      {
        kind: "review",
        id: "R1",
        author: "alice",
        body: "",
        state: "approved",
        createdAt: Date.now() - 30_000,
      },
      {
        kind: "issue",
        id: "IC1",
        author: "bob",
        body: "Please update the docs",
        createdAt: Date.now() - 20_000,
      },
    ]}
    onOpenUrl={(url) => opened.push(url)}
  />
))

await wait()
assert.match(root.textContent ?? "", /Initial PR body/)
assert.match(root.textContent ?? "", /Show earlier activity/)
assert.match(root.textContent ?? "", /marius added 2 commits/)
assert.doesNotMatch(root.textContent ?? "", /First commit/)
assert.match(root.textContent ?? "", /marius force-pushed aaaaaaa to bbbbbbb/)
assert.match(root.textContent ?? "", /alice merged into main/)
assert.match(root.textContent ?? "", /alice approved these changes/)
assert.match(root.textContent ?? "", /Please update the docs/)
const commitGroup = node<HTMLButtonElement>("[data-timeline-row][aria-expanded]")
assert.equal(commitGroup.getAttribute("aria-expanded"), "false")
commitGroup.click()
await wait()
assert.equal(commitGroup.getAttribute("aria-expanded"), "true")
assert.match(root.textContent ?? "", /First commit/)
assert.match(root.textContent ?? "", /Second commit/)
const sha = node<HTMLButtonElement>(".am-pr-timeline-link")
sha.click()
assert.deepEqual(opened, ["https://github.com/example/repo/commit/aaaaaaa"])
const timelineComment = node('[data-thread-id="IC1"]')
assert.ok(timelineComment.querySelector('.am-pr-comment-actions [data-variant="primary"]'))
dispose()
