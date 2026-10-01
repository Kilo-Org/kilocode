import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from "../../../ui/src/components/markdown-worker-protocol"

const window = new Window()
window.document.write("<!doctype html><html><head></head><body></body></html>")
// DOMPurify calls the base Node getter directly; happy-dom leaves subclass names empty.
const name = Object.getOwnPropertyDescriptor(window.Node.prototype, "nodeName")!
Object.defineProperty(window.Node.prototype, "nodeName", {
  ...name,
  get() {
    if (this instanceof window.Element) return this.tagName
    if (this instanceof window.Text) return "#text"
    return name.get!.call(this)
  },
})
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLAnchorElement: window.HTMLAnchorElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLDivElement: window.HTMLDivElement,
  HTMLPreElement: window.HTMLPreElement,
})

const success = process.argv.at(-1) === "success"
const requests: MarkdownWorkerRequest[] = []
const channel = {
  onmessage: undefined as ((event: { data: MarkdownWorkerRequest }) => void) | undefined,
  postMessage: undefined as ((data: MarkdownWorkerResponse) => void) | undefined,
}
class Transport {
  onmessage?: (event: { data: MarkdownWorkerResponse }) => void
  constructor() {
    if (!success) throw new Error("Browser workers are unavailable")
    channel.postMessage = (data) => queueMicrotask(() => this.onmessage?.({ data }))
  }
  postMessage(data: MarkdownWorkerRequest) {
    requests.push(data)
    queueMicrotask(() => channel.onmessage?.({ data }))
  }
}
Object.assign(globalThis, { Worker: Transport, self: channel })
// Emulate only the browser message boundary; successful replies use the real worker and Shiki.
if (success) await import("../../../ui/src/components/markdown-shiki.worker")

const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { Markdown } = await import("../../../ui/src/components/markdown")
const { MarkedProvider } = await import("../../../ui/src/context/marked")
const text =
  '```python\ndef greet(name):\n    return "Hello " + name\n```\n\n```javascript\nconst greet = (name) => "Hello " + name;\n```\n'
const [streaming, settle] = createSignal(true)
const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <MarkedProvider>
      <Markdown text={text} streaming={streaming()} />
    </MarkedProvider>
  ),
  root,
)
const colored = (code: Element) => [...code.querySelectorAll("span")].some((span) => !!span.style.color)
const wait = async (check: () => boolean) => {
  const deadline = Date.now() + 5_000
  while (!check()) {
    assert(Date.now() < deadline, `Timed out: ${root.innerHTML}`)
    await Bun.sleep(10)
  }
}

try {
  await wait(
    () =>
      root.querySelectorAll("pre code").length === 2 &&
      [...root.querySelectorAll("pre code")].every((code) => code.children.length > 0 && colored(code) === success),
  )
  await Bun.sleep(30)
  const codes = [...root.querySelectorAll("pre code")]
  assert.equal(codes.at(0)?.textContent?.trim(), 'def greet(name):\n    return "Hello " + name')
  assert.equal(codes.at(1)?.textContent?.trim(), 'const greet = (name) => "Hello " + name;')
  assert(codes.every((code) => colored(code) === success))
  const count = requests.length
  // Only the streaming flag changes, with no text update, remount, or follow-up message.
  settle(false)
  await wait(
    () => root.querySelectorAll("pre code").length === 2 && [...root.querySelectorAll("pre code")].every(colored),
  )
  await Bun.sleep(30)
  assert.equal(root.querySelectorAll("pre code").length, 2)
  assert.deepEqual(
    [...root.querySelectorAll("pre code")].map((code) => code.textContent?.trim()),
    codes.map((code) => code.textContent?.trim()),
    "Settling must preserve the code text",
  )
  if (success) {
    assert.equal(requests.length, count, "Completed worker results should be cached")
    assert.deepEqual([...root.querySelectorAll("pre code")], codes, "Settling must retain worker DOM nodes")
    assert.equal(
      root.querySelector("pre[data-source-hash]"),
      null,
      "Main-thread fallback must not replace worker highlights",
    )
  }
} finally {
  dispose()
  await window.happyDOM.close()
}
