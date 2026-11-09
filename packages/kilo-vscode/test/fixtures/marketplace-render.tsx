import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({ postMessage: () => undefined, getState: () => undefined, setState: () => undefined }),
})

const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { MarketplaceListView } = await import("../../webview-ui/src/components/marketplace/MarketplaceListView")

const base = {
  registry: "kilo",
  description: "A fixture item.",
  tags: [],
  prerequisites: [],
  parameters: [],
  options: [],
}
const items = [
  { ...base, kind: "agent", id: "reviewer", name: "Reviewer", category: "quality" },
  { ...base, kind: "mcp", id: "docs", name: "Docs", category: "docs" },
  { ...base, kind: "skill", id: "planner", name: "Planner" },
]
const records = [
  { version: 1, registry: "kilo", kind: "agent", id: "reviewer", scope: "global", installedAt: 0, status: "ready" },
  {
    version: 1,
    registry: "kilo",
    kind: "mcp",
    id: "docs",
    scope: "project",
    server: "docs",
    installedAt: 0,
    status: "ready",
  },
  { version: 1, registry: "kilo", kind: "skill", id: "lost", scope: "project", installedAt: 0, status: "missing" },
]
const mcp = {
  servers: () => [],
  status: (name: string) => (name === "docs" ? { status: "needs_auth", error: "" } : undefined),
  sync: async () => undefined,
  busy: () => [],
  cancel: () => undefined,
  signIn: async () => undefined,
}
const installed: string[] = []
const removed: string[] = []
const signedIn: string[] = []
const opened: string[] = []
const [search, setSearch] = createSignal("")

const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <MarketplaceListView
          items={items}
          records={records}
          fetching={false}
          installedFetching={false}
          search={search()}
          onSearchChange={setSearch}
          mcp={mcp}
          onInstall={(item) => installed.push(item.id)}
          onRemove={(record) => removed.push(record.id)}
          onRepair={() => undefined}
          onSignIn={(server) => signedIn.push(server)}
          onOpen={(url) => opened.push(url)}
          onRefresh={() => undefined}
        />
      </LanguageProvider>
    </VSCodeProvider>
  ),
  root,
)

const cards = () => [...root.querySelectorAll(".marketplace-card")]
const button = (label: string) =>
  [...root.querySelectorAll("button")].find((node) => node.textContent?.trim() === label) as HTMLButtonElement | undefined

assert.equal(cards().length, 4)
assert.ok(root.textContent?.includes("Reviewer"))
assert.ok(root.textContent?.includes("Docs"))
assert.ok(root.textContent?.includes("lost"))
assert.equal(root.querySelectorAll(".marketplace-badge-installed").length, 3)
assert.ok(button("Install"))
button("Install")!.click()
assert.deepEqual(installed, ["planner"])

const signIn = button("Sign In")
assert.ok(signIn)
signIn.click()
assert.deepEqual(signedIn, ["docs"])

const reviewer = cards().find((card) => card.textContent?.includes("Reviewer"))!
const remove = reviewer.querySelector("button.marketplace-remove-btn") as HTMLButtonElement
remove.click()
assert.deepEqual(removed, ["reviewer"])

setSearch("nothing")
await window.happyDOM.waitUntilComplete()
assert.ok(root.querySelector(".marketplace-empty"))
assert.ok(root.textContent?.includes("No items found"))
const contribute = [...root.querySelectorAll(".marketplace-contribute button")][0] as HTMLButtonElement
contribute.click()
assert.equal(opened.length, 1)
assert.ok(opened[0]!.includes("kilo-marketplace"))

setSearch("planner")
await window.happyDOM.waitUntilComplete()
assert.equal(cards().length, 1)
assert.ok(root.textContent?.includes("Planner"))
assert.equal(root.querySelector(".marketplace-empty"), null)

dispose()
await window.happyDOM.close()
