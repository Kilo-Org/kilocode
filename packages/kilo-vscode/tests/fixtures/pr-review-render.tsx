import assert from "node:assert/strict"
import { harness } from "./comment-harness"
import type { PRDiffSnapshot, PRReviewRequest } from "../../src/shared/pr-comment-actions"

const { window, root, messages, node, button, input, type, last, respond, wait, mount } =
  await harness<PRReviewRequest>()
const { createSignal, Show } = await import("solid-js")
const { PRFiles } = await import("../../webview-ui/agent-manager/pr/PRFiles")
const { PRCommentMarkdown } = await import("../../webview-ui/agent-manager/pr/PRCommentMarkdown")

const target = {
  projectId: "project-review",
  worktreeId: "wt-review",
  prNumber: 42,
  prUrl: "https://github.com/example/repo/pull/42",
}
const snapshot: PRDiffSnapshot = {
  id: "snapshot-original",
  head: "a".repeat(40),
  files: [
    {
      path: "src/first.ts",
      status: "modified",
      patch: "@@ -1,3 +1,3 @@\n const before = 1\n-const old = 2\n+const changed = 2\n const end = 3\n",
    },
    {
      path: "src/second.ts",
      status: "modified",
      patch: "@@ -4,2 +4,2 @@\n-old four\n-old five\n+new four\n+new five\n",
    },
    { path: "image.png", status: "modified" },
  ],
}
const [visible, setVisible] = createSignal(true)
const [own, setOwn] = createSignal(false)
const [closed, setClosed] = createSignal(false)
let refreshed = 0
const release = mount(() => (
  <>
    <Show when={visible()}>
      <PRFiles {...target} own={own()} closed={closed()} onRefresh={() => refreshed++} />
    </Show>
    <div id="published">
      <PRCommentMarkdown
        text={"Published\n\n```suggestion\nreplacement\n```\n\n```suggestion\nsecond replacement\n```"}
        published={{ ...target, commentId: "PRRC_published" }}
      />
    </div>
    <div id="unpublished">
      <PRCommentMarkdown text={"Draft\n\n```suggestion\nnot published\n```"} />
    </div>
  </>
))
const files = () => node('[data-component="pr-files"]')
const composer = () => node('[data-action="line"]', files())
const review = () => node('[data-action="review"]', files())
await wait()
assert.equal(root.querySelector('#unpublished [data-component="pr-suggestion"]'), null)
assert.equal(root.querySelector('[data-action="apply-suggestion"]'), null)
button("load-files").click()
const load = last()
assert.deepEqual(load, { ...target, type: "agentManager.loadPRFiles", requestId: load.requestId })
button("load-files").click()
assert.equal(messages.length, 1, "snapshot loads cannot duplicate while pending")
respond(load, { projectId: "other", snapshot })
assert.equal(button("load-files").disabled, true)
respond(load, { snapshot })
await wait()
assert.match(node('[data-slot="review-head"]').textContent ?? "", new RegExp(snapshot.head))
node<HTMLButtonElement>('button[data-path="image.png"]').click()
assert.equal(
  files().querySelector('[data-slot="review-file-diff"]'),
  null,
  "unproven patches cannot create a line comment",
)
node<HTMLButtonElement>('button[data-path="src/second.ts"]').click()
await wait()

// Use Pierre's actual gutter pointer events, not component callbacks or range helpers.
const select = async (start: number, end: number, side: "addition" | "deletion", finish = side) => {
  const shadow = node("diffs-container", node('[data-slot="review-file-diff"]')).shadowRoot!
  const first = node(`[data-column-number="${start}"][data-line-type="change-${side}"]`, shadow)
  const final = node(`[data-column-number="${end}"][data-line-type="change-${finish}"]`, shadow)
  // Happy DOM has no layout. Resolve the pointer against its actual target row.
  Object.defineProperty(shadow, "elementFromPoint", { configurable: true, value: () => final })
  first.dispatchEvent(
    new window.PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
    }),
  )
  final.dispatchEvent(
    new window.PointerEvent("pointermove", { bubbles: true, composed: true, pointerId: 1, pointerType: "mouse" }),
  )
  final.dispatchEvent(
    new window.PointerEvent("pointerup", { bubbles: true, composed: true, pointerId: 1, pointerType: "mouse" }),
  )
  await wait()
}
await select(4, 5, "deletion", "addition")
assert.equal(files().querySelector('[data-action="line"]'), null, "mixed-side range must not create a composer")
await select(4, 5, "addition")
assert.equal(button("submit", composer()).disabled, true)
assert.equal(window.document.activeElement, input(composer()), "line selection focuses the composer after layout")
button("review-approve", review()).click()
assert.equal(button("submit", review()).disabled, true, "finish or discard the line draft before submitting a review")
button("review-comment", review()).click()
button("suggestion", composer()).click()
assert.match(input(composer()).value, /```suggestion\nnew four\nnew five\n```/)
type(composer(), "  Review **these lines**\nwithout trimming  ")
const body = input(composer()).value
node<HTMLButtonElement>('button[data-path="src/first.ts"]').click()
button("submit", composer()).click()
const comment = last()
assert.deepEqual(comment, {
  ...target,
  type: "agentManager.createReviewComment",
  requestId: comment.requestId,
  snapshotId: snapshot.id,
  path: "src/second.ts",
  side: "RIGHT",
  startLine: 4,
  endLine: 5,
  body,
})
assert.equal(input(composer()).disabled, true)
button("submit", composer()).click()
assert.equal(last(), comment)
respond(comment, { prUrl: "https://github.com/other/repo/pull/42" })
assert.equal(input(composer()).disabled, true)
setVisible(false)
respond(comment, { success: false, error: "PR snapshot is stale" })
setVisible(true)
await wait()
assert.equal(input(composer()).value, body)
assert.match(composer().textContent ?? "", /PR snapshot is stale/)
assert.match(node('[data-slot="review-head"]').textContent ?? "", new RegExp(snapshot.head))
button("submit", composer()).click()
assert.equal((last() as { snapshotId?: string }).snapshotId, snapshot.id)
respond(last(), {})
assert.equal(refreshed, 1)
assert.equal(files().querySelector('[data-action="line"]'), null)
node<HTMLButtonElement>('button[data-path="src/second.ts"]').click()
await wait()
await select(4, 5, "deletion")
assert.equal(composer().querySelector('[data-action="suggestion"]'), null, "LEFT comments cannot propose RIGHT source")
type(composer(), "Old lines")
button("submit", composer()).click()
assert.equal((last() as { side?: string }).side, "LEFT")
respond(last(), {})
assert.equal(files().querySelector('[data-action="line"]'), null)

assert.equal(button("submit", review()).disabled, true, "COMMENT requires a reason")
button("review-request-changes", review()).click()
type(review(), "  ")
assert.equal(button("submit", review()).disabled, true, "REQUEST_CHANGES requires a reason")
type(review(), "  Please fix\nthis issue  ")
button("submit", review()).click()
const submitted = last()
assert.deepEqual(submitted, {
  ...target,
  type: "agentManager.submitPRReview",
  snapshotId: snapshot.id,
  requestId: submitted.requestId,
  head: snapshot.head,
  event: "REQUEST_CHANGES",
  body: "  Please fix\nthis issue  ",
})
assert.equal(button("review-approve", review()).disabled, true)
respond(submitted, { requestId: "unrelated" })
assert.equal(button("submit", review()).disabled, true)
respond(submitted, { success: false, error: "Head changed" })
assert.equal(input(review()).value, "  Please fix\nthis issue  ")
assert.match(review().textContent ?? "", /Head changed/)
button("review-approve", review()).click()
type(review(), "")
assert.equal(button("submit", review()).disabled, false, "APPROVE permits an empty body")
button("submit", review()).click()
assert.equal((last() as { event?: string }).event, "APPROVE")
assert.equal((last() as { body?: string }).body, "")
respond(last(), {})
assert.ok(review().querySelector('[role="status"]'))
assert.equal(
  button("submit", review()).disabled,
  true,
  "successful approval cannot be submitted again by a second click",
)
button("review-approve", review()).click()
setOwn(true)
assert.equal(button("review-approve", review()).disabled, true)
assert.equal(button("review-request-changes", review()).disabled, true)
assert.equal(button("submit", review()).disabled, true, "ownership change blocks a previously selected approval")
button("review-comment", review()).click()
type(review(), "Author comment")
assert.equal(button("submit", review()).disabled, false)
button("submit", review()).click()
assert.equal((last() as { event?: string }).event, "COMMENT")
assert.equal((last() as { head?: string }).head, snapshot.head)
respond(last(), {})
setClosed(true)
assert.equal(files().querySelector('[data-action="review"]'), null, "closed PR has no review submission")
setClosed(false)
button("load-files").click()
const reload = last()
await wait()
await select(4, 5, "addition")
assert.equal(
  files().querySelector('[data-action="line"]'),
  null,
  "reload cannot bind an old displayed range to a new snapshot",
)
respond(reload, { success: false, error: "Reload failed" })
assert.match(files().textContent ?? "", /Reload failed/)
assert.match(node('[data-slot="review-head"]').textContent ?? "", new RegExp(snapshot.head))

const suggestions = root.querySelectorAll('#published [data-component="pr-suggestion"]')
assert.equal(suggestions.length, 2)
const suggestion = suggestions.item(1)
button("preview-suggestion", suggestion).click()
const preview = last()
assert.deepEqual(preview, {
  ...target,
  type: "agentManager.previewPRSuggestion",
  requestId: preview.requestId,
  commentId: "PRRC_published",
  suggestion: 1,
})
button("preview-suggestion", suggestion).click()
assert.equal(last(), preview)
respond(preview, { worktreeId: "wrong", preview: { token: "wrong", path: "wrong", patch: "" } })
assert.equal(button("preview-suggestion", suggestion).disabled, true)
respond(preview, { success: false, error: "Source changed" })
assert.match(suggestion.textContent ?? "", /Source changed/)
button("preview-suggestion", suggestion).click()
const change = {
  token: "preview-token",
  path: "src/actual.ts",
  patch: "@@ -1 +1 @@\n-local content\n+actual replacement\n",
}
respond(last(), { preview: change })
await wait()
assert.match(node("diffs-container", suggestion).shadowRoot?.textContent ?? "", /actual replacement/)
assert.match(node("diffs-container", suggestion).shadowRoot?.textContent ?? "", /local content/)
const count = messages.length
button("cancel-suggestion", suggestion).click()
assert.equal(messages.length, count, "cancel does not request a write")
assert.equal(suggestion.querySelector('[data-action="apply-suggestion"]'), null)
button("preview-suggestion", suggestion).click()
respond(last(), { preview: change })
await wait()
button("apply-suggestion", suggestion).click()
const apply = last()
assert.deepEqual(apply, {
  ...target,
  type: "agentManager.applyPRSuggestion",
  requestId: apply.requestId,
  token: change.token,
})
assert.equal(button("cancel-suggestion", suggestion).disabled, true)
button("apply-suggestion", suggestion).click()
assert.equal(last(), apply)
respond(apply, { prNumber: 99 })
assert.equal(button("apply-suggestion", suggestion).disabled, true)
respond(apply, { success: false, error: "Worktree changed" })
assert.match(suggestion.textContent ?? "", /Worktree changed/)
assert.equal(suggestion.querySelector('[data-action="apply-suggestion"]'), null, "a failed apply consumes its token")
assert.match(node("#published").textContent ?? "", /second replacement/, "the published suggestion is retained")
button("preview-suggestion", suggestion).click()
respond(last(), { preview: { ...change, token: "fresh-token" } })
await wait()
button("apply-suggestion", suggestion).click()
assert.equal((last() as { token?: string }).token, "fresh-token")
respond(last(), {})
assert.ok(suggestion.querySelector('[role="status"]'))
assert.equal(suggestion.querySelector('[data-action="apply-suggestion"]'), null)
assert.ok(
  messages.every((message) =>
    [
      "agentManager.loadPRFiles",
      "agentManager.createReviewComment",
      "agentManager.submitPRReview",
      "agentManager.previewPRSuggestion",
      "agentManager.applyPRSuggestion",
    ].includes(message.type),
  ),
  "no arbitrary worktree diff publication",
)
release()
