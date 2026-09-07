import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { PRStatus, WebviewMessage } from "../../webview-ui/src/types/messages"

const refreshed: WebviewMessage[] = []
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
  HTMLHeadElement: window.HTMLHeadElement,
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
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  acquireVsCodeApi: () => ({
    postMessage: (message: WebviewMessage) => {
      if (message.type === "agentManager.refreshPR") refreshed.push(message)
    },
    getState: () => undefined,
    setState: () => undefined,
  }),
})

const { render } = await import("solid-js/web")
const { MarkedProvider } = await import("@kilocode/kilo-ui/context/marked")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { PRComments } = await import("../../webview-ui/agent-manager/pr/PRComments")
const { Diff } = await import("@kilocode/kilo-ui/diff")
const { Show, createRoot, createSignal } = await import("solid-js")
const { WorktreeItem } = await import("../../webview-ui/agent-manager/WorktreeItem")
const { createPRNavigation, PRPanelHost } = await import("../../webview-ui/agent-manager/pr/PRPanelHost")
const { createPRReview } = await import("../../webview-ui/agent-manager/pr/review")
const { commentState, patchCommentState } = await import("../../webview-ui/agent-manager/pr/pr-comment-state")
const { createRemoteCommentController, createRemoteFocus } = await import(
  "../../webview-ui/diff-viewer/remote-comment-renderer"
)

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

const send = [...root.querySelectorAll('[data-component="button"]')].find((node) =>
  /Send to chat/.test(node.textContent ?? ""),
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
}))
const [diffs, setDiffs] = createSignal([
  { file: "inline.ts", before: "", after: "", additions: 2, deletions: 0, summarized: true },
])
const ready = Promise.withResolvers<ReturnType<typeof createRemoteCommentController>>()
const Probe = () => {
  const remote = createRemoteCommentController({
    key: () => "inline",
    comments: () => threads,
    diffs,
    active: () => true,
    activeTerminalId: () => undefined,
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
          <PRComments worktreeId="wt-test" comments={comments()} />
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
const retained = stable.querySelector("[data-line]")
assert.ok(retained)
assert.deepEqual(remote.outside(), [])
assert.equal(remote.location("inline.ts", "inline-1"), "pending")
assert.equal(remote.fileCount("inline.ts"), 2)
setDiffs([{ file: "inline.ts", before: "", after: "one\ntwo", additions: 2, deletions: 0, summarized: false }])
assert.equal(remote.location("inline.ts", "inline-1"), "inline")
assert.equal(remote.fileCount("inline.ts"), 2)
await window.happyDOM.waitUntilComplete()
assert.equal(stable.querySelector("[data-line]"), retained)
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
const replacement = remote.render(first.meta)
assert.notEqual(replacement, first.host)
check()
assert.equal(remote.render(first.meta), replacement)
assert.equal(remote.render(last.meta), last.host)
assert.equal(header.getAttribute("aria-expanded"), "false")
last.wrapper.remove()
check()
await window.happyDOM.waitUntilComplete()
assert.notEqual(remote.render(last.meta), last.host)
remote.cleanup()
globalThis.MutationObserver = Native
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
window.HTMLElement.prototype.scrollIntoView = () => {
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
const preview = {
  patch:
    '@@ -396,0 +414,7 @@\n+                      size="small"\n+                      class="session-goal-trigger"\n+                      disabled={props.readonly}\n+                      aria-label={language.t("session.goal.label")}\n+                    >\n+                      <Icon name="chevron-down" size="small" />\n+                      <span>',
  line: 417,
  side: "additions" as const,
  base: "785b0bcdf7ac765dd29016cc7e8f25f66dc473c1",
  head: "a6f67ce22c9e220ad8f30bf880b623ef9a77c623",
  top: true,
  bottom: true,
}
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
        diffHunk: preview.patch,
        after: ["DIRTY WORKTREE CONTENT"],
        preview,
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
  const wrapper = inline().closest<HTMLElement>("[slot]")
  const host = inline().closest("diffs-container")
  assert.ok(wrapper && host)
  assert.equal(wrapper.parentElement, host)
  assert.equal(wrapper.getAttribute("slot"), name)
  assert.ok(host.shadowRoot!.querySelector(`slot[name="${name}"]`))
}
const container = inline().closest("diffs-container")!
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
assert.equal(inline().closest("diffs-container"), container)
assert.match(inline().textContent ?? "", /Updated committed thread/)
const count = sent.length
inline().querySelector<HTMLButtonElement>('.am-pr-comment-actions [data-variant="primary"]')!.click()
await window.happyDOM.waitUntilComplete()
assert.equal(sent.length, count + 1)
inline().querySelector<HTMLButtonElement>(".am-pr-comment-head")!.click()
await window.happyDOM.waitUntilComplete()
assert.equal(inline().closest("diffs-container"), null)
assert.equal(inline().querySelector(".am-pr-comment-head")!.getAttribute("aria-expanded"), "false")
inline().querySelector<HTMLButtonElement>(".am-pr-comment-head")!.click()
await window.happyDOM.waitUntilComplete()
placed("annotation-additions-417")
setBadge((prev) => ({
  ...prev,
  comments: {
    ...prev.comments!,
    comments: prev.comments!.comments.map((comment) => ({
      ...comment,
      file: "removed.ts",
      line: 42,
      side: "deletions",
      preview: { ...preview, patch: "@@ -41,3 +41,2 @@\n before\n-removed\n after", line: 42, side: "deletions" },
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
