import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
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
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const { render } = await import("solid-js/web")
const { I18nProvider } = await import("@kilocode/kilo-ui/context")
const { MarkedProvider } = await import("@kilocode/kilo-ui/context/marked")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { PRComments } = await import("../../webview-ui/agent-manager/pr/PRComments")

const root = document.createElement("div")
const colors = document.createElement("style")
colors.textContent = ":root { --syntax-keyword: rgb(72, 160, 199); --syntax-string: rgb(206, 145, 120); }"
document.head.append(colors)
document.body.append(root)

const dispose = render(
  () => (
    <VSCodeProvider>
      <I18nProvider
        value={
          {
            locale: () => "en",
            t: (key: string) => key,
            plural: (key: string) => key,
          } as never
        }
      >
        <MarkedProvider>
          <PRComments
            worktreeId="wt-test"
            comments={{
              total: 1,
              unresolved: 1,
              comments: [
                {
                  id: "PRRC_test",
                  threadId: "PRRT_test",
                  author: "kilo-code-bot",
                  body: "comment body survives Pierre rendering",
                  file: "packages/kilo-ui/src/components/file.tsx",
                  line: 14,
                  resolved: false,
                  diffHunk:
                    '@@ -1 +1,14 @@\n+import { File as BaseFile, type FileProps } from "@opencode-ai/ui/file"\n+import type { JSX } from "solid-js"\n+import { createDefaultOptions } from "../pierre"\n+\n export * from "@opencode-ai/ui/file"\n+\n+export function File<T>(props: FileProps<T>) {\n+  const View = BaseFile as unknown as (props: FileProps<T>) => JSX.Element\n+  if (props.mode === "text") return <View {...props} />\n+\n+  // Keep inline file diffs on the same Pierre defaults as the dedicated viewer.\n+  const options = { ...createDefaultOptions<T>(props.diffStyle), ...props } as FileProps<T>\n',
                },
              ],
            }}
          />
        </MarkedProvider>
      </I18nProvider>
    </VSCodeProvider>
  ),
  root,
)

await window.happyDOM.waitUntilComplete()
const host = root.querySelector("diffs-container")
const shadow = host?.shadowRoot
const keyword = shadow?.querySelector('[data-content] span[style*="--syntax-keyword"]')
const string = shadow?.querySelector('[data-content] span[style*="--syntax-string"]')
assert.match(root.textContent ?? "", /comment body survives Pierre rendering/)
assert.equal(root.querySelectorAll('[data-component="diff"]').length, 1)
assert.ok(keyword)
assert.ok(string)
assert.match(keyword!.getAttribute("style") ?? "", /--syntax-keyword/)
assert.match(string!.getAttribute("style") ?? "", /--syntax-string/)
assert.notEqual(keyword!.getAttribute("style"), string!.getAttribute("style"))
dispose()
