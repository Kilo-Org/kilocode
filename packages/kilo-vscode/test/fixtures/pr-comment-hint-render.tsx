import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  customElements: window.customElements,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  KeyboardEvent: window.KeyboardEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  acquireVsCodeApi: () => ({ postMessage: (msg: unknown) => posted.push(msg), getState: () => undefined, setState: () => undefined }),
})
const posted: unknown[] = []
for (const name of [
  "HTMLDivElement",
  "HTMLSpanElement",
  "HTMLParagraphElement",
  "HTMLPreElement",
  "HTMLAnchorElement",
  "HTMLImageElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLTableElement",
  "HTMLLIElement",
  "HTMLUListElement",
  "HTMLOListElement",
  "HTMLHeadingElement",
  "HTMLBRElement",
  "HTMLTemplateElement",
  "DocumentFragment",
  "ShadowRoot",
  "Text",
  "Comment",
  "CustomEvent",
]) {
  if (window[name] && !(name in globalThis)) globalThis[name] = window[name]
}
Object.assign(window, { KILO_SETTINGS: { "chat.sendWhileRunning": "steer" } })

const { render } = await import("solid-js/web")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { resolveTemplate } = await import("../../webview-ui/src/context/language-utils")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { dict: amDict } = await import("../../webview-ui/agent-manager/i18n/en")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { RichProvider } = await import("../../webview-ui/src/context/rich-provider")
const { PRCommentCard } = await import("../../webview-ui/agent-manager/pr/PRCommentCard")
const { PRChecks } = await import("../../webview-ui/agent-manager/pr/PRChecks")
const { PRSummary } = await import("../../webview-ui/agent-manager/pr/PRSummary")
const { PRComments } = await import("../../webview-ui/agent-manager/pr/PRComments")
const { PRConversation } = await import("../../webview-ui/agent-manager/pr/PRConversation")
const { PRMerge } = await import("../../webview-ui/agent-manager/pr/PRMerge")
const { PRCommentForm } = await import("../../webview-ui/agent-manager/pr/PRCommentForm")
const { isMac } = await import("../../webview-ui/src/v2/pending-actions")
const { clickModifier } = await import("../../webview-ui/src/v2/send-hint-text")
const { APPEND_REVIEW_COMMENTS } = await import("../../webview-ui/diff-viewer/review-annotations")

const english = { ...dict, ...amDict } as Record<string, string>

const language = {
  locale: () => "en" as const,
  setLocale: () => undefined,
  userOverride: () => "" as const,
  t: (key: string, params?: Record<string, string | number | boolean | undefined>) =>
    resolveTemplate(english[key] ?? key, params),
}

const comment = {
  id: "c1",
  threadId: "t1",
  origin: "pr" as const,
  author: "octocat",
  body: "Please fix this thread.",
  file: "src/a.ts",
  line: 3,
  url: "https://github.com/o/r/pull/1#discussion_r1",
}

const pr = {
  number: 1,
  title: "Test PR",
  url: "https://github.com/o/r/pull/1",
  state: "open" as const,
  review: null,
  reviewers: [],
  checks: { total: 1, passed: 0, status: "failure" as const, checks: [{ name: "lint", status: "failure" as const }] },
  comments: { total: 0, unresolved: 0, comments: [] },
  additions: 1,
  deletions: 0,
  files: 1,
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const alternate = `${isMac() ? "⌥↵" : "Alt+Enter"} / ${clickModifier()}+click`
const expected = (title: string) => [
  [title, "click"],
  ["Queue for after this turn", alternate],
]
// A row whose action has no key of its own, such as a section summary, advertises the click only.
const expectedClick = (title: string) => [
  [title, "click"],
  ["Queue for after this turn", `${clickModifier()}+click`],
]

async function verify(label: string, children: () => unknown, title: string, expectRows = expected) {
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () => (
      <LanguageContext.Provider value={language}>
        <VSCodeProvider>
          <RichProvider>{children()}</RichProvider>
        </VSCodeProvider>
      </LanguageContext.Provider>
    ),
    root,
  )
  try {
    await tick()
    assert.equal(document.querySelector(".send-hint"), null, `${label}: the hint starts closed`)
    const button = [...root.querySelectorAll("button")].find((item) => item.textContent?.trim() === title)
    assert.ok(button, `${label}: the button is rendered`)
    const trigger = button.closest("[data-component=tooltip-trigger]")
    assert.ok(trigger, `${label}: the button is wrapped in a tooltip trigger`)
    trigger.dispatchEvent(new window.PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }))
    await tick(600)
    const hintRows = [...document.querySelectorAll(".send-hint [data-slot=tooltip-keybind]")].map((row) =>
      [...row.querySelectorAll("span")].map((span) => span.textContent),
    )
    assert.deepEqual(hintRows, expectRows(title), label)
  } finally {
    dispose()
    root.remove()
  }
}

await verify(
  "PR comment card",
  () => (
    <PRCommentCard
      comment={comment}
      resolved={false}
      pending={false}
      sent={false}
      open={true}
      onToggleOpen={() => undefined}
      onSend={() => undefined}
    />
  ),
  "Fix with Kilo",
)

await verify("PR checks", () => <PRChecks pr={pr} worktreeId="hint-checks" />, "Fix with Kilo")

await verify("PR summary", () => <PRSummary pr={pr} worktreeId="hint-summary" />, "Fix with Kilo", expectedClick)

const thread = {
  id: "r1",
  threadId: "th1",
  author: "octocat",
  body: "Please fix this thread.",
  resolved: false,
  file: "src/a.ts",
  line: 3,
  side: "RIGHT",
  createdAt: new Date().toISOString(),
}

await verify(
  "PR comments send all",
  () => (
    <PRComments
      comments={{ total: 1, unresolved: 1, comments: [thread] }}
      worktreeId="hint-comments"
      prNumber={1}
      prUrl="https://github.com/o/r/pull/1"
    />
  ),
  language.t("agentManager.pr.fixWithKiloCount", { count: 1 }),
)

const conversation = [
  { kind: "issue" as const, id: "c-a", author: "octocat", body: "First comment." },
  { kind: "issue" as const, id: "c-b", author: "hubot", body: "Second comment." },
]

await verify(
  "PR conversation",
  () => (
    <PRConversation
      items={conversation}
      worktreeId="hint-conversation"
      prNumber={1}
      prUrl="https://github.com/o/r/pull/1"
    />
  ),
  language.t("agentManager.pr.conversation.sendAll", { count: 2 }),
)

await verify(
  "terminal target",
  () => <PRChecks pr={pr} worktreeId="hint-terminal" activeTerminalId="term-1" />,
  language.t("agentManager.pr.checks.terminal"),
  (title) => [[title, "click"]],
)

await verify(
  "PR comment card terminal target",
  () => (
    <PRCommentCard
      comment={comment}
      resolved={false}
      pending={false}
      sent={false}
      open={true}
      activeTerminalId="term-1"
      onToggleOpen={() => undefined}
      onSend={() => undefined}
    />
  ),
  language.t("agentManager.pr.comment.sendToTerminal"),
  (title) => [[title, "click"]],
)

const conflictingPR = {
  ...pr,
  merge: {
    state: "dirty" as const,
    mergeable: "conflicting" as const,
    canWrite: true,
    methods: ["squash" as const],
  },
}

await verify(
  "PR merge conflicts fix",
  () => <PRMerge pr={conflictingPR} worktreeId="wt-conflict" mode="status" />,
  language.t("agentManager.pr.merge.fix"),
)

// Verify PRMerge forwards plain click vs Option-click send intent to updateFromBase.
{
  posted.length = 0
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () => (
      <LanguageContext.Provider value={language}>
        <VSCodeProvider>
          <RichProvider>
            <PRMerge pr={conflictingPR} worktreeId="wt-conflict" projectId="prj-1" mode="status" />
          </RichProvider>
        </VSCodeProvider>
      </LanguageContext.Provider>
    ),
    root,
  )
  try {
    await tick()
    const btn = [...root.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Fix with Kilo")!
    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, altKey: false }))
    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, altKey: true }))
    await tick()
    const updates = posted.filter(
      (item): item is { type: string; send?: string } =>
        typeof item === "object" && item !== null && (item as { type?: string }).type === "agentManager.updateFromBase",
    )
    assert.deepEqual(
      updates.map((item) => item.send),
      ["enter", "alternate"],
      "PR merge conflict Fix with Kilo forwards click send intent",
    )
  } finally {
    dispose()
    root.remove()
  }
}

// ⌥/Alt+Enter queues from the comments section, from a focused card, and stays out of reply fields.
async function altEnterChecks(worktreeId: string, run: (section: HTMLElement, sent: string[]) => Promise<void>) {
  const sent: string[] = []
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ comments: unknown[]; send?: string; handled?: boolean }>).detail
    if (!detail || detail.handled || detail.comments.length === 0) return
    detail.handled = true
    sent.push(detail.send ?? "enter")
  }
  window.addEventListener(APPEND_REVIEW_COMMENTS, listener)
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () => (
      <LanguageContext.Provider value={language}>
        <VSCodeProvider>
          <RichProvider>
            <PRComments
              comments={{ total: 1, unresolved: 1, comments: [thread] }}
              worktreeId={worktreeId}
              prNumber={1}
              prUrl="https://github.com/o/r/pull/1"
            />
          </RichProvider>
        </VSCodeProvider>
      </LanguageContext.Provider>
    ),
    root,
  )
  try {
    await tick()
    const section = root.querySelector<HTMLElement>(".am-pr-panel-section")
    assert.ok(section, "the comments section is rendered")
    await run(section, sent)
  } finally {
    dispose()
    root.remove()
    window.removeEventListener(APPEND_REVIEW_COMMENTS, listener)
  }
}

await altEnterChecks("hint-alt-section", async (section, sent) => {
  section.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", altKey: true, bubbles: true }))
  await tick()
  assert.deepEqual(sent, ["alternate"], "Alt+Enter in the comments section queues the unsent threads")
})

await altEnterChecks("hint-alt-field", async (section, sent) => {
  const openReply = [...section.querySelectorAll("button")].find((item) => /reply/i.test(item.textContent ?? ""))!
  assert.ok(openReply, "the card offers a reply field")
  openReply.click()
  await tick()
  const reply = section.querySelector<HTMLTextAreaElement>("textarea")
  assert.ok(reply, "the reply field is rendered inside the section")
  reply.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", altKey: true, bubbles: true }))
  await tick()
  assert.deepEqual(sent, [], "Alt+Enter inside the reply field does not send the section")
})

await altEnterChecks("hint-alt-card", async (section, sent) => {
  const fix = [...section.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === language.t("agentManager.pr.fixWithKilo"),
  )
  assert.ok(fix, "the review card offers Fix with Kilo")
  fix.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", altKey: true, bubbles: true }))
  await tick()
  assert.deepEqual(sent, ["alternate"], "Alt+Enter on the focused card queues that thread")
})

// Verify PRCommentForm diff mode tooltip, Option+click, Enter, and Option+Enter.
{
  const mac = isMac()
  const mod = clickModifier()
  const sent: string[] = []
  const saved: string[] = []
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () => (
      <LanguageContext.Provider value={language}>
        <VSCodeProvider>
          <RichProvider>
            <PRCommentForm
              action="diff"
              worktreeId="wt-diff"
              file="src/a.ts"
              side="RIGHT"
              startLine={4}
              endLine={4}
              selectedText="const x = 1"
              destination="local"
              initialBody="nit"
              onSave={(body) => saved.push(body)}
              onSendKilo={(_body, _selected, intent) => sent.push(intent)}
              onGithubSuccess={() => undefined}
              onCancel={() => undefined}
            />
          </RichProvider>
        </VSCodeProvider>
      </LanguageContext.Provider>
    ),
    root,
  )
  try {
    await tick()
    const btn = root.querySelector<HTMLButtonElement>("[data-action=send-kilo]")!
    assert.ok(btn, "PRCommentForm renders Send to Kilo")
    const trigger = btn.closest("[data-component=tooltip-trigger]")!
    trigger.dispatchEvent(new window.PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }))
    await tick(600)
    const hintRows = [...document.querySelectorAll(".send-hint [data-slot=tooltip-keybind]")].map((row) =>
      [...row.querySelectorAll("span")].map((span) => span.textContent),
    )
    assert.deepEqual(hintRows, [
      ["Send to Kilo", mac ? "↵" : "Enter"],
      ["Queue for after this turn", `${mac ? "⌥↵" : "Alt+Enter"} / ${mod}+click`],
    ])
    const field = root.querySelector<HTMLTextAreaElement>("textarea")!
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!
    const refill = (value: string) => {
      setter.call(field, value)
      field.dispatchEvent(new window.Event("input", { bubbles: true }))
    }
    field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await tick()
    refill("nit 2")
    await tick()
    field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", altKey: true, bubbles: true }))
    await tick()
    refill("nit 3")
    await tick()
    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, altKey: true }))
    await tick()
    refill("save me")
    await tick()
    field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }))
    await tick()
    assert.deepEqual(sent, ["enter", "alternate", "alternate"], "PRCommentForm sends enter and alternate from keys and click")
    assert.deepEqual(saved, ["save me"], "PRCommentForm saves on Cmd+Enter")
  } finally {
    dispose()
    root.remove()
  }
}
