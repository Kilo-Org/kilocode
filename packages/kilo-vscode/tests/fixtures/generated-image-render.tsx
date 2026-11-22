import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { AssistantMessage, FilePart, ToolPart } from "@kilocode/sdk/v2"

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

const { render } = await import("solid-js/web")
const { Part } = await import("@kilocode/kilo-ui/message-part")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { MarkedProvider } = await import("@kilocode/kilo-ui/context/marked")
const { isRenderable } = await import("../../webview-ui/src/utils/transcript-parts")

const url = "data:image/png;base64,iVBORw0KGgo="
const message: AssistantMessage = {
  id: "assistant",
  sessionID: "session",
  role: "assistant",
  parentID: "prompt",
  modelID: "google/gemini-nano-banana-2.1",
  providerID: "kilo",
  mode: "code",
  agent: "code",
  path: { cwd: "/test", root: "/test" },
  time: { created: 1, completed: 2 },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}

// Image generated inline by the chat model.
const file: FilePart = {
  id: "file",
  sessionID: message.sessionID,
  messageID: message.id,
  type: "file",
  mime: "image/png",
  url,
  filename: "image-1.png",
}

// Image returned by the generate_image tool, which has no dedicated card.
const tool: ToolPart = {
  id: "tool",
  sessionID: message.sessionID,
  messageID: message.id,
  type: "tool",
  callID: "call",
  tool: "generate_image",
  state: {
    status: "completed",
    input: { prompt: "a dot", path: "dot.png" },
    output: "Image saved to dot.png.",
    metadata: {},
    title: "dot.png",
    time: { start: 1, end: 2 },
    attachments: [
      { ...file, id: "attachment", filename: "dot.png" },
      // Sessions saved before inline data used workspace file:// URLs, which the webview CSP blocks.
      { ...file, id: "legacy", url: "file:///test/old.png", filename: "old.png" },
    ],
  },
}

// send_file deliveries are unnormalized mobile payloads and stay out of the transcript.
const delivery: ToolPart = {
  ...tool,
  id: "delivery",
  callID: "delivery-call",
  tool: "send_file",
  state: { ...tool.state, attachments: [{ ...file, id: "delivery-file", filename: "sent.png" }] },
}

assert.equal(isRenderable(file, message), true, "assistant image file parts must be renderable")

const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <DialogProvider>
      <MarkedProvider>
        <Part part={file} message={message} />
        <Part part={tool} message={message} />
        <Part part={delivery} message={message} />
      </MarkedProvider>
    </DialogProvider>
  ),
  root,
)

try {
  const images = Array.from(root.querySelectorAll('img[data-slot="tool-read-image-img"]'))
  assert.deepEqual(
    images.map((img) => [img.getAttribute("src"), img.getAttribute("alt")]),
    [
      [url, "image-1.png"],
      [url, "dot.png"],
    ],
  )
} finally {
  dispose()
  await window.happyDOM.cancelAsync()
  await window.happyDOM.close()
}
