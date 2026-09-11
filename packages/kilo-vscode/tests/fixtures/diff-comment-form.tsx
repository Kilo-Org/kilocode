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
const release = mount(() => (
  <>
    <div id="local">
      <PRCommentForm
        inline
        action="diff"
        worktreeId="diff-test"
        file="example.ts"
        side="RIGHT"
        startLine={2}
        endLine={2}
        selectedText="return 1"
        destination="local"
        onSave={(body) => saved.push(body)}
        onSendKilo={(body) => sent.push(body)}
        onGithubSuccess={() => completed++}
        onCancel={() => cancelled++}
        onDestinationChange={() => {}}
      />
    </div>
    <div id="remote">
      <PRCommentForm
        inline
        action="diff"
        worktreeId="diff-test"
        file="other.ts"
        side="RIGHT"
        startLine={5}
        endLine={5}
        selectedText="old line"
        destination="github"
        github={{
          prNumber: 1,
          prUrl: "https://github.com/example/fixture/pull/1",
          snapshotId: "snapshot",
          label: "GitHub #1",
          closed: false,
        }}
        onSave={() => {}}
        onSendKilo={() => {}}
        onGithubSuccess={() => completed++}
        onCancel={() => cancelled++}
        onDestinationChange={() => {}}
      />
    </div>
    <div id="remote2">
      <PRCommentForm
        inline
        action="diff"
        worktreeId="diff-test"
        file="other.ts"
        side="RIGHT"
        startLine={5}
        endLine={5}
        selectedText="old line"
        destination="github"
        github={{
          prNumber: 2,
          prUrl: "https://github.com/example/fixture/pull/2",
          snapshotId: "snapshot-2",
          label: "GitHub #2",
          closed: false,
        }}
        onSave={() => {}}
        onSendKilo={() => {}}
        onGithubSuccess={() => completed++}
        onCancel={() => cancelled++}
        onDestinationChange={() => {}}
      />
    </div>
  </>
))
await wait()
const local = node("#local")
const remote = node("#remote")
const remote2 = node("#remote2")

// Local-only destination exposes Kilo actions, never the GitHub split button.
assert.equal(button("send-kilo", local).textContent, "Send to Kilo")
assert.equal(button("save", local).textContent, "Save")
assert.equal(button("cancel", local).textContent, "Cancel")
assert.equal(local.querySelector('[data-action="send-primary"]'), null, "no split button without a PR")
assert.equal(messages.length, 0)

type(local, "Keep this")
button("save", local).click()
assert.deepEqual(saved, ["Keep this"])
assert.equal(input(local).value, "", "saving clears the composer")
type(local, "Send this")
button("send-kilo", local).click()
assert.deepEqual(sent, ["Send this"])
assert.equal(input(local).value, "", "sending to Kilo clears the composer")

// Plain Enter sends to Kilo and never posts to GitHub.
type(local, "Keyboard send")
input(local).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
assert.deepEqual(sent, ["Send this", "Keyboard send"])
assert.equal(messages.length, 0, "local actions never request a GitHub write")

// Cmd/Ctrl+Enter saves the comment locally instead of sending it.
type(local, "Keyboard save")
input(local).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }))
assert.deepEqual(saved, ["Keep this", "Keyboard save"], "Cmd+Enter saves the comment")
assert.deepEqual(sent, ["Send this", "Keyboard send"], "Cmd+Enter does not send to Kilo")
assert.equal(messages.length, 0, "Cmd+Enter never requests a GitHub write")

// The remembered GitHub destination drives the split primary label.
assert.equal(button("send-primary", remote).textContent, "Send to GitHub #1")
node('[aria-label="Choose destination"]', remote)

// Enter is not bound to the GitHub destination, so it cannot publish by accident.
type(remote, "Do not post")
input(remote).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
assert.equal(messages.length, 0, "Enter never posts to GitHub")
assert.equal(input(remote2).value, "", "a draft is scoped to its own PR identity")

type(remote, "Post me")
button("send-primary", remote).click()
const request = last()
assert.equal(request.type, "agentManager.createReviewComment")
assert.equal(input(remote).disabled, true)
button("send-primary", remote).click()
assert.equal(messages.length, 1, "double submission cannot publish twice")
respond(request, {})
assert.equal(completed, 1)

button("cancel", local).click()
assert.equal(cancelled, 1)
release()
await window.happyDOM.close()
