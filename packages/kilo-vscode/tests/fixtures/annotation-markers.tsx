import { createSignal, Show } from "solid-js"
import { render } from "solid-js/web"
import { AnnotationMarkers } from "../../webview-ui/src/components/chat/AnnotationMarkers"
import { resolveAssistantCapture } from "../../webview-ui/src/components/chat/SelectionToolbar"
import { captureAnnotationAnchor, resolveAnnotationAnchor } from "../../webview-ui/src/utils/annotation-anchors"
import { createAnnotationBridge } from "../../webview-ui/src/utils/annotation-bridge"
import { newAnnotation, type Annotation } from "../../webview-ui/src/utils/annotations"
import { clearAcceptedAnnotationDraft } from "../../webview-ui/src/utils/annotation-state"
import type { AnnotationRequest, AnnotationReply } from "../../src/shared/annotations"
import "../../../kilo-ui/src/components/button.css"

declare global {
  interface Window {
    annotationHost: (message: AnnotationRequest) => Promise<AnnotationReply>
    markers: ReturnType<typeof harness>
  }
}

function harness() {
  let hashes = 0
  const digest = crypto.subtle.digest.bind(crypto.subtle)
  crypto.subtle.digest = (algorithm, data) => {
    hashes++
    return digest(algorithm, data)
  }
  const [scope, setScope] = createSignal("ses_a")
  const [items, setItems] = createSignal<Annotation[]>([])
  const [wrapped, setWrapped] = createSignal(false)
  const [changed, setChanged] = createSignal(false)
  const [visible, setVisible] = createSignal(true)
  const pending = new Map<string, Annotation[]>()
  let root!: HTMLDivElement
  const listeners = new Set<(message: AnnotationReply | { type: string }) => void>()
  const bridge = createAnnotationBridge({
    postMessage: (message) => {
      void window.annotationHost(message).then((reply) => {
        for (const listener of listeners) listener(reply)
      })
    },
    onMessage: (callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    changed: (message) => {
      if (message.sessionID === scope()) setItems(message.items)
    },
  })
  const dispose = render(
    () => (
      <>
        <div
          ref={root}
          data-transcript-root=""
          data-session={scope()}
          style={{ height: "350px", overflow: "auto", width: "440px", "margin-top": "60px" }}
        >
          <div style={{ height: "30px" }} />
          <Show when={visible()}>
            <div data-row="assistant" data-session={scope()} data-message="msg_a">
              <div data-component="text-part">
                <p style={{ "line-height": "30px", "font-size": "16px" }}>
                  <Show when={wrapped()} fallback={"repeat target / repeat target / repeat target"}>
                    <span>repeat target / </span>
                    <strong>repeat target</strong>
                    <span> / repeat target</span>
                  </Show>
                  <Show when={changed()}> source changed</Show>
                  <button type="button">Copy unwanted button text</button>
                </p>
              </div>
            </div>
          </Show>
          <div style={{ height: "500px" }} />
        </div>
        <AnnotationMarkers
          transcript={() => root}
          sessionID={scope}
          items={items}
          label={(number) => `Annotation #${number}`}
        />
      </>
    ),
    document.body,
  )

  const select = (occurrence: number) => {
    const paragraph = root.querySelector("p")!
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode())
      if (!walker.currentNode.parentElement?.closest("button")) nodes.push(walker.currentNode as Text)
    const start = occurrence * 16
    const end = start + 13
    const range = document.createRange()
    let offset = 0
    for (const node of nodes) {
      if (offset <= start && offset + node.length > start) range.setStart(node, start - offset)
      if (offset < end && offset + node.length >= end) range.setEnd(node, end - offset)
      offset += node.length
    }
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    return range
  }

  return {
    hashes: () => hashes,
    add: async (occurrence: number) => {
      const range = select(occurrence)
      const capture = resolveAssistantCapture(new Set(), root, scope())!
      if (!capture?.range || capture.range === range) throw new Error("Selection range was not cloned")
      window.getSelection()?.removeAllRanges()
      const anchor = await captureAnnotationAnchor(capture.row, capture.range)
      if (!anchor) throw new Error("Missing source anchor")
      const item = await bridge.save(
        newAnnotation({
          sessionID: scope(),
          messageID: "msg_a",
          selectedText: capture.text,
          comment: "source comment",
          anchor,
        }),
      )
      pending.set(scope(), [...(pending.get(scope()) ?? []), item])
      return item
    },
    selection: () => {
      select(1)
      return resolveAssistantCapture(new Set(), root, scope())?.text
    },
    anchoredOffset: async () => {
      const item = items()[0]!
      const range = await resolveAnnotationAnchor(root.querySelector('[data-row="assistant"]')!, item.anchor!)
      return range
        ? { offset: range.startOffset, quote: range.toString(), rect: range.getBoundingClientRect().toJSON() }
        : undefined
    },
    send: () => {
      clearAcceptedAnnotationDraft(scope(), pending, new Map())
      return pending.has(scope())
    },
    reload: () => bridge.load(scope()),
    wrap: () => setWrapped(true),
    change: (value: boolean) => setChanged(value),
    show: setVisible,
    scope: (value: string) => {
      setScope(value)
      setItems([])
    },
    scroll: (value: number) => {
      root.scrollTop = value
    },
    dispose: () => {
      crypto.subtle.digest = digest
      bridge.dispose()
      dispose()
    },
  }
}

window.markers = harness()
