import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  NodeList: window.NodeList,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  // The dock's diff view imports a custom element at module load.
  customElements: window.customElements,
  acquireVsCodeApi: () => ({ postMessage: () => undefined, getState: () => undefined, setState: () => undefined }),
})
Object.assign(window, { KILO_SETTINGS: {} })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Static imports would evaluate these modules before the happy-dom globals above exist.
const { render } = await import("solid-js/web")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { PermissionDock } = await import("../../webview-ui/src/v2/permission")
const { BrowserPermission } = await import("../../../kilo-plugin/src/browser/permission")

const replies: unknown[] = []
const scope = {
  report: () => undefined,
  directory: "/preview",
  data: {
    session: { permission: { reply: async (input: unknown) => void replies.push(input) }, get: () => undefined },
  },
} as never

/** The dock for one request exactly as the browser plugin asks it. */
function dock(item: Parameters<typeof BrowserPermission.request>[0]) {
  const host = document.createElement("div")
  document.body.append(host)
  const request = { id: "per_1", sessionID: "ses_1", ...BrowserPermission.request(item, false) }
  const dispose = render(
    () => (
      <DialogProvider>
        <VSCodeProvider>
          <LanguageProvider>
            <V2Scope value={scope}>
              <PermissionDock request={request} />
            </V2Scope>
          </LanguageProvider>
        </VSCodeProvider>
      </DialogProvider>
    ),
    host,
  )
  return {
    host,
    buttons: () => [...host.querySelectorAll("button")].map((node) => node.textContent?.trim()),
    dispose() {
      dispose()
      host.remove()
    },
  }
}

const sensitive = dock({ class: "sensitive", origin: "http://127.0.0.2:48251", reason: "password field" })
await wait(20)
assert.deepEqual(sensitive.buttons(), ["Allow once", "Deny"], "a step that saves nothing offers no Allow always")
assert.ok(sensitive.host.textContent?.includes("Reason: password field"), "the dock says why the step asks")
sensitive.dispose()

const grant = dock({ class: "read", origin: "http://127.0.0.2:48251" })
await wait(20)
assert.deepEqual(grant.buttons(), ["Allow once", "Allow always", "Deny"], "a class grant offers Allow always")
assert.ok(!grant.host.textContent?.includes("Reason:"), "a request without a reason shows none")
grant.host.querySelectorAll("button")[1]?.click()
await wait(20)
assert.deepEqual(
  replies,
  [{ sessionID: "ses_1", requestID: "per_1", decision: "always" }],
  "Allow always replies always",
)
grant.dispose()

replies.length = 0
const rejection = dock({ class: "sensitive", origin: "http://127.0.0.2:48251", reason: "password field" })
await wait(20)
const deny = () => rejection.host.querySelectorAll("button")[rejection.buttons().length - 1] as HTMLButtonElement
deny().click()
await wait(20)
assert.deepEqual(rejection.buttons(), ["Reject", "Cancel"], "Deny opens the optional feedback flow")
assert.equal(replies.length, 0, "opening the feedback flow must not answer the request")
const field = rejection.host.querySelector<HTMLTextAreaElement>('[data-slot="permission-feedback-input"]')
assert.ok(field, "Deny reveals a feedback field")
field.value = "  Use spaces, not tabs  "
field.dispatchEvent(new window.Event("input", { bubbles: true }))
field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
await wait(20)
assert.deepEqual(
  replies,
  [{ sessionID: "ses_1", requestID: "per_1", decision: "reject", message: "Use spaces, not tabs" }],
  "Enter rejects with the trimmed reason",
)
rejection.dispose()

await window.happyDOM.close()
