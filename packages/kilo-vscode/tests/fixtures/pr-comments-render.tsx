import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: window.location.origin })
class CSSStyleSheetStub {
  replaceSync() {}
  replace() {
    return Promise.resolve(this)
  }
}

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLDivElement: window.HTMLDivElement,
  HTMLPreElement: window.HTMLPreElement,
  HTMLAnchorElement: window.HTMLAnchorElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  ShadowRoot: window.ShadowRoot,
  customElements: window.customElements,
  CSSStyleSheet: CSSStyleSheetStub,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const { render } = await import("solid-js/web")
const { MarkedProvider } = await import("@kilocode/kilo-ui/context/marked")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { PRComments } = await import("../../webview-ui/agent-manager/pr/PRComments")
const { createSignal } = await import("solid-js")

const root = document.createElement("div")
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
      body: "comment body survives Pierre rendering",
      file: "packages/kilo-ui/src/components/file.tsx",
      line: 14,
      resolved: false,
      outdated: false,
      diffHunk: HUNK,
      // Read from the worktree by the extension: a hunk stops at the commented line.
      after: ["  return <View {...options} />", "}", ""],
      replies: [{ author: "marius", body: "reply body is visible" }],
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
          <PRComments worktreeId="wt-test" comments={comments()} />
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
assert.doesNotMatch(root.textContent ?? "", /second paragraph only shows when expanded/)

// The row expands into a full card whose unresolve action is enabled.
;(resolvedRow as HTMLButtonElement).click()
await window.happyDOM.waitUntilComplete()
assert.equal(resolvedRow!.getAttribute("aria-expanded"), "true")
assert.match(root.textContent ?? "", /second paragraph only shows when expanded/)
const card = resolvedRow!.parentElement!
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

// Send to agent hands the thread over as a structured review comment.
const send = [...root.querySelectorAll('[data-component="button"]')].find((node) =>
  /Send to agent/.test(node.textContent ?? ""),
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

// A remount must not lobotomize the panel. The extension can briefly report no
// PR, which tears these components down and builds them again. What the user
// opened, and what was already sent, are held per worktree outside the
// component, so both survive.
dispose()
const second = document.createElement("div")
document.body.append(second)
const disposeSecond = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <MarkedProvider>
          <PRComments worktreeId="wt-test" comments={comments()} />
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
disposeSecond()
