import assert from "node:assert/strict"
import { harness } from "./comment-harness"
import type { PRComment } from "../../webview-ui/agent-manager/pr/pr-types"

const {
  window,
  root,
  messages,
  button,
  type,
  mount,
  wait: settle,
} = await harness<{ type: string; [key: string]: unknown }>()
const { createSignal } = await import("solid-js")
const { Diff } = await import("@kilocode/kilo-ui/diff")
const { post: emit } = await import("../../webview-ui/src/utils/webview-message")
const { createPRReview } = await import("../../webview-ui/agent-manager/pr/review")
const { createRemoteCommentController, RemoteCommentsOutside } = await import(
  "../../webview-ui/diff-viewer/remote-comment-renderer"
)
const comment: PRComment = {
  id: "root",
  threadId: "thread",
  author: "reviewer",
  body: "Check this change",
  file: "file.ts",
  line: 2,
  side: "additions",
  resolved: false,
  outdated: false,
  canEdit: true,
  canDelete: true,
}
const [comments, setComments] = createSignal([comment])
const [project, setProject] = createSignal("project-a")
const [fallback, setFallback] = createSignal(false)
const ready = Promise.withResolvers<ReturnType<typeof createRemoteCommentController>>()
root.className = "am-diff-panel"
const Probe = () => {
  const review = createPRReview({
    context: () => "worktree-a",
    project,
    current: () => undefined,
    sessions: () => [],
    managed: () => [],
    statuses: () => ({
      "worktree-a": {
        number: 42,
        url: "https://github.com/example/repo/pull/42",
        comments: { total: comments().length, unresolved: 1, comments: comments() },
      },
    }),
    select: () => undefined,
    show: () => undefined,
  })
  const remote = createRemoteCommentController({
    key: () => project(),
    comments: () => (fallback() ? [{ ...comment, id: "thread", outdated: true }] : comments()),
    target: (item) => review.target("worktree-a", item),
    applySuggestions: () => false,
    diffs: () => [{ file: "file.ts", before: "one\n", after: "one\ntwo\n", additions: 1, deletions: 0 }],
    active: () => true,
    activeTerminalId: () => undefined,
  })
  const annotations = remote.annotations("file.ts")
  ready.resolve(remote)
  return (
    <>
      <Diff
        before={{ name: "file.ts", contents: "one\n" }}
        after={{ name: "file.ts", contents: "one\ntwo\n" }}
        diffStyle="unified"
        virtualized={false}
        visible
        annotations={annotations()}
        renderAnnotation={(annotation) => (annotation.metadata ? remote.render(annotation.metadata) : undefined)}
      />
      <RemoteCommentsOutside controller={remote} />
    </>
  )
}
const dispose = mount(() => <Probe />)
await window.happyDOM.waitUntilComplete()
const remote = await ready.promise
const card = () => root.querySelector<HTMLElement>('[data-thread-id="thread"]')!
const reply = () => card().querySelector<HTMLElement>('[data-action="reply"]')!
assert.ok(root.querySelector("diffs-container")?.shadowRoot?.querySelector("[data-line]"))
assert.ok(card(), "actual diff annotation contains the shared card")
assert.equal(card().querySelector('[data-action="preview-suggestion"]'), null)
button("expand", reply()).click()
await settle()
const textarea = reply().querySelector<HTMLTextAreaElement>("textarea")!
type(reply(), "  First line\n\n```suggestion\nsecond\n```\n")
textarea.focus()
textarea.setSelectionRange(2, 7)
setComments([{ ...comment, body: "Updated on poll" }])
await settle()
assert.equal(reply().querySelector("textarea"), textarea)
assert.equal(document.activeElement, textarea)
assert.equal(textarea.selectionStart, 2)
button("submit", reply()).click()
await settle()
const sent = messages.findLast((message) => message.type === "agentManager.replyComment")!
assert.equal(sent.projectId, "project-a")
assert.equal(sent.worktreeId, "worktree-a")
assert.equal(sent.threadId, "thread")
assert.equal(sent.body, textarea.value)
emit({ ...sent, type: "agentManager.replyCommentResult", projectId: "foreign", success: true })
await settle()
assert.ok(reply().querySelector<HTMLButtonElement>('[data-action="submit"]')!.disabled)
emit({ ...sent, type: "agentManager.replyCommentResult", success: true })
await settle()
assert.equal(reply().querySelector("textarea"), null)
const resolve = [...card().querySelectorAll<HTMLButtonElement>("button")].find(
  (node) => node.textContent?.trim() === "Resolve",
)!
resolve.click()
await settle()
const action = messages.findLast((message) => message.type === "agentManager.resolveComment")!
assert.equal(action.prNumber, 42)
assert.equal(action.prUrl, "https://github.com/example/repo/pull/42")
emit({ ...action, type: "agentManager.resolveCommentResult", success: false, error: "denied" })
await settle()
assert.match(card().textContent ?? "", /denied/)
resolve.click()
emit({ ...action, type: "agentManager.resolveCommentResult", success: true })
setComments([{ ...comment, resolved: true }])
await settle()
assert.ok(
  [...card().querySelectorAll<HTMLButtonElement>("button")].some(
    (node) => node.textContent?.trim() === "Unresolve" && !node.disabled,
  ),
)
button("toggle-thread", card()).click()
await settle()
assert.equal(card().querySelector('[data-action="reply"]'), null)
button("toggle-thread", card()).click()
await settle()
assert.ok(reply())
setFallback(true)
await settle()
assert.equal(card().querySelector('[data-action="reply"]'), null, "transcript fallback has no live root identity")
assert.equal(card().querySelector('[data-action="edit"]'), null)
assert.equal(card().querySelector('[data-action="delete"]'), null)
setFallback(false)
setProject("project-b")
await settle()
// A project switch disposes annotations; remount the same canonical thread under its new route.
const meta = remote.annotations("file.ts")()[0]!.metadata!
root.append(remote.render(meta)!)
remote.open("thread")
await settle()
assert.ok(reply())
button("expand", reply()).click()
await settle()
type(reply(), "Reply in the new project")
button("submit", reply()).click()
assert.equal(messages.findLast((message) => message.type === "agentManager.replyComment")?.projectId, "project-b")
const pending = messages.findLast((message) => message.type === "agentManager.replyComment")!
emit({ ...pending, type: "agentManager.replyCommentResult", success: true })
await settle()
dispose()
await window.happyDOM.waitUntilComplete()
window.happyDOM.abort()
