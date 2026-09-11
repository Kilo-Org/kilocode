import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { JSX } from "solid-js"

export async function harness<T extends { type: string }>() {
  const window = new Window({ url: "http://localhost" })
  const messages: T[] = []
  Object.defineProperty(window, "origin", { value: window.location.origin })
  for (const name of [
    "document",
    "navigator",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLHeadElement",
    "HTMLDivElement",
    "HTMLPreElement",
    "HTMLAnchorElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "SVGElement",
    "ShadowRoot",
    "customElements",
    "MutationObserver",
    "ResizeObserver",
    "CustomEvent",
    "Event",
    "MouseEvent",
    "MessageEvent",
    "PointerEvent",
  ] as const)
    Object.assign(globalThis, { [name]: window[name] })
  Object.assign(globalThis, {
    window,
    CSSStyleSheet: class {
      replaceSync() {}
      replace() {
        return Promise.resolve(this)
      }
    },
    IntersectionObserver: class extends window.IntersectionObserver {
      constructor(private callback: IntersectionObserverCallback) {
        super(() => undefined)
      }
      observe(target: Element) {
        this.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this)
      }
    },
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    acquireVsCodeApi: () => ({
      postMessage: (message: T) => {
        if (message.type.startsWith("agentManager.")) messages.push(message)
      },
      getState: () => undefined,
      setState: () => undefined,
    }),
  })
  // Providers must load after the browser globals, not through static imports.
  const { render } = await import("solid-js/web")
  const { MarkedProvider } = await import("@kilocode/kilo-ui/context/marked")
  const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
  const { LanguageProvider } = await import("../../webview-ui/src/context/language")
  const { post } = await import("../../webview-ui/src/utils/webview-message")
  const root = document.createElement("div")
  document.body.append(root)
  const node = <E extends Element = HTMLElement>(selector: string, scope: ParentNode = root): E => {
    const result = scope.querySelector<E>(selector)
    assert.ok(result, `Expected DOM node ${selector}`)
    return result
  }
  const input = (scope: ParentNode) => node<HTMLTextAreaElement>("textarea", scope)
  return {
    window,
    root,
    messages,
    node,
    input,
    wait: () => window.happyDOM.waitUntilComplete(),
    button: (action: string, scope: ParentNode = root) =>
      node<HTMLButtonElement>(`button[data-action="${action}"]`, scope),
    type: (scope: ParentNode, body: string) => {
      input(scope).value = body
      input(scope).dispatchEvent(new window.Event("input", { bubbles: true }))
    },
    last: () => {
      const result = messages.at(-1)
      assert.ok(result)
      return result
    },
    respond: (request: T, value: Record<string, unknown> = {}) =>
      post({ ...request, type: `${request.type}Result`, success: true, ...value }),
    mount: (view: () => JSX.Element) =>
      render(
        () => (
          <VSCodeProvider>
            <LanguageProvider>
              <MarkedProvider>{view()}</MarkedProvider>
            </LanguageProvider>
          </VSCodeProvider>
        ),
        root,
      ),
  }
}
