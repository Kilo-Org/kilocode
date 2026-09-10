import assert from "node:assert/strict"
import { harness } from "./comment-harness"
import type { PRReviewRequest } from "../../src/shared/pr-comment-actions"

const { window, root, messages, node, button, input, type, last, respond, wait, mount } =
  await harness<PRReviewRequest>()
const { PRCommentForm } = await import("../../webview-ui/agent-manager/pr/PRCommentForm")
const saved: string[] = []
const sent: string[] = []
let cancelled = 0
let completed = 0
let reads = 0
const initial = () => {
  reads++
  return ""
}
const release = mount(() => (
  <>
    <div id="local">
      <PRCommentForm
        inline
        action="local"
        worktreeId="inline-test"
        file="example.ts"
        side="RIGHT"
        startLine={2}
        endLine={2}
        selectedText="return 1"
        submitOnEnter
        onSubmit={(body) => saved.push(body)}
        onSend={(body) => sent.push(body)}
        onCancel={() => cancelled++}
        onEscape={() => cancelled++}
      />
    </div>
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
        initialBody={initial()}
        onSuccess={() => completed++}
        onCancel={() => cancelled++}
      />
    </div>
  </>
))
await wait()
const local = node("#local")
const remote = node("#remote")
assert.equal(root.querySelector('[data-slot="comment-toolbar"]'), null, "no second toolbar in inline forms")
assert.equal(button("submit", local).textContent, "Save local")
assert.equal(button("send", local).textContent, "Send")
assert.equal(button("send", local).getAttribute("aria-label"), "Send to agent")
assert.equal(button("submit", remote).textContent, "Post to GitHub")
assert.equal(button("discard", remote).textContent, "Cancel")
const before = reads
type(local, "Preview **this**")
assert.equal(reads, before, "typing in one form does not invalidate unrelated drafts")
button("preview", local).click()
await wait()
assert.match(node('[data-slot="comment-preview"]', local).textContent ?? "", /Preview this/)
button("write", local).click()
assert.equal(document.activeElement, input(local))
input(local).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }))
assert.equal(saved.length, 0, "Shift+Enter does not submit")
input(local).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }))
assert.equal(saved.length, 0, "IME confirmation does not submit")
input(local).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
assert.deepEqual(saved, ["Preview **this**"])
assert.equal(messages.length, 0, "local save never requests a GitHub write")
type(local, "Send this")
button("send", local).click()
assert.deepEqual(sent, ["Send this"])
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
button("cancel", local).click()
assert.equal(cancelled, 1)
release()
await window.happyDOM.close()
