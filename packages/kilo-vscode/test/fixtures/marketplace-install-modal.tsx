import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLDivElement: window.HTMLDivElement,
  HTMLSpanElement: window.HTMLSpanElement,
  HTMLParagraphElement: window.HTMLParagraphElement,
  HTMLUListElement: window.HTMLUListElement,
  HTMLLIElement: window.HTMLLIElement,
  HTMLPreElement: window.HTMLPreElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  CustomEvent: window.CustomEvent,
  FocusEvent: window.FocusEvent,
  PointerEvent: window.PointerEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({ postMessage: () => undefined, getState: () => undefined, setState: () => undefined }),
})

const { render } = await import("solid-js/web")
const { onMount } = await import("solid-js")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { DialogProvider, useDialog } = await import("@kilocode/kilo-ui/context/dialog")
const { InstallModal } = await import("../../webview-ui/src/components/marketplace/InstallModal")

const item = {
  registry: "kilo",
  kind: "mcp",
  id: "docs",
  name: "Docs",
  description: "Search the documentation.",
  tags: [],
  prerequisites: ["Node.js"],
  parameters: [],
  options: [
    {
      name: "remote",
      description: "Hosted endpoint",
      prerequisites: [],
      parameters: [
        { key: "url", name: "Endpoint", optional: true },
        { key: "token", name: "Access token", optional: false, secret: true },
      ],
    },
  ],
}

let serverStatus = "needs_auth"
const calls = {
  preview: [] as unknown[],
  install: [] as unknown[],
  signIn: [] as string[],
  open: [] as string[],
}
const mcp = {
  servers: () => [],
  status: () => ({ status: serverStatus, error: "" }),
  canSignIn: () => false,
  sync: async () => undefined,
  busy: () => [],
  cancel: () => undefined,
  signIn: async (name: string) => {
    calls.signIn.push(name)
    serverStatus = "connected"
  },
}
const record = {
  version: 1,
  registry: "kilo",
  kind: "mcp",
  id: "docs",
  scope: "project",
  server: "docs",
  installedAt: 0,
  status: "ready",
  warnings: ["Restart the server to load the new entry."],
}

const root = document.createElement("div")
document.body.append(root)
let closed = 0
const Harness = () => {
  const dialog = useDialog()
  onMount(() =>
    dialog.show(() => (
      <InstallModal
        item={item}
        workspace={true}
        mcp={mcp}
        onClose={() => {
          closed++
          dialog.close()
        }}
        onPreview={async (_, input) => {
          calls.preview.push(input)
          return {
            config: "/tmp/project/.kilo/kilo.json",
            server: '{"docs":{"url":"https://example.com/mcp"}}',
            parameters: ["Access token"],
            secrets: ["token"],
          }
        }}
        onInstall={async (_, input) => {
          calls.install.push(input)
          return record
        }}
        onOpen={(url) => calls.open.push(url)}
      />
    )),
  )
  return null
}
const dispose = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <DialogProvider>
          <Harness />
        </DialogProvider>
      </LanguageProvider>
    </VSCodeProvider>
  ),
  root,
)
await new Promise((resolve) => setTimeout(resolve, 0))

const text = () => document.body.textContent ?? ""
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined

assert.ok(text().includes("Node.js"))
assert.ok(text().includes("Where should this be available?"))
assert.equal(document.body.querySelectorAll('input[type="radio"]').length, 2)
assert.ok(button("Review"))
assert.equal(button("Review")!.disabled, true)

const token = document.body.querySelector('input[type="password"]') as HTMLInputElement
assert.ok(token, "the secret parameter is masked")
token.value = "secret-value"
token.dispatchEvent(new window.Event("input", { bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(button("Review")!.disabled, false)

button("Review")!.click()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.deepEqual(calls.preview, [{ scope: "project", option: "remote", params: { token: "secret-value" } }])
assert.ok(text().includes("/tmp/project/.kilo/kilo.json"))
assert.ok(text().includes("plaintext"))
assert.ok(text().includes("token"))

button("Install")!.click()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.deepEqual(calls.install, [{ scope: "project", option: "remote", params: { token: "secret-value" } }])
assert.ok(text().includes("Restart the server to load the new entry."))

button("Sign In")!.click()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.deepEqual(calls.signIn, ["docs"])
assert.ok(text().includes("Signed in to docs."))

button("Done")!.click()
assert.equal(closed, 1)

dispose()

// Repair: a record installed with a non-default method opens the dialog on that method, not the item's first option.
const repairCalls: unknown[] = []
const repairItem = {
  ...item,
  id: "repair",
  name: "Repair Docs",
  prerequisites: [],
  parameters: [],
  options: [
    { name: "remote", description: "Hosted endpoint", prerequisites: [], parameters: [] },
    { name: "local", description: "Runs on this machine", prerequisites: [], parameters: [] },
  ],
}
const repairRoot = document.createElement("div")
document.body.append(repairRoot)
const RepairHarness = () => {
  const dialog = useDialog()
  onMount(() =>
    dialog.show(() => (
      <InstallModal
        item={repairItem}
        workspace={true}
        defaultOption="local"
        mcp={mcp}
        onClose={() => dialog.close()}
        onPreview={async (_, input) => {
          repairCalls.push(input)
          return { config: "/tmp/project/.kilo/kilo.json", server: "{}", parameters: [], secrets: [] }
        }}
        onInstall={async () => record}
        onOpen={() => undefined}
      />
    )),
  )
  return null
}
const disposeRepair = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <DialogProvider>
          <RepairHarness />
        </DialogProvider>
      </LanguageProvider>
    </VSCodeProvider>
  ),
  repairRoot,
)
await new Promise((resolve) => setTimeout(resolve, 0))
assert.ok(text().includes("local"), "the recorded method is preselected")
button("Review")!.click()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal((repairCalls[0] as { option?: string }).option, "local")

disposeRepair()
await window.happyDOM.close()
