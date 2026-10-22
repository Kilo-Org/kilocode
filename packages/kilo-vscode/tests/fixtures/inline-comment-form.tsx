import assert from "node:assert/strict"
import { harness } from "./comment-harness"
import type { PRReviewRequest } from "../../src/shared/pr-comment-actions"

const { window, root, messages, node, button, input, type, last, respond, wait, mount } =
  await harness<PRReviewRequest>()
const { PRCommentForm } = await import("../../webview-ui/agent-manager/pr/PRCommentForm")
let cancelled = 0
let completed = 0
const release = mount(() => (
  <div id="remote">
    <PRCommentForm
      inline
      action="line"
      worktreeId="inline-test"
      prNumber={1}
      prUrl="https://github.com/example/fixture/pull/1"
      snapshotId="snapshot"
      path="example.ts"
      side="RIGHT"
      startLine={2}
      endLine={2}
      onSuccess={() => completed++}
      onCancel={() => cancelled++}
    />
  </div>
))
await wait()
const remote = node("#remote")
assert.equal(root.querySelector('[data-slot="comment-toolbar"]'), null, "no second toolbar in inline forms")
assert.equal(button("submit", remote).textContent, "Post to GitHub")
assert.equal(button("discard", remote).textContent, "Cancel")
type(remote, "Review this line")
button("submit", remote).click()
const request = last()
assert.equal(request.type, "agentManager.createReviewComment")
assert.equal(input(remote).disabled, true)
button("submit", remote).click()
assert.equal(messages.length, 1, "double submission cannot publish twice")
respond(request, { success: false, error: "Snapshot changed" })
assert.equal(input(remote).value, "Review this line")
assert.match(remote.textContent ?? "", /Snapshot changed/)
button("submit", remote).click()
respond(last(), {})
assert.equal(completed, 1)
button("discard", remote).click()
assert.equal(cancelled, 1)
release()
await window.happyDOM.close()
