import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { PRStatus, WebviewMessage } from "../../webview-ui/src/types/messages"

const refreshed: WebviewMessage[] = []
const reactions: WebviewMessage[] = []
const replies: Record<string, unknown>[] = []
const mutations: Record<string, unknown>[] = []
const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: window.location.origin })
class CSSStyleSheetStub {
  replaceSync() {}
  replace() {
    return Promise.resolve(this)
  }
}
class IntersectionObserverStub {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  unobserve(_target: Element) {}
  disconnect() {}
}

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLDivElement: window.HTMLDivElement,
  HTMLPreElement: window.HTMLPreElement,
  HTMLAnchorElement: window.HTMLAnchorElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  SVGElement: window.SVGElement,
  ShadowRoot: window.ShadowRoot,
  customElements: window.customElements,
  CSSStyleSheet: CSSStyleSheetStub,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: IntersectionObserverStub,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  acquireVsCodeApi: () => ({
    postMessage: (message: WebviewMessage) => {
      if (message.type === "agentManager.refreshPR") refreshed.push(message)
      if (message.type === "agentManager.commentReaction") reactions.push(message)
      if ((message as { type: string }).type === "agentManager.replyComment") replies.push(message)
      if ((message as { type: string }).type === "agentManager.mutateComment") mutations.push(message)
    },
    getState: () => undefined,
    setState: () => undefined,
  }),
})

const { render } = await import("solid-js/web")
const { post } = await import("../../webview-ui/src/utils/webview-message")
const { MarkedProvider } = await import("@kilocode/kilo-ui/context/marked")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { useVSCode } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { PRComments } = await import("../../webview-ui/agent-manager/pr/PRComments")
const { Diff } = await import("@kilocode/kilo-ui/diff")
const { Show, createRoot, createSignal } = await import("solid-js")
const { WorktreeItem } = await import("../../webview-ui/agent-manager/WorktreeItem")
const { createPRNavigation, PRPanelHost } = await import("../../webview-ui/agent-manager/pr/PRPanelHost")
const { createPRReview } = await import("../../webview-ui/agent-manager/pr/review")
const { commentState, createReactionController, patchCommentState } = await import(
  "../../webview-ui/agent-manager/pr/pr-comment-state"
)
const { createRemoteCommentController, createRemoteFocus } = await import(
  "../../webview-ui/diff-viewer/remote-comment-renderer"
)

const root = document.createElement("div")
const button = (scope: Element, label: string) => {
  const node = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label,
  )
  assert.ok(node, `Expected ${label} button`)
  return node
}
const click = async (scope: Element, label: string) => {
  button(scope, label).click()
  await window.happyDOM.waitUntilComplete()
}
const type = (field: HTMLTextAreaElement, body: string) => {
  field.value = body
  field.dispatchEvent(new window.Event("input", { bubbles: true }))
}
const colors = document.createElement("style")
colors.textContent = ":root { --syntax-keyword: rgb(72, 160, 199); --syntax-string: rgb(206, 145, 120); }"
document.head.append(colors)
document.body.append(root)

const HUNK =
  '@@ -1 +1,14 @@\n+import { File as BaseFile, type FileProps } from "@opencode-ai/ui/file"\n+import type { JSX } from "solid-js"\n+import { createDefaultOptions } from "../pierre"\n+\n export * from "@opencode-ai/ui/file"\n+\n+export function File<T>(props: FileProps<T>) {\n+  const View = BaseFile as unknown as (props: FileProps<T>) => JSX.Element\n+  if (props.mode === "text") return <View {...props} />\n+\n+  // Keep inline file diffs on the same Pierre defaults as the dedicated viewer.\n+  const options = { ...createDefaultOptions<T>(props.diffStyle), ...props } as FileProps<T>\n'

const sent: unknown[] = []
const [comments, setComments] = createSignal({
  total: 2,
  unresolved: 1,
  comments: [
    {
      id: "PRRC_open",
      threadId: "PRRT_open",
      author: "kilo-code-bot",
      canEdit: true,
      canDelete: true,
      body: "comment body survives Pierre rendering",
      file: "packages/kilo-ui/src/components/file.tsx",
      line: 14,
      resolved: false,
      outdated: false,
      createdAt: Date.now() - 5 * 60 * 1000,
      diffHunk: HUNK,
      // Read from the worktree by the extension: a hunk stops at the commented line.
      after: ["  return <View {...options} />", "}", ""],
      replies: [
        {
          id: "PRRC_reply",
          author: "marius",
          body: "reply body is visible",
          canEdit: true,
          canDelete: true,
          createdAt: Date.now() - 2 * 60 * 1000,
          reactions: [{ content: "ROCKET", count: 1, viewerHasReacted: false }],
        },
      ],
      reactions: [
        { content: "THUMBS_UP", count: 2, viewerHasReacted: false },
        { content: "HEART", count: 1, viewerHasReacted: true },
      ],
    },
    {
      id: "PRRC_done",
      threadId: "PRRT_done",
      author: "reviewer",
      body: "settled discussion\n\nsecond paragraph only shows when expanded",
      file: "packages/kilo-ui/src/components/other.tsx",
      line: 3,
      resolved: true,
      outdated: false,
    },
  ],
})
window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.data?.type === "appendReviewComments") sent.push(ev.data)
})

const dispose = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <MarkedProvider>
          <PRComments
            worktreeId="wt-test"
            prNumber={42}
            prUrl="https://github.com/example/repo/pull/42"
            comments={comments()}
          />
        </MarkedProvider>
      </LanguageProvider>
    </VSCodeProvider>
  ),
  root,
)

await window.happyDOM.waitUntilComplete()

// The unresolved thread renders expanded, with its hunk and its replies.
const host = root.querySelector("diffs-container")
const shadow = host?.shadowRoot
const keyword = shadow?.querySelector('[data-content] span[style*="--syntax-keyword"]')
const comment = shadow?.querySelector('[data-content] span[style*="--syntax-comment"]')
const code = shadow?.querySelectorAll("[data-content] [data-line]")
assert.match(root.textContent ?? "", /comment body survives Pierre rendering/)
assert.match(root.textContent ?? "", /reply body is visible/)
const reactionButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-comment-id="PRRC_open"] .am-pr-reaction')]
const addReaction = reactionButtons.at(0)
const removeReaction = reactionButtons.at(1)
assert.ok(addReaction, "add reaction control is rendered")
assert.ok(removeReaction, "remove reaction control is rendered")
const reactionCount = (button: HTMLButtonElement) => button.querySelector(".am-pr-reaction-count")?.textContent
const pickerTrigger = () => root.querySelector('.am-pr-reactions [data-component="icon-button"]')
assert.equal(reactionCount(addReaction!), "2")
assert.ok(pickerTrigger(), "reaction picker trigger is rendered")
addReaction!.click()
await window.happyDOM.waitUntilComplete()
assert.deepEqual(reactions[0], {
  type: "agentManager.commentReaction",
  projectId: undefined,
  worktreeId: "wt-test",
  commentId: "PRRC_open",
  reaction: "THUMBS_UP",
  add: true,
})
// The spinner runs inside the pill it belongs to; nothing is unmounted around it.
assert.ok(addReaction!.querySelector('[data-component="spinner"]'), "the pill shows its own spinner")
assert.equal(addReaction!.getAttribute("aria-busy"), "true")
assert.equal(removeReaction!.querySelector('[data-component="spinner"]'), null)
assert.equal(removeReaction!.getAttribute("aria-busy"), "false")
assert.ok(pickerTrigger(), "the picker trigger stays in place while an update runs")
const reactionResult = (reaction: string, add: boolean, success: boolean, id = "PRRC_open") => {
  post(
    {
      type: "agentManager.commentReactionResult",
      worktreeId: "wt-test",
      commentId: id,
      reaction,
      add,
      success,
      ...(success ? {} : { error: "GitHub rejected the update" }),
    },
    window,
  )
}
reactionResult("THUMBS_UP", true, false)
await window.happyDOM.waitUntilComplete()
// A failure restores the count it had and lets the user try the same pill again.
assert.equal(addReaction!.querySelector('[data-component="spinner"]'), null)
assert.equal(reactionCount(addReaction!), "2")
assert.equal(addReaction!.classList.contains("am-pr-reaction-active"), false)
assert.match(root.textContent ?? "", /Could not update reaction/)
addReaction!.click()
await window.happyDOM.waitUntilComplete()
assert.deepEqual(reactions[1], {
  type: "agentManager.commentReaction",
  projectId: undefined,
  worktreeId: "wt-test",
  commentId: "PRRC_open",
  reaction: "THUMBS_UP",
  add: true,
})
reactionResult("THUMBS_UP", true, true)
await window.happyDOM.waitUntilComplete()
// The pick holds until a poll reports it, so the count does not drop back.
assert.equal(reactionCount(addReaction!), "3")
assert.equal(addReaction!.classList.contains("am-pr-reaction-active"), true)
addReaction!.click()
await window.happyDOM.waitUntilComplete()
assert.ok(addReaction!.querySelector('[data-component="spinner"]'), "a pending removal keeps a new reaction mounted")
reactionResult("THUMBS_UP", false, false)
await window.happyDOM.waitUntilComplete()
assert.equal(reactionCount(addReaction!), "3")
assert.equal(addReaction!.classList.contains("am-pr-reaction-active"), true)
removeReaction!.click()
await window.happyDOM.waitUntilComplete()
assert.deepEqual(reactions[3], {
  type: "agentManager.commentReaction",
  projectId: undefined,
  worktreeId: "wt-test",
  commentId: "PRRC_open",
  reaction: "HEART",
  add: false,
})
// Removing the last reaction keeps the pill mounted, so its spinner is visible.
assert.ok(removeReaction!.querySelector('[data-component="spinner"]'), "the emptied pill keeps its spinner")
reactionResult("HEART", false, false)
await window.happyDOM.waitUntilComplete()
assert.equal(removeReaction!.querySelector('[data-component="spinner"]'), null)
assert.equal(reactionCount(removeReaction!), "1")
assert.equal(removeReaction!.classList.contains("am-pr-reaction-active"), true)
assert.match(root.textContent ?? "", /Could not update reaction/)
removeReaction!.click()
await window.happyDOM.waitUntilComplete()
assert.deepEqual(reactions[4], {
  type: "agentManager.commentReaction",
  projectId: undefined,
  worktreeId: "wt-test",
  commentId: "PRRC_open",
  reaction: "HEART",
  add: false,
})
const replyReaction = root.querySelector<HTMLButtonElement>('[data-comment-id="PRRC_reply"] .am-pr-reaction')
assert.ok(replyReaction, "reply reaction control is rendered")
assert.equal(reactionCount(replyReaction!), "1")
replyReaction!.click()
await window.happyDOM.waitUntilComplete()
assert.deepEqual(reactions[5], {
  type: "agentManager.commentReaction",
  projectId: undefined,
  worktreeId: "wt-test",
  commentId: "PRRC_reply",
  reaction: "ROCKET",
  add: true,
})
reactionResult("ROCKET", true, true, "PRRC_reply")
await window.happyDOM.waitUntilComplete()
assert.ok(root.querySelector(".am-pr-comment-reply .am-pr-comment-time"))
assert.equal(root.querySelector('[data-thread-id="PRRT_open"] .am-pr-comment-time')?.textContent, "5 min ago")
assert.equal(root.querySelector('[data-thread-id="PRRT_done"] .am-pr-comment-time'), null)
assert.equal(root.querySelectorAll('[data-component="diff"]').length, 1)
// Four hunk lines ending at the commented line, like the GitHub comment
// snippet, then the worktree lines below it so a comment about what happens
// next is readable. No collapsed-context row counting the lines above them.
assert.equal(code?.length, 7)
assert.deepEqual(
  [...(code ?? [])].map((node) => node.getAttribute("data-line-type")),
  ["change-addition", "change-addition", "change-addition", "change-addition", "context", "context", "context"],
)
assert.match(shadow?.textContent ?? "", /return <View \{\.\.\.options\} \/>/)
assert.doesNotMatch(shadow?.textContent ?? "", /unmodified line/)
assert.ok(keyword)
assert.ok(comment)
assert.match(keyword!.getAttribute("style") ?? "", /--syntax-keyword/)
assert.match(comment!.getAttribute("style") ?? "", /--syntax-comment/)
assert.notEqual(keyword!.getAttribute("style"), comment!.getAttribute("style"))

// The resolved thread is hidden behind a collapsed group.
assert.doesNotMatch(root.textContent ?? "", /settled discussion/)
const groups = [...root.querySelectorAll(".am-pr-panel-section-toggle")]
const resolvedGroup = groups.find((node) => /Resolved \(1\)/.test(node.textContent ?? ""))
assert.ok(resolvedGroup, "resolved group heading is present")
;(resolvedGroup as HTMLButtonElement).click()
await window.happyDOM.waitUntilComplete()

// Opening the group reveals a one-line row, not the whole card.
const rows = [...root.querySelectorAll(".am-pr-comment-head")]
const resolvedRow = rows.find((node) => /reviewer/.test(node.textContent ?? ""))
assert.ok(resolvedRow, "resolved row is present")
assert.equal(resolvedRow!.getAttribute("aria-expanded"), "false")
assert.ok(resolvedRow!.querySelector(".am-pr-comment-preview"), "collapsed row shows a preview")
const summary = resolvedRow!.querySelector(".am-pr-comment-preview")!.textContent
assert.doesNotMatch(root.textContent ?? "", /second paragraph only shows when expanded/)

// The row expands into a full card whose unresolve action is enabled.
;(resolvedRow as HTMLButtonElement).click()
await window.happyDOM.waitUntilComplete()
assert.equal(resolvedRow!.getAttribute("aria-expanded"), "true")
assert.equal(resolvedRow!.querySelector(".am-pr-comment-preview")!.textContent, summary)
assert.match(root.textContent ?? "", /second paragraph only shows when expanded/)
const card = resolvedRow!.parentElement!
assert.equal(card.querySelector(".am-pr-diff-file")!.textContent, "packages/kilo-ui/src/components/other.tsx:3")
const actions = [...card.querySelectorAll('[data-component="button"]')]
const unresolve = actions.find((node) => /Unresolve/.test(node.textContent ?? ""))
assert.ok(unresolve, "unresolve button is rendered")
assert.equal((unresolve as HTMLButtonElement).disabled, false)
assert.equal(unresolve!.getAttribute("data-disabled"), null)

// Polling replaces comment objects, but it must not reset the user's open thread.
setComments((prev) => ({ ...prev, comments: prev.comments.map((item) => ({ ...item })) }))
await window.happyDOM.waitUntilComplete()
const refreshedRow = [...root.querySelectorAll(".am-pr-comment-head")].find((node) =>
  /reviewer/.test(node.textContent ?? ""),
)
assert.equal(refreshedRow?.getAttribute("aria-expanded"), "true")
assert.match(root.textContent ?? "", /second paragraph only shows when expanded/)

// The bottom toggle controls the same thread state as the header.
const toggle = () => card.querySelector<HTMLButtonElement>('[data-action="toggle-thread"]')!
assert.ok(toggle())
assert.equal(toggle().getAttribute("aria-expanded"), "true")
assert.equal(toggle().querySelector("use")?.getAttribute("href"), "#opencode-icon-chevron-down")
assert.ok(toggle().querySelector(".am-pr-comment-collapse-icon"))
toggle().click()
await window.happyDOM.waitUntilComplete()
assert.equal(toggle().querySelector(".am-pr-comment-collapse-icon"), null)
assert.equal(refreshedRow?.getAttribute("aria-expanded"), "false")
assert.equal(toggle().getAttribute("aria-expanded"), "false")
toggle().click()
await window.happyDOM.waitUntilComplete()
assert.equal(refreshedRow?.getAttribute("aria-expanded"), "true")

// Replies keep their draft on failure and accept only the matching host result.
const composer = () => root.querySelector('[data-thread-id="PRRT_open"] .am-pr-comment-composer[data-action="reply"]')!
const input = () => composer().querySelector<HTMLTextAreaElement>("textarea")!
const submit = () => composer().querySelector<HTMLButtonElement>('button[data-action="submit"]')!
const expand = (scope: Element) => scope.querySelector<HTMLButtonElement>('[data-action="expand"]')!
assert.equal(input(), null, "reply starts as a compact placeholder")
assert.equal(expand(composer()).textContent?.trim(), "Write a reply...")
assert.equal(composer().querySelector('[data-slot="comment-toolbar"]'), null)
expand(composer()).focus()
await window.happyDOM.waitUntilComplete()
assert.ok(input(), "focusing the compact reply expands the editor")
assert.equal(document.activeElement, input())
assert.equal(button(composer(), "Reply"), submit())
assert.equal(submit().disabled, true)
type(input(), "   ")
await window.happyDOM.waitUntilComplete()
assert.equal(submit().disabled, true)
type(input(), "  Reply with **Markdown**\nand a second line  ")
await window.happyDOM.waitUntilComplete()
assert.equal(submit().disabled, false)
await click(composer(), "Cancel")
assert.equal(input(), null, "Cancel collapses the reply editor")
assert.equal(replies.length, 0, "Cancel must not publish a reply")
expand(composer()).click()
await window.happyDOM.waitUntilComplete()
assert.equal(input().value, "  Reply with **Markdown**\nand a second line  ", "Cancel preserves the multiline draft")
const enter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
input().dispatchEvent(enter)
assert.equal(enter.defaultPrevented, false, "Enter retains native multiline input behavior")
assert.equal(replies.length, 0, "Enter must not publish a reply")
for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
  input().dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true, ...modifier }),
  )
  assert.equal(replies.length, 0, "IME confirmation must not publish a reply")
}
input().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, ctrlKey: true }))
await window.happyDOM.waitUntilComplete()
assert.equal(replies.length, 1)
assert.equal(replies[0]!.body, "  Reply with **Markdown**\nand a second line  ")
assert.equal(replies[0]!.threadId, "PRRT_open")
assert.equal(replies[0]!.worktreeId, "wt-test")
assert.equal(submit().disabled, true)
assert.equal(input().disabled, true)
submit().click()
assert.equal(replies.length, 1)
input().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, metaKey: true }))
assert.equal(replies.length, 1, "keyboard submit cannot duplicate a pending request")
const respond = (value: Record<string, unknown>) =>
  post({ ...replies.at(-1), type: "agentManager.replyCommentResult", ...value })
respond({ requestId: "unrelated", success: true })
assert.equal(submit().disabled, true)
respond({ success: false, error: "Permission denied" })
await window.happyDOM.waitUntilComplete()
assert.match(composer().textContent ?? "", /Permission denied/)
assert.match(input().value, /Reply with/)
assert.equal(submit().disabled, false)
input().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, metaKey: true }))
await window.happyDOM.waitUntilComplete()
assert.equal(replies.length, 2)
// Collapse the card while the request is in flight. Its result still settles.
root.querySelector<HTMLButtonElement>('[data-thread-id="PRRT_open"] .am-pr-comment-head')!.click()
respond({ success: true })
root.querySelector<HTMLButtonElement>('[data-thread-id="PRRT_open"] .am-pr-comment-head')!.click()
await window.happyDOM.waitUntilComplete()
assert.match(composer().textContent ?? "", /Reply added/)
assert.equal(input(), null, "successful reply collapses the editor even after a card remount")
assert.ok(expand(composer()))

// Only owned comments expose management actions. Editing keeps the original text.
assert.equal(root.querySelector('[data-thread-id="PRRT_done"] [data-action="edit"]'), null)
const editor = () => root.querySelector('[data-thread-id="PRRT_open"] [data-action="edit"]')!
await click(editor(), "Edit")
const edit = () => editor().querySelector<HTMLTextAreaElement>("textarea")!
assert.equal(edit().value, "comment body survives Pierre rendering")
type(edit(), "Edited **review comment**")
await window.happyDOM.waitUntilComplete()
await click(editor(), "Cancel")
assert.equal(edit(), null)
assert.equal(mutations.length, 0)
await click(editor(), "Edit")
assert.equal(edit().value, "Edited **review comment**", "Cancel and reopen preserve the edit draft")
await click(editor(), "Save")
assert.equal(mutations.length, 1)
assert.deepEqual(mutations[0], {
  type: "agentManager.mutateComment",
  projectId: undefined,
  worktreeId: "wt-test",
  prNumber: 42,
  prUrl: "https://github.com/example/repo/pull/42",
  action: "edit",
  commentId: "PRRC_open",
  body: "Edited **review comment**",
  requestId: mutations[0]!.requestId,
})
const settle = (value: Record<string, unknown> = {}) =>
  post({
    ...mutations.at(-1),
    type: "agentManager.mutateCommentResult",
    success: true,
    ...value,
  })
settle({ success: false, error: "Not allowed" })
await window.happyDOM.waitUntilComplete()
assert.equal(edit().value, "Edited **review comment**")
assert.match(editor().textContent ?? "", /Not allowed/)
await click(editor(), "Save")
// A poll/remount during submission must not lose the pending edit.
setComments((prev) => ({ ...prev, comments: prev.comments.map((item) => ({ ...item })) }))
settle()
await window.happyDOM.waitUntilComplete()
assert.match(editor().textContent ?? "", /Comment updated/)
assert.equal(edit(), null)

// Delete acts once immediately, keeps the comment on failure, and can be retried.
const manage = () => root.querySelector('.am-pr-comment-reply [data-action="edit"]')!
await click(manage(), "Edit")
const focused = manage().querySelector<HTMLTextAreaElement>("textarea")!
focused.focus()
focused.setSelectionRange(3, 7)
setComments((prev) => ({
  ...prev,
  comments: prev.comments.map((item) => ({ ...item, replies: item.replies?.map((reply) => ({ ...reply })) })),
}))
await window.happyDOM.waitUntilComplete()
assert.equal(manage().querySelector("textarea"), focused, "a poll must retain the reply editor DOM")
assert.equal(document.activeElement, focused)
assert.equal(focused.selectionStart, 3)
assert.equal(focused.selectionEnd, 7)
await click(manage(), "Cancel")
await click(manage(), "Delete")
assert.equal(mutations.length, 3)
assert.equal(mutations.at(-1)?.action, "delete")
assert.equal(mutations.at(-1)?.commentId, "PRRC_reply")
assert.equal(mutations.at(-1)?.body, undefined)
assert.doesNotMatch(manage().textContent ?? "", /This cannot be undone/)
assert.equal(button(manage(), "Delete").disabled, true)
assert.equal(button(manage(), "Edit").disabled, true)
button(manage(), "Delete").click()
assert.equal(mutations.length, 3, "pending delete cannot be submitted twice")
settle({ success: false, error: "Permission denied" })
await window.happyDOM.waitUntilComplete()
assert.match(manage().querySelector('[role="alert"]')?.textContent ?? "", /Permission denied/)
assert.match(manage().textContent ?? "", /reply body is visible/)
await click(manage(), "Delete")
assert.equal(mutations.at(-1)?.action, "delete")
assert.equal(mutations.at(-1)?.commentId, "PRRC_reply")
assert.equal(mutations.at(-1)?.body, undefined)
settle()
await window.happyDOM.waitUntilComplete()
assert.match(manage().textContent ?? "", /Comment deleted/)

// Suggestion insertion wraps the selection without losing the surrounding prose.
const replacement = 'const value = `template`\n```\nconst fence = "````"'
const prose = `Before **suggestion**\n${replacement}\nAfter suggestion`
expand(composer()).click()
await window.happyDOM.waitUntilComplete()
assert.equal(input().value, "", "successful reply clears the previous draft")
type(input(), prose)
assert.equal(composer().querySelector('[role="status"]'), null, "new draft clears the previous reply status")
input().focus()
input().setSelectionRange(prose.indexOf(replacement), prose.indexOf(replacement) + replacement.length)
const insertion = button(composer(), "Insert suggestion")
assert.equal(insertion.getAttribute("data-action"), "suggestion")
assert.equal(insertion.getAttribute("aria-label"), "Insert suggestion")
assert.ok(insertion.querySelector('[data-component="icon"]'), "suggestion insertion is an accessible icon control")
insertion.click()
await window.happyDOM.waitUntilComplete()
const suggested = input().value
assert.match(suggested, /^Before \*\*suggestion\*\*\n/)
assert.match(suggested, /\nAfter suggestion$/)
assert.ok(suggested.includes(replacement), "selected backticks remain literal code")
assert.match(suggested, /`{5,}suggestion\n/, "fence is longer than backticks inside the selection")
assert.equal(document.activeElement, input(), "insertion returns focus to the editor")
assert.equal(input().value.slice(input().selectionStart, input().selectionEnd), replacement)
await click(composer(), "Preview")
const preview = composer().querySelector('[data-slot="comment-preview"]')!
assert.ok(preview)
assert.match(preview.textContent ?? "", /Suggested change/)
assert.equal(preview.querySelector("strong")?.textContent, "suggestion")
const suggestion = preview.querySelector('[data-slot="suggested-change"]')!
assert.ok(suggestion)
assert.ok(suggestion.textContent?.includes(replacement), "preview retains code containing Markdown fences")
assert.doesNotMatch(preview.textContent ?? "", /Apply suggestion|Commit suggestion/)
const rendered = suggestion.textContent
await click(composer(), "Write")
assert.equal(input().value, suggested, "preview must not rewrite the Markdown draft")
assert.equal(input().value.slice(input().selectionStart, input().selectionEnd), replacement)
submit().click()
assert.equal(replies.at(-1)?.body, suggested, "suggestion reply is posted verbatim")
respond({ success: true })
setComments((prev) => ({
  ...prev,
  comments: prev.comments.map((item) => (item.threadId === "PRRT_open" ? { ...item, body: suggested } : item)),
}))
await window.happyDOM.waitUntilComplete()
assert.equal(editor().querySelector('[data-slot="suggested-change"]')?.textContent, rendered)
await click(editor(), "Edit")
assert.equal(edit().value, suggested)
assert.equal(editor().querySelector('[data-slot="suggested-change"]'), null, "edit replaces the published body")
button(editor(), "Save").click()
assert.equal(mutations.at(-1)?.body, suggested, "suggestion edits are saved verbatim")
settle()
await window.happyDOM.waitUntilComplete()

// A suggestion example inside an outer code fence is ordinary Markdown, not a suggested change.
assert.equal(input(), null)
expand(composer()).click()
await window.happyDOM.waitUntilComplete()
type(input(), "````markdown\n```suggestion\nexample only\n```\n````")
await click(composer(), "Preview")
assert.equal(composer().querySelector('[data-slot="suggested-change"]'), null)
assert.match(composer().querySelector('[data-slot="comment-preview"]')?.textContent ?? "", /example only/)
await click(composer(), "Write")

// Suggestion rendering retains reference links defined elsewhere in the comment.
type(input(), "[linked][reference]\n\n```suggestion\nnew code\n```\n\n[reference]: https://example.com")
await click(composer(), "Preview")
assert.equal(composer().querySelector('[data-slot="comment-preview"] a')?.getAttribute("href"), "https://example.com")
await click(composer(), "Write")
// A collapsed selection inserts at the caret rather than replacing the whole draft.
type(input(), "prefix suffix")
input().setSelectionRange(7, 7)
await click(composer(), "Insert suggestion")
assert.match(input().value, /^prefix /)
assert.match(input().value, /suffix$/)
assert.match(input().value, /```suggestion\n/)
const retained = input().value

// Send to agent hands the thread over as a structured review comment.
const send = [...root.querySelectorAll('[data-component="button"]')].find((node) =>
  /Fix with Kilo/.test(node.textContent ?? ""),
)
assert.ok(send, "send button is rendered")
;(send as HTMLButtonElement).click()
await window.happyDOM.waitUntilComplete()
assert.equal(sent.length, 1)
const payload = sent[0] as { comments: { id: string; origin: string; author: string; replies?: unknown[] }[] }
assert.equal(payload.comments.length, 1)
assert.equal(payload.comments[0]!.origin, "pr")
assert.equal(payload.comments[0]!.id, "PRRT_open")
assert.equal(payload.comments[0]!.replies?.length, 1)

// Sending the same thread again is a no-op, and the card button is disabled.
;(send as HTMLButtonElement).click()
await window.happyDOM.waitUntilComplete()
assert.equal(sent.length, 1)
assert.equal((send as HTMLButtonElement).disabled, true)

// A poll that resolves the other thread regroups the list. Cards are keyed by
// thread, so the expanded card must not hand its state to its new neighbour.
root.querySelector<HTMLButtonElement>('[data-thread-id="PRRT_open"] .am-pr-comment-head')!.click()
setComments((prev) => ({
  ...prev,
  unresolved: 0,
  comments: prev.comments.map((item) => (item.threadId === "PRRT_open" ? { ...item, resolved: true } : item)),
}))
await window.happyDOM.waitUntilComplete()
const byThread = new Map(
  [...root.querySelectorAll(".am-pr-comment[data-thread-id]")].map((node) => [
    node.getAttribute("data-thread-id"),
    node,
  ]),
)
assert.equal(byThread.size, 2)
assert.equal(byThread.get("PRRT_done")?.querySelector(".am-pr-comment-head")?.getAttribute("aria-expanded"), "true")
assert.equal(byThread.get("PRRT_open")?.querySelector(".am-pr-comment-head")?.getAttribute("aria-expanded"), "false")
assert.match(root.textContent ?? "", /second paragraph only shows when expanded/)
byThread.get("PRRT_open")!.querySelector<HTMLButtonElement>(".am-pr-comment-head")!.click()
await window.happyDOM.waitUntilComplete()

// A remount must not lobotomize the panel. The extension can briefly report no
// PR, which tears these components down and builds them again. What the user
// opened, and what was already sent, are held per worktree outside the
// component, so both survive.
dispose()
const second = document.createElement("div")
document.body.append(second)
const threads = [1, 2].map((line) => ({
  id: `inline-${line}`,
  threadId: `inline-${line}`,
  author: "reviewer",
  body: "Review this inline thread",
  file: "inline.ts",
  line,
  side: "additions" as const,
  resolved: false,
  outdated: false,
  ...(line === 1 ? { reactions: [{ content: "ROCKET" as const, count: 1, viewerHasReacted: false }] } : {}),
}))
const [diffs, setDiffs] = createSignal([
  { file: "inline.ts", before: "", after: "", additions: 2, deletions: 0, summarized: true },
])
const ready = Promise.withResolvers<ReturnType<typeof createRemoteCommentController>>()
const Probe = () => {
  const vscode = useVSCode()
  const reactions = createReactionController({
    worktree: () => "wt-test",
    project: () => undefined,
    post: vscode.postMessage,
    onMessage: vscode.onMessage,
    fail: (error) => `Could not update reaction. ${error ?? ""}`,
  })
  const remote = createRemoteCommentController({
    key: () => "inline",
    comments: () => threads,
    diffs,
    active: () => true,
    activeTerminalId: () => undefined,
    reactions,
  })
  const annotations = remote.annotations("stable.ts")
  ready.resolve(remote)
  return (
    <Diff
      before={{ name: "stable.ts", contents: "const value = false" }}
      after={{ name: "stable.ts", contents: "const value = true" }}
      diffStyle="unified"
      virtualized={false}
      visible
      annotations={annotations()}
      renderAnnotation={remote.render}
    />
  )
}
const disposeSecond = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <MarkedProvider>
          <PRComments
            worktreeId="wt-test"
            prNumber={42}
            prUrl="https://github.com/example/repo/pull/42"
            comments={comments()}
          />
          <Probe />
        </MarkedProvider>
      </LanguageProvider>
    </VSCodeProvider>
  ),
  second,
)
await window.happyDOM.waitUntilComplete()
const revived = new Map(
  [...second.querySelectorAll(".am-pr-comment[data-thread-id]")].map((node) => [
    node.getAttribute("data-thread-id"),
    node,
  ]),
)
// The resolved group is still open, so both threads are reachable.
assert.equal(revived.size, 2)
assert.equal(revived.get("PRRT_done")?.querySelector(".am-pr-comment-head")?.getAttribute("aria-expanded"), "true")
assert.match(second.textContent ?? "", /second paragraph only shows when expanded/)
assert.match(second.textContent ?? "", /Sent/)

const remote = await ready.promise
const stable = second.querySelector("diffs-container")!.shadowRoot!
const line = stable.querySelector("[data-line]")
assert.ok(line)
assert.deepEqual(remote.outside(), [])
assert.equal(remote.location("inline.ts", "inline-1"), "pending")
assert.equal(remote.fileCount("inline.ts"), 2)
setDiffs([{ file: "inline.ts", before: "", after: "one\ntwo", additions: 2, deletions: 0, summarized: false }])
assert.equal(remote.location("inline.ts", "inline-1"), "inline")
assert.equal(remote.fileCount("inline.ts"), 2)
await window.happyDOM.waitUntilComplete()
assert.equal(stable.querySelector("[data-line]"), line)
const panel = document.createElement("div")
panel.className = "am-diff-panel"
second.append(panel)
const Native = globalThis.MutationObserver
const observers = new Set<MutationObserver>()
const checks = new Map<MutationObserver, () => void>()
globalThis.MutationObserver = class extends Native {
  constructor(callback: MutationCallback) {
    super(callback)
    checks.set(this, () => callback([], this))
  }

  observe(target: Node, options: MutationObserverInit) {
    if (target === panel) observers.add(this)
    super.observe(target, options)
  }
}
const mounts = createRoot((dispose) => {
  const values = remote.annotations("inline.ts")()
  dispose()
  return values
}).map((annotation) => {
  assert.ok(annotation.metadata)
  const host = remote.render(annotation.metadata)
  assert.ok(host)
  const wrapper = document.createElement("div")
  wrapper.append(host)
  panel.append(wrapper)
  return { host, wrapper, meta: annotation.metadata }
})
await window.happyDOM.waitUntilComplete()
assert.equal(observers.size, 1)
const check = checks.get([...observers].at(0)!)!
const first = mounts.at(0)!
const last = mounts.at(1)!
const inlineReaction = first.host.querySelector<HTMLButtonElement>(".am-pr-reaction")
assert.ok(inlineReaction, "inline reaction control is rendered")
inlineReaction!.click()
await window.happyDOM.waitUntilComplete()
assert.deepEqual(reactions.at(6), {
  type: "agentManager.commentReaction",
  projectId: undefined,
  worktreeId: "wt-test",
  commentId: "inline-1",
  reaction: "ROCKET",
  add: true,
})
assert.ok(first.host.querySelector('[data-component="spinner"]'), "inline reaction update shows a spinner")
for (const revealed of [false, true]) {
  let prepared = 0
  const dispose = createRoot((cleanup) => {
    createRemoteFocus(() => root).request(
      "inline-1",
      "inline.ts",
      () => prepared++,
      () => "inline",
      () => revealed,
    )
    return cleanup
  })
  await window.happyDOM.waitUntilComplete()
  assert.equal(prepared, revealed ? 1 : 2)
  dispose()
}
const Resize = globalThis.ResizeObserver
let resized: () => void = () => undefined
globalThis.ResizeObserver = class extends Resize {
  constructor(callback: ResizeObserverCallback) {
    super(callback)
    resized = () => callback([], this)
  }
}
const subject = first.host.querySelector<HTMLElement>("[data-thread-id]")!
const retry = createRoot((dispose) => {
  createRemoteFocus(() => second, undefined, { root: () => second, to: () => undefined }).request(
    "inline-1",
    "inline.ts",
    () => undefined,
    () => "inline",
  )
  return dispose
})
await window.happyDOM.waitUntilComplete()
assert.notEqual(document.activeElement, subject.querySelector("button"))
subject.getBoundingClientRect = () => new window.DOMRect(0, 0, 100, 100)
resized()
await window.happyDOM.waitUntilComplete()
assert.equal(document.activeElement, subject.querySelector("button"))
retry()
globalThis.ResizeObserver = Resize
const header = last.host.querySelector<HTMLButtonElement>(".am-pr-comment-head")!
header.click()
first.wrapper.remove()
check()
await window.happyDOM.waitUntilComplete()
const remounted = remote.render(first.meta)
assert.notEqual(remounted, first.host)
check()
assert.equal(remote.render(first.meta), remounted)
assert.equal(remote.render(last.meta), last.host)
assert.equal(header.getAttribute("aria-expanded"), "false")
last.wrapper.remove()
check()
await window.happyDOM.waitUntilComplete()
assert.notEqual(remote.render(last.meta), last.host)
remote.cleanup()
globalThis.MutationObserver = Native
assert.equal(
  second.querySelector<HTMLTextAreaElement>('[data-thread-id="PRRT_open"] [data-action="reply"] textarea')?.value,
  retained,
  "an unsent suggestion draft survives a complete panel remount",
)
disposeSecond()

const base: PRStatus = {
  number: 42,
  title: "Review navigation",
  url: "https://github.com/example/repo/pull/42",
  state: "open",
  review: null,
  checks: { status: "success", total: 0, passed: 0, failed: 0, pending: 0, checks: [] },
  reviewers: [],
  additions: 1,
  deletions: 0,
  files: 1,
}
const [badge, setBadge] = createSignal(base)
const [project, setProject] = createSignal<string | undefined>("project-a")
const [selection, setSelection] = createSignal<string | null>("local")
const [visible, setVisible] = createSignal(false)
const clicked: string[] = []
const target = { projectId: "project-b", worktreeId: "wt-navigation" }
const noop = () => undefined
const navigation = createRoot((dispose) => ({
  ...createPRNavigation({
    project,
    active: project,
    selection,
    select: () => clicked.push("select"),
    visible,
    open: () => setVisible(true),
    refresh: () => clicked.push("refresh"),
  }),
  review: createPRReview({
    context: () => selection() ?? undefined,
    project,
    current: noop,
    sessions: () => [],
    managed: () => [],
    statuses: () => ({ [target.worktreeId]: badge() }),
    select: noop,
    show: noop,
  }),
  dispose,
}))
let jumps = 0
window.HTMLElement.prototype.scrollBy = () => {
  jumps++
}
patchCommentState(target.worktreeId, () => ({ open: false }))
const release = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <MarkedProvider>
          <WorktreeItem
            worktree={{
              id: target.worktreeId,
              branch: "feature",
              path: "/repo/feature",
              parentBranch: "main",
              createdAt: "2026-09-03",
            }}
            label="Feature"
            active={false}
            pendingDelete={false}
            busy={false}
            activity="idle"
            stale={false}
            sessions={1}
            grouped={false}
            groupStart={false}
            groupEnd={false}
            groupSize={0}
            renaming={false}
            renameValue=""
            closeKeybind=""
            openKeybind=""
            pr={badge()}
            onOpenComments={() => navigation.open(target)}
            onOpenPR={() => clicked.push("external")}
            onClick={() => clicked.push("row")}
            onDelete={noop}
            onStartRename={noop}
            onRenameInput={noop}
            onCommitRename={noop}
            onCancelRename={noop}
            onRemoveStale={noop}
            onCopyPath={noop}
            onOpen={noop}
          />
          <Show when={visible()}>
            <PRPanelHost
              pr={badge()}
              projectId={project()}
              worktreeId={target.worktreeId}
              jump={navigation.jump()}
              onJump={navigation.complete}
              onClose={() => setVisible(false)}
            />
          </Show>
        </MarkedProvider>
      </LanguageProvider>
    </VSCodeProvider>
  ),
  second,
)
const indicator = () => second.querySelector<HTMLButtonElement>(".am-pr-badge-comments")
assert.equal(indicator(), null)
setBadge({ ...base, unresolvedThreads: 1 })
assert.equal(indicator()?.getAttribute("aria-label"), "1 unresolved review thread")
indicator()!.click()
setProject(target.projectId)
assert.equal(visible(), false)
setSelection(target.worktreeId)
await window.happyDOM.waitUntilComplete()
assert.equal(visible(), true)
assert.deepEqual(clicked, ["select", "refresh"])
assert.equal(jumps, 0)
const snippet = {
  patch:
    '@@ -396,0 +414,7 @@\n+                      size="small"\n+                      class="session-goal-trigger"\n+                      disabled={props.readonly}\n+                      aria-label={language.t("session.goal.label")}\n+                    >\n+                      <Icon name="chevron-down" size="small" />\n+                      <span>',
  line: 417,
  side: "additions" as const,
  base: "785b0bcdf7ac765dd29016cc7e8f25f66dc473c1",
  head: "a6f67ce22c9e220ad8f30bf880b623ef9a77c623",
  top: true,
  bottom: true,
}
// A PR with no conversation yet still offers a new-comment composer.
const create = () => second.querySelector('[data-action="create"]')!
assert.ok(create())
assert.equal(create().querySelector("textarea"), null, "new PR comments start compact")
assert.equal(expand(create()).textContent?.trim(), "Write a comment...")
expand(create()).click()
await window.happyDOM.waitUntilComplete()
assert.equal(document.activeElement, create().querySelector("textarea"))
assert.equal(create().querySelector('[data-action="suggestion"]'), null)
const initial = create().querySelector<HTMLTextAreaElement>("textarea")!
type(initial, "A new PR comment")
await click(create(), "Cancel")
assert.equal(create().querySelector("textarea"), null)
const pending = mutations.length
expand(create()).focus()
await window.happyDOM.waitUntilComplete()
const draft = create().querySelector<HTMLTextAreaElement>("textarea")!
assert.equal(draft.value, "A new PR comment", "Cancel preserves the new comment draft")
assert.equal(mutations.length, pending, "Cancel and expansion do not publish a comment")
await click(create(), "Comment")
assert.equal(mutations.at(-1)?.action, "create")
assert.equal(mutations.at(-1)?.projectId, target.projectId)
assert.equal(mutations.at(-1)?.prNumber, base.number)
assert.equal(mutations.at(-1)?.prUrl, base.url)
settle()
await window.happyDOM.waitUntilComplete()
assert.match(create().textContent ?? "", /Comment added/)
assert.equal(create().querySelector("textarea"), null, "successful new comment collapses the editor")
expand(create()).click()
await window.happyDOM.waitUntilComplete()
assert.equal(create().querySelector<HTMLTextAreaElement>("textarea")!.value, "")
await click(create(), "Cancel")
setBadge({
  ...base,
  unresolvedThreads: 1,
  comments: {
    total: 1,
    unresolved: 1,
    comments: [
      {
        id: "feedback",
        threadId: "feedback",
        author: "reviewer",
        body: "Fix this",
        file: "packages/kilo-vscode/webview-ui/src/components/chat/ChatView.tsx",
        line: 417,
        side: "additions",
        resolved: false,
        outdated: false,
        diffHunk: snippet.patch,
        after: ["DIRTY WORKTREE CONTENT"],
        preview: snippet,
      },
    ],
  },
  conversation: [
    {
      id: "convo1",
      author: "lead-reviewer",
      body: "Consider simplifying the signature serializer",
      state: "approved",
      createdAt: Date.now() - 60_000,
    },
    {
      id: "convo2",
      author: "kilo-code-bot",
      body: "Bot review summary",
      isBot: true,
      createdAt: Date.now() - 120_000,
    },
    {
      id: "own-issue",
      kind: "issue",
      author: "me",
      body: "My PR comment",
      canEdit: true,
      canDelete: true,
    },
  ],
})
await window.happyDOM.waitUntilComplete()
assert.equal(commentState(target.worktreeId).open, true)
assert.equal(jumps, 1)

// Conversation comments render at the bottom of the PR panel
assert.match(second.textContent ?? "", /PR Comments/)
assert.match(second.textContent ?? "", /lead-reviewer/)
assert.match(second.textContent ?? "", /Consider simplifying the signature serializer/)
assert.match(second.textContent ?? "", /Approved/)
assert.match(second.textContent ?? "", /kilo-code-bot/)
assert.match(second.textContent ?? "", /bot/)
assert.equal(second.querySelector('[data-thread-id="convo1"] [data-action="edit"]'), null)
const own = second.querySelector('[data-thread-id="own-issue"] [data-action="edit"]')!
assert.ok(own)
await click(own, "Edit")
assert.equal(own.querySelector<HTMLTextAreaElement>("textarea")!.value, "My PR comment")
assert.equal(own.querySelector('[data-action="suggestion"]'), null, "general conversation has no suggestion toolbar")
const field = own.querySelector<HTMLTextAreaElement>("textarea")!
field.focus()
field.setSelectionRange(2, 5)
setBadge((prev) => ({ ...prev, conversation: prev.conversation?.map((comment) => ({ ...comment })) }))
await window.happyDOM.waitUntilComplete()
assert.equal(second.querySelector('[data-thread-id="own-issue"] textarea'), field)
assert.equal(document.activeElement, field)
assert.equal(field.selectionStart, 2)
assert.equal(field.selectionEnd, 5)
await click(own, "Save")
assert.equal(mutations.at(-1)?.commentId, "own-issue")
assert.equal(mutations.at(-1)?.action, "edit")
settle()
await window.happyDOM.waitUntilComplete()

// Send conversation comment to agent
const convoCard = second.querySelector('[data-thread-id="convo1"]')
assert.ok(convoCard)
const sendBtn = convoCard!.querySelector<HTMLButtonElement>('.am-pr-comment-actions [data-variant="primary"]')
assert.ok(sendBtn)
sendBtn!.click()
await window.happyDOM.waitUntilComplete()
assert.equal(commentState(target.worktreeId).sent["convo1"], true)
const lastSent = sent.at(-1) as { comments?: Array<{ id: string; author: string; body: string; reviewState?: string }> }
assert.equal(lastSent?.comments?.[0]?.id, "convo1")
assert.equal(lastSent?.comments?.[0]?.author, "lead-reviewer")
assert.equal(lastSent?.comments?.[0]?.reviewState, "approved")
assert.match(lastSent?.comments?.[0]?.body ?? "", /simplifying the signature serializer/)

// Dismissing a conversation comment marks it dismissed
const convo2Card = second.querySelector('[data-thread-id="convo2"]')
assert.ok(convo2Card)
// convo2 is a bot, so collapsed by default; click header to open
convo2Card!.querySelector<HTMLButtonElement>(".am-pr-comment-head")!.click()
await window.happyDOM.waitUntilComplete()
const dismissBtn = Array.from(convo2Card!.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
  b.textContent?.includes("Dismiss"),
)
assert.ok(dismissBtn)
dismissBtn!.click()
await window.happyDOM.waitUntilComplete()
assert.equal(commentState(target.worktreeId).dismissed["convo2"], true)

indicator()!.click()
await window.happyDOM.waitUntilComplete()
assert.equal(jumps, 2)
const inspector = second.querySelector(".am-pr-panel")
const refresh = second.querySelector<HTMLButtonElement>('.am-pr-panel-actions [aria-label="Refresh"]')
assert.ok(refresh, "refresh button is rendered in the PR header")
refresh.click()
await window.happyDOM.waitUntilComplete()
assert.deepEqual(refreshed, [{ type: "agentManager.refreshPR", ...target }])
assert.equal(visible(), true)
assert.equal(second.querySelector(".am-pr-panel"), inspector)
setBadge((prev) => ({ ...prev, title: "Updated" }))
await window.happyDOM.waitUntilComplete()
assert.equal(second.querySelector(".am-pr-panel-title")?.textContent, "Updated")
assert.equal(jumps, 2)
second.querySelector<HTMLElement>(".am-pr-badge-number")!.click()
assert.equal(clicked.at(-1), "external")
assert.ok(!clicked.includes("row"))
setBadge((prev) => ({ ...prev, unresolvedThreads: 0 }))
assert.equal(indicator(), null)
const inline = () => second.querySelector<HTMLElement>('[data-thread-id="feedback"]')!
const placed = (name: string) => {
  const body = inline().querySelector(".am-pr-comment-body")!
  const wrapper = body.closest<HTMLElement>("[slot]")
  const host = body.closest("diffs-container")
  assert.ok(wrapper && host)
  assert.equal(wrapper.parentElement, host)
  assert.equal(wrapper.getAttribute("slot"), name)
  assert.ok(host.shadowRoot!.querySelector(`slot[name="${name}"]`))
}
const heading = inline().querySelector<HTMLButtonElement>(".am-pr-comment-head")!
assert.equal(heading.closest("diffs-container"), null)
const container = inline().querySelector("diffs-container")!
assert.ok(container)
placed("annotation-additions-417")
assert.match(container.shadowRoot!.textContent ?? "", /chevron-down/)
assert.doesNotMatch(container.shadowRoot!.textContent ?? "", /DIRTY WORKTREE CONTENT/)
setBadge((prev) => ({
  ...prev,
  comments: {
    ...prev.comments!,
    comments: prev.comments!.comments.map((comment) => ({ ...comment, body: "Updated committed thread" })),
  },
}))
await window.happyDOM.waitUntilComplete()
assert.equal(inline().querySelector("diffs-container"), container)
assert.equal(inline().querySelector(".am-pr-comment-head"), heading)
assert.match(inline().textContent ?? "", /Updated committed thread/)
const count = sent.length
inline().querySelector<HTMLButtonElement>('.am-pr-comment-actions [data-variant="primary"]')!.click()
await window.happyDOM.waitUntilComplete()
assert.equal(sent.length, count + 1)
inline().querySelector<HTMLButtonElement>(".am-pr-comment-head")!.click()
await window.happyDOM.waitUntilComplete()
assert.equal(inline().querySelector("diffs-container"), null)
assert.equal(inline().querySelector(".am-pr-comment-head"), heading)
assert.equal(inline().querySelector(".am-pr-comment-head")!.getAttribute("aria-expanded"), "false")
inline().querySelector<HTMLButtonElement>(".am-pr-comment-head")!.click()
await window.happyDOM.waitUntilComplete()
placed("annotation-additions-417")
assert.equal(inline().querySelector(".am-pr-comment-head"), heading)
setBadge((prev) => ({
  ...prev,
  comments: {
    ...prev.comments!,
    comments: prev.comments!.comments.map((comment) => ({
      ...comment,
      file: "removed.ts",
      line: 42,
      side: "deletions",
      preview: { ...snippet, patch: "@@ -41,3 +41,2 @@\n before\n-removed\n after", line: 42, side: "deletions" },
    })),
  },
}))
await window.happyDOM.waitUntilComplete()
placed("annotation-deletions-42")
setBadge((prev) => ({
  ...prev,
  comments: {
    ...prev.comments!,
    comments: prev.comments!.comments.map((comment) => ({ ...comment, preview: undefined, previewUnavailable: true })),
  },
}))
await window.happyDOM.waitUntilComplete()
assert.ok(inline())
assert.match(inline().textContent ?? "", /Updated committed thread/)
assert.doesNotMatch(inline().textContent ?? "", /Request failed/)
patchCommentState(target.worktreeId, (prev) => ({ errors: { ...prev.errors, feedback: "Request failed" } }))
await window.happyDOM.waitUntilComplete()
assert.match(inline().textContent ?? "", /Request failed/)
setProject(undefined)
refresh.click()
await window.happyDOM.waitUntilComplete()
assert.deepEqual(refreshed, [
  { type: "agentManager.refreshPR", ...target },
  { type: "agentManager.refreshPR", projectId: undefined, worktreeId: target.worktreeId },
])
assert.equal(visible(), true)
release()
const saved = { ...threads.at(0)!, file: "old.ts" }
const scope = `${target.worktreeId}#branch`
for (const file of ["old.ts", "renamed.ts"]) {
  setBadge(base)
  assert.equal(navigation.review.open(saved), true)
  const initial = navigation.review.focus(scope)
  const live = { ...saved, file }
  const status = { ...base, comments: { total: 1, unresolved: 1, comments: [live] } }
  setBadge(status)
  const focused = navigation.review.focus(scope)
  assert.deepEqual(focused, { id: saved.threadId, file })
  assert.notEqual(focused, initial)
  setBadge({ ...status, comments: { ...status.comments, comments: [{ ...live, body: "Updated" }] } })
  assert.equal(navigation.review.focus(scope), focused)
}
navigation.dispose()

const { PRChecks } = await import("../../webview-ui/agent-manager/pr/PRChecks")
const { PRSummary } = await import("../../webview-ui/agent-manager/pr/PRSummary")
const { summarize } = await import("../../src/agent-manager/pr/am-pr-utils")
const third = document.createElement("div")
document.body.append(third)
const [prState, setPrState] = createSignal<PRStatus>({
  ...base,
  checks: summarize([
    { name: "Typecheck", status: "failure", url: "https://github.com/example/repo/actions/runs/100/job/200" },
    { name: "Tests", status: "success" },
    { name: "Lint", status: "pending" },
  ]),
})
const cleanup = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <PRChecks pr={prState()} worktreeId={target.worktreeId} />
      </LanguageProvider>
    </VSCodeProvider>
  ),
  third,
)
await window.happyDOM.waitUntilComplete()
const fix = () => third.querySelector<HTMLButtonElement>(".am-pr-checks-fix")
const failureGroup = () => third.querySelector<HTMLElement>('.am-pr-check-group[data-bucket="failure"]')
const successGroup = () => third.querySelector<HTMLElement>('.am-pr-check-group[data-bucket="success"]')
const pendingCheck = third.querySelector('.am-pr-panel-check-item[data-status="pending"]')
assert.ok(pendingCheck?.querySelector('[data-component="spinner"]'), "pending checks show a spinner")
assert.equal(pendingCheck?.querySelector('[data-component="icon"]'), null)
assert.ok(failureGroup()?.querySelector(".am-pr-check-group-items"))
assert.equal(successGroup()?.querySelector(".am-pr-check-group-items"), null)
successGroup()?.querySelector<HTMLButtonElement>(".am-pr-check-group-heading")?.click()
await window.happyDOM.waitUntilComplete()
assert.ok(successGroup()?.querySelector(".am-pr-check-group-items"))
cleanup()
const remount = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <PRChecks pr={prState()} worktreeId={target.worktreeId} />
      </LanguageProvider>
    </VSCodeProvider>
  ),
  third,
)
await window.happyDOM.waitUntilComplete()
assert.ok(successGroup()?.querySelector(".am-pr-check-group-items"))
assert.equal(fix()?.textContent?.trim(), "Fix with Kilo")
assert.equal(fix()?.querySelector('[data-component="icon"]'), null)
const before = sent.length
fix()!.click()
const feedback = sent.at(-1) as {
  autoSend: boolean
  comments: import("../../src/shared/review-comments").CIReviewCommentData[]
}
assert.equal(sent.length, before + 1)
assert.equal(feedback.autoSend, true)
assert.equal(feedback.comments[0]?.origin, "ci")
// Draft removal and session changes are outside PRChecks. Unchanged checks
// must remain sendable without remounting or waiting for another CI run.
assert.equal(fix()?.disabled, false)
assert.equal(fix()?.textContent?.trim(), "Fix with Kilo")
fix()!.click()
assert.equal(sent.length, before + 2)
assert.deepEqual(sent.at(-1), feedback)
fix()!.click()
assert.equal(sent.length, before + 3)
assert.deepEqual(sent.at(-1), feedback)
setPrState((prev) => ({
  ...prev,
  checks: summarize([
    { name: "Typecheck", status: "failure", url: "https://github.com/example/repo/actions/runs/100/job/201" },
  ]),
}))
assert.equal(fix()?.disabled, false)
setPrState((prev) => ({ ...prev, checks: summarize([{ name: "Tests", status: "success" }]) }))
assert.equal(fix(), null)
remount()

// PR summary: Fix with Kilo and jump-to-section per row, without scrolling.
const terminalSent: unknown[] = []
window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.data?.type === "appendReviewCommentsToTerminal") terminalSent.push(ev.data)
})
const fourth = document.createElement("div")
document.body.append(fourth)
const jumped: string[] = []
const [terminal, setTerminal] = createSignal<string | undefined>(undefined)
const [summaryPR, setSummaryPR] = createSignal<PRStatus>({
  ...base,
  review: "changes_requested",
  checks: summarize([
    { name: "Typecheck", status: "failure", url: "https://github.com/example/repo/actions/runs/100/job/200" },
    { name: "Tests", status: "success" },
  ]),
  comments: {
    total: 3,
    unresolved: 2,
    comments: [
      {
        id: "c1",
        threadId: "T_one",
        author: "a",
        body: "one",
        file: "a.ts",
        line: 1,
        resolved: false,
        outdated: false,
      },
      {
        id: "c2",
        threadId: "T_two",
        author: "b",
        body: "two",
        file: "b.ts",
        line: 2,
        resolved: false,
        outdated: false,
      },
      {
        id: "c3",
        threadId: "T_done",
        author: "c",
        body: "done",
        file: "c.ts",
        line: 3,
        resolved: true,
        outdated: false,
      },
    ],
  },
  conversation: [
    { id: "IC_human", author: "marius", body: "please also update docs", createdAt: Date.now(), isBot: false },
    { id: "IC_bot", author: "kilo-bot", body: "automated", createdAt: Date.now(), isBot: true },
    { id: "IC_dismissed", author: "reviewer", body: "nit", createdAt: Date.now(), isBot: false },
  ],
})
const summaryWorktree = "wt-summary"
patchCommentState(summaryWorktree, (prev) => ({ dismissed: { ...prev.dismissed, IC_dismissed: true } }))
const disposeSummary = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <PRSummary
          pr={summaryPR()}
          worktreeId={summaryWorktree}
          activeTerminalId={terminal()}
          onJump={(id) => jumped.push(id)}
        />
      </LanguageProvider>
    </VSCodeProvider>
  ),
  fourth,
)
await window.happyDOM.waitUntilComplete()
const fifth = document.createElement("div")
document.body.append(fifth)
render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <PRSummary
          pr={{
            ...base,
            review: "pending",
            checks: summarize([{ name: "Lint", status: "pending" }]),
          }}
          worktreeId="wt-pending-summary"
        />
      </LanguageProvider>
    </VSCodeProvider>
  ),
  fifth,
)
await window.happyDOM.waitUntilComplete()
assert.equal(fifth.querySelectorAll('[data-component="spinner"]').length, 2)
assert.equal(fifth.querySelectorAll('[data-component="icon"]').length, 0)
const row = (id: string) => fourth.querySelector<HTMLElement>(`.am-pr-summary-row[data-target="${id}"]`)
const rowFix = (id: string) => row(id)?.querySelector<HTMLButtonElement>(".am-pr-summary-fix")
const rowJump = (id: string) => row(id)?.querySelector<HTMLButtonElement>(".am-pr-summary-jump")
assert.equal(fourth.querySelectorAll(".am-pr-summary-row").length, 4)
// The review row has no target and no actions.
assert.equal(fourth.querySelectorAll(".am-pr-summary-row:not([data-target]) button").length, 0)
assert.match(row("checks")?.textContent ?? "", /1\/2 checks passed/)
assert.equal(rowFix("checks")?.textContent?.trim(), "Fix with Kilo")
assert.equal(rowFix("comments")?.textContent?.trim(), "Fix 2 with Kilo")
assert.match(row("conversation")?.textContent ?? "", /3 PR comments/)
assert.equal(rowFix("conversation")?.textContent?.trim(), "Fix 1 with Kilo")
// Discussion is lower-confidence feedback than CI or review threads.
assert.equal(rowFix("checks")?.getAttribute("data-variant"), "primary")
assert.equal(rowFix("comments")?.getAttribute("data-variant"), "primary")
assert.equal(rowFix("conversation")?.getAttribute("data-variant"), "secondary")
for (const id of ["checks", "comments", "conversation"]) rowJump(id)!.click()
assert.deepEqual(jumped, ["checks", "comments", "conversation"])

const mark = sent.length
rowFix("checks")!.click()
const ci = sent.at(-1) as { autoSend: boolean; comments: Array<{ origin: string }> }
assert.equal(sent.length, mark + 1)
assert.equal(ci.autoSend, true)
assert.equal(ci.comments[0]?.origin, "ci")
// CI has no sent state; the button stays while failures exist.
assert.equal(rowFix("checks")?.textContent?.trim(), "Fix with Kilo")

rowFix("comments")!.click()
const threadsSent = sent.at(-1) as { comments: Array<{ id: string; origin: string }> }
assert.equal(sent.length, mark + 2)
assert.deepEqual(
  threadsSent.comments.map((item) => [item.id, item.origin]),
  [
    ["T_one", "pr"],
    ["T_two", "pr"],
  ],
)
assert.deepEqual(Object.keys(commentState(summaryWorktree).sent).sort(), ["T_one", "T_two"])
await window.happyDOM.waitUntilComplete()
assert.equal(rowFix("comments"), null)
assert.ok(rowJump("comments"))

rowFix("conversation")!.click()
const talk = sent.at(-1) as { comments: Array<{ id: string }> }
assert.equal(sent.length, mark + 3)
assert.deepEqual(
  talk.comments.map((item) => item.id),
  ["IC_human"],
)
await window.happyDOM.waitUntilComplete()
assert.equal(rowFix("conversation"), null)

// A terminal tab switches the labels and the transport.
setTerminal("term-1")
await window.happyDOM.waitUntilComplete()
assert.equal(rowFix("checks")?.textContent?.trim(), "Send failures to terminal")
rowFix("checks")!.click()
assert.equal(sent.length, mark + 3)
assert.equal(terminalSent.length, 1)

setSummaryPR((prev) => ({ ...prev, checks: summarize([{ name: "Tests", status: "success" }]) }))
await window.happyDOM.waitUntilComplete()
assert.match(row("checks")?.textContent ?? "", /All checks passing/)
assert.equal(rowFix("checks"), null)
assert.ok(rowJump("checks"))
disposeSummary()
