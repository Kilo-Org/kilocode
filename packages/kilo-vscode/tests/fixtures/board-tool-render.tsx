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
const { MarkedProvider, createMarkedParser } = await import("@kilocode/kilo-ui/context/marked")

const labels = ["initial", "hidden", "latest", "reopened", "search", "search-updated"]
const outputs = labels.map((label) =>
  JSON.stringify({
    messages: [
      { from: "worker", to: "main", fromLabel: `Worker ${label}`, toLabel: "Coordinator", body: `**${label}** body` },
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
const dispose = render(
  () => (
    <MarkedProvider
      nativeParser={async (text) => {
        parsed.push(text)
        return parser.parse(text)
      }}
    >
      <Part part={part} message={message} forceOpen={search()} />
    </MarkedProvider>
  ),
  root,
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
  assert.equal(root.querySelector('[data-slot="board-message-body"] strong')?.textContent, label)
  assert.equal(root.querySelector(".board-route-sender")?.textContent, `Worker ${label}`)
  assert.equal(root.querySelector(".board-route-recipient")?.textContent, "Coordinator")
  assert(parsed.includes(`**${label}** body`))
}

try {
  await settle()
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
  assert.deepEqual(parsed, ["**latest** body"])

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
  JSON.parse = decode
  await window.happyDOM.cancelAsync()
  await window.happyDOM.close()
}
