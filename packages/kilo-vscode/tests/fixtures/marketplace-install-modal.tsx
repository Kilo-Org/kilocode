import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

const window = new Window({ url: "https://kilo.test" })
const errors: unknown[] = []
window.addEventListener("error", (event) => errors.push(event.error))
Object.defineProperty(window, "origin", { value: window.location.origin })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLButtonElement: window.HTMLButtonElement,
  CustomEvent: window.CustomEvent,
  MouseEvent: window.MouseEvent,
  Event: window.Event,
  HTMLAnchorElement: window.HTMLAnchorElement,
  Element: window.Element,
  SVGElement: window.SVGElement,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  MessageEvent: window.MessageEvent,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})

const { render } = await import("solid-js/web")
const { Show, createSignal, onMount } = await import("solid-js")
const { DialogProvider, useDialog } = await import("@kilocode/kilo-ui/context/dialog")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { ServerProvider } = await import("../../webview-ui/src/context/server")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { MarketplaceSessionProvider } = await import("../../webview-ui/src/context/marketplace-session")
const { InstallModal } = await import("../../webview-ui/src/components/marketplace/InstallModal")
const { post } = await import("../../webview-ui/src/utils/webview-message")
const messages: WebviewMessage[] = []
Object.defineProperty(globalThis, "acquireVsCodeApi", {
  value: () => ({
    postMessage: (message: WebviewMessage) => messages.push(message),
    getState: () => undefined,
    setState: () => {},
  }),
})
const [visible, show] = createSignal(false)
const Modal = () => {
  const dialog = useDialog()
  onMount(() =>
    dialog.show(() => (
      <InstallModal
        item={{
          type: "plugin",
          id: "test-plugin",
          name: "Test plugin",
          description: "Test",
          category: "utilities",
          content: "test-plugin",
        }}
        onClose={() => show(false)}
        onInstallResult={() => {}}
      />
    )),
  )
  return null
}
const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <VSCodeProvider>
      <ServerProvider>
        <LanguageProvider>
          <MarketplaceSessionProvider>
            <DialogProvider>
              <Show when={visible()}>
                <Modal />
              </Show>
            </DialogProvider>
          </MarketplaceSessionProvider>
        </LanguageProvider>
      </ServerProvider>
    </VSCodeProvider>
  ),
  root,
)

const mount = async (directory: string) => {
  show(false)
  post({ type: "workspaceDirectoryChanged", directory })
  show(true)
  await window.happyDOM.waitUntilComplete()
}
const click = (label: string) => {
  const button = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === label)
  assert.ok(button, `Missing button: ${label}`)
  assert.equal(button.disabled, false)
  button.click()
}
const complete = (result: Partial<Extract<ExtensionMessage, { type: "marketplaceInstallResult" }>>) => {
  click("Install")
  assert.equal(messages.at(-1)?.type, "installMarketplaceItem")
  post({ type: "marketplaceInstallResult", slug: "test-plugin", success: true, ...result })
  assert.ok(document.querySelector(".install-modal-result"), document.body.textContent ?? "")
}

try {
  await Promise.resolve()
  await mount("/workspace")
  assert.equal(document.querySelector(".install-modal-destination code")?.textContent, ".kilo/")
  const global = document.querySelector<HTMLInputElement>('input[value="global"]')
  assert.ok(global)
  global.click()
  assert.equal(document.querySelector(".install-modal-destination code")?.textContent, "~/.config/kilo/")
  complete({ filePath: "/custom/config/tui.json" })
  assert.match(document.querySelector(".install-modal-result-path")?.textContent ?? "", /\/custom\/config\/tui\.json$/)
  const request = messages.findLast((message) => message.type === "installMarketplaceItem")
  assert.equal(request?.mpInstallOptions?.target, "global")

  await mount("/workspace")
  complete({ filePath: "/workspace/.kilo/tui.jsonc" })
  assert.match(
    document.querySelector(".install-modal-result-path")?.textContent ?? "",
    /\/workspace\/\.kilo\/tui\.jsonc$/,
  )

  await mount("/workspace")
  complete({
    filePath: "/workspace/.kilo/opencode.jsonc",
    filePaths: ["/workspace/.kilo/opencode.jsonc", "/workspace/.kilo/tui.jsonc"],
  })
  assert.deepEqual(
    Array.from(document.querySelectorAll(".install-modal-result-path"), (node) => node.textContent),
    ["Installed to /workspace/.kilo/opencode.jsonc", "Installed to /workspace/.kilo/tui.jsonc"],
  )

  await mount("")
  assert.equal(document.querySelector(".install-modal-destination code")?.textContent, "~/.config/kilo/")
  assert.equal(document.querySelector('input[value="project"]'), null)
  complete({})
  assert.equal(document.querySelector(".install-modal-result-path")?.textContent, "Installed to ~/.config/kilo/")
  assert.deepEqual(errors, [])
} finally {
  dispose()
  await window.happyDOM.close()
}
