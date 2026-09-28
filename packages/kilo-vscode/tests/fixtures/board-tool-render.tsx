import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { AssistantMessage, ToolPart } from "@kilocode/sdk/v2"

const window = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLAnchorElement: window.HTMLAnchorElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLDivElement: window.HTMLDivElement,
  HTMLPreElement: window.HTMLPreElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})

const { createSignal } = await import("solid-js")
const { createStore } = await import("solid-js/store")
const { render } = await import("solid-js/web")
const { Part } = await import("@kilocode/kilo-ui/message-part")
const { AgentAvatarPalette } = await import("@kilocode/kilo-ui/agent-avatar")
const { BoardMessage, BoardRoute } = await import("@kilocode/kilo-ui/board-message")
const { BoardNavigationProvider } = await import("@kilocode/kilo-ui/context/board-navigation")
const { MarkedProvider, createMarkedParser } = await import("@kilocode/kilo-ui/context/marked")

const labels = ["initial", "hidden", "latest", "reopened", "search", "search-updated"]
const outputs = labels.map((label) =>
  JSON.stringify({
    messages: [
      { from: "worker", to: "main", fromLabel: `Worker ${label}`, toLabel: "Coordinator", body: `**${label}** body` },
      { from: "reviewer", to: "worker", fromLabel: "Reviewer", toLabel: `Worker ${label}`, body: "Secondary body" },
    ],
    hasMore: false,
  }),
)
const message: AssistantMessage = {
  id: "assistant",
  sessionID: "child",
  role: "assistant",
  parentID: "prompt",
  modelID: "test",
  providerID: "test",
  mode: "code",
  agent: "code",
  path: { cwd: "/test", root: "/test" },
  time: { created: 1, completed: 2 },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}
const [part, setPart] = createStore({
  id: "board-read",
  sessionID: message.sessionID,
  messageID: message.id,
  type: "tool",
  callID: "board-read-call",
  tool: "board_read",
  state: {
    status: "completed",
    input: { limit: 1 },
    output: outputs.at(0)!,
    metadata: {},
    title: "Board messages",
    time: { start: 1, end: 2 },
  },
} satisfies ToolPart)
const [search, setSearch] = createSignal(false)
const parsed: string[] = []
const decoded: string[] = []
const parser = createMarkedParser({})
const decode = JSON.parse
JSON.parse = (text, reviver) => {
  if (outputs.includes(text)) decoded.push(text)
  return decode(text, reviver)
}
const root = document.createElement("div")
document.body.append(root)
const broadcastRoot = document.createElement("div")
document.body.append(broadcastRoot)
const workerBroadcastRoot = document.createElement("div")
document.body.append(workerBroadcastRoot)
const directRoot = document.createElement("div")
document.body.append(directRoot)
const opened: Array<{ id: string; title?: string }> = []
const dispose = render(
  () => (
    <BoardNavigationProvider open={() => {}}>
      <MarkedProvider
        nativeParser={async (text) => {
          parsed.push(text)
          return parser.parse(text)
        }}
      >
        <Part part={part} message={message} forceOpen={search()} />
      </MarkedProvider>
    </BoardNavigationProvider>
  ),
  root,
)
const disposeBroadcast = render(
  () => (
    <AgentAvatarPalette ids={["worker", "reviewer"]}>
      <BoardRoute from="main" to="ALL" fromLabel="Coordinator" toLabel="All agents" />
    </AgentAvatarPalette>
  ),
  broadcastRoot,
)
const disposeWorkerBroadcast = render(
  () => (
    <AgentAvatarPalette ids={["worker"]}>
      <BoardRoute from="worker" to="ALL" fromLabel="Worker" toLabel="All agents" />
    </AgentAvatarPalette>
  ),
  workerBroadcastRoot,
)
const disposeDirect = render(
  () => (
    <MarkedProvider
      nativeParser={async (text) => {
        return parser.parse(text)
      }}
    >
      <BoardNavigationProvider open={(id, title) => opened.push({ id, title })}>
        <BoardMessage from="main" to="worker" fromLabel="Coordinator" toLabel="Worker" body="body" />
      </BoardNavigationProvider>
    </MarkedProvider>
  ),
  directRoot,
)
const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}
const trigger = () => {
  const button = root.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
  assert(button)
  return button
}
const update = async (index: number) => {
  setPart("state", "output", outputs.at(index)!)
  await settle()
}
const visible = (label: string) => {
  assert.equal(trigger().getAttribute("aria-expanded"), "true")
  const stack = root.querySelector('[data-component="board-participant-stack"]')
  assert(stack)
  assert.equal(stack.querySelectorAll('[data-component="icon"]').length, 1)
  assert.equal(stack.querySelectorAll('[data-component="agent-avatar"]').length, 2)
  assert.equal(root.querySelector('[data-slot="board-message-body"] strong')?.textContent, label)
  assert.equal(root.querySelector(".board-route-sender")?.textContent, `Worker ${label}`)
  assert.equal(root.querySelector(".board-route-recipient")?.textContent, "Coordinator")
  assert(parsed.includes(`**${label}** body`))
}

try {
  await settle()
  const recipient = broadcastRoot.querySelector('[data-slot="board-route-recipient-icon"]')
  assert(recipient)
  assert.equal(recipient.querySelectorAll('[data-component="board-participant-stack"]').length, 1)
  assert.equal(recipient.querySelectorAll('[data-component="agent-avatar"]').length, 2)
  const workerRecipient = workerBroadcastRoot.querySelector('[data-slot="board-route-recipient-icon"]')
  assert(workerRecipient)
  assert.equal(workerRecipient.querySelectorAll('[data-component="board-participant-stack"]').length, 0)
  assert.equal(workerRecipient.querySelectorAll('[data-component="icon"]').length, 2)
  const headerAvatar = root.querySelector<HTMLElement>(
    '[data-component="board-participant-stack"] [data-slot="board-route-avatar"]',
  )
  assert(headerAvatar)
  assert.equal(headerAvatar.getAttribute("role"), null)
  assert.equal(headerAvatar.getAttribute("tabindex"), null)
  const headerTrigger = headerAvatar.closest<HTMLElement>('[data-slot="collapsible-trigger"]')
  assert(headerTrigger)
  const expanded = headerTrigger.getAttribute("aria-expanded")
  headerAvatar.click()
  await settle()
  assert.equal(headerTrigger.getAttribute("aria-expanded"), expanded)
  const avatar = directRoot.querySelector<HTMLElement>('[data-slot="board-route-avatar"]')
  assert(avatar)
  assert.equal(avatar.getAttribute("role"), "button")
  avatar.click()
  await settle()
  assert.deepEqual(opened, [{ id: "worker", title: "Worker" }])
  for (const index of [0, 1, 2]) {
    if (index) await update(index)
    assert.equal(trigger().getAttribute("aria-expanded"), "false")
    assert.equal(root.querySelector('[data-component="board-messages"]'), null)
    assert.equal(root.querySelector('[data-component="markdown"]'), null)
    assert.deepEqual(parsed, [])
    assert.deepEqual(decoded, outputs.slice(0, index + 1))
  }

  trigger().click()
  await settle()
  visible("latest")
  assert.deepEqual(parsed, ["**latest** body", "Secondary body"])

  trigger().click()
  await settle()
  await update(3)
  trigger().click()
  await settle()
  visible("reopened")

  trigger().click()
  await settle()
  await update(4)
  setSearch(true)
  await settle()
  visible("search")
  await update(5)
  visible("search-updated")
  assert.deepEqual(decoded, outputs)
} finally {
  dispose()
  disposeBroadcast()
  disposeWorkerBroadcast()
  disposeDirect()
  JSON.parse = decode
  await window.happyDOM.cancelAsync()
  await window.happyDOM.close()
}
