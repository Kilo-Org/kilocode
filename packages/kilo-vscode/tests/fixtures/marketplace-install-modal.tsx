import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"
import type { MarketplaceItem, McpMarketplaceItem } from "../../webview-ui/src/types/marketplace"

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
const { RemoveDialog } = await import("../../webview-ui/src/components/marketplace/RemoveDialog")
const { ItemCard } = await import("../../webview-ui/src/components/marketplace/ItemCard")
const { post } = await import("../../webview-ui/src/utils/webview-message")
const messages: WebviewMessage[] = []
Object.defineProperty(globalThis, "acquireVsCodeApi", {
  value: () => ({
    postMessage: (message: WebviewMessage) => messages.push(structuredClone(message)),
    getState: () => undefined,
    setState: () => {},
  }),
})
const plugin: MarketplaceItem = {
  type: "plugin",
  id: "test-plugin",
  name: "Test plugin",
  description: "Test",
  category: "utilities",
  content: "test-plugin",
}
const mcp = {
  type: "mcp",
  id: "test-mcp",
  name: "Test MCP",
  description: "Test",
  category: "utilities",
  url: "https://example.test/mcp",
  content: "{}",
  skills: [
    { id: "query-workflow", content: "https://example.test/query-workflow.tar.gz" },
    { id: "data-checks", content: "data:application/gzip;base64,ZmFrZQ==" },
  ],
} satisfies McpMarketplaceItem
const [item, select] = createSignal<MarketplaceItem>(plugin)
const [removing, remove] = createSignal(false)
const [visible, show] = createSignal(false)
const Modal = () => {
  const dialog = useDialog()
  onMount(() =>
    dialog.show(() =>
      removing() ? (
        <RemoveDialog item={item()} scope="project" onClose={() => show(false)} onConfirm={() => {}} />
      ) : (
        <InstallModal item={item()} onClose={() => show(false)} onInstallResult={() => {}} />
      ),
    ),
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
              <ItemCard item={item()} metadata={{ project: {}, global: {} }} onInstall={() => {}} onRemove={() => {}} />
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

const mount = async (directory: string, entry: MarketplaceItem = plugin, removal = false) => {
  show(false)
  select(entry)
  remove(removal)
  post({ type: "workspaceDirectoryChanged", directory })
  show(true)
  await window.happyDOM.waitUntilComplete()
}
const click = (label: string) => {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
    (button) => button.textContent?.trim() === label,
  )
  assert.ok(button, `Missing button: ${label}`)
  assert.equal(button.disabled, false)
  button.click()
}
const complete = (result: Partial<Extract<ExtensionMessage, { type: "marketplaceInstallResult" }>>) => {
  click("Install")
  assert.equal(messages.at(-1)?.type, "installMarketplaceItem")
  post({ type: "marketplaceInstallResult", slug: item().id, success: true, ...result })
  assert.ok(document.querySelector(".install-modal-result"), document.body.textContent ?? "")
}

try {
  await Promise.resolve()
  await mount("/workspace")
  assert.equal(document.querySelector('[data-slot="marketplace-companion-skills"]'), null)
  assert.equal(document.querySelector(".marketplace-badge-skills"), null)
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

  await mount("/workspace", mcp)
  const section = document.querySelector('[data-slot="marketplace-companion-skills"]')
  assert.ok(section)
  assert.equal(section.querySelector(".install-modal-label")?.textContent, "Included skills")
  assert.deepEqual(
    Array.from(section.querySelectorAll(".install-modal-destination span"), (node) => node.textContent),
    ["query-workflow", "data-checks"],
  )
  assert.deepEqual(
    Array.from(section.querySelectorAll("code"), (node) => node.textContent),
    [".kilo/skills/query-workflow/", ".kilo/skills/data-checks/"],
  )
  assert.equal(document.querySelector(".marketplace-badge-skills")?.textContent, "Includes skills")
  for (const skill of mcp.skills) assert.equal(document.body.innerHTML.includes(skill.content), false)
  document.querySelector<HTMLInputElement>('input[value="global"]')!.click()
  assert.equal(document.querySelector(".install-modal-destination code")?.textContent, "~/.config/kilo/kilo.json")
  assert.deepEqual(
    Array.from(section.querySelectorAll("code"), (node) => node.textContent),
    ["~/.kilo/skills/query-workflow/", "~/.kilo/skills/data-checks/"],
  )
  complete({
    filePaths: [
      "/home/test/.config/kilo/kilo.json",
      "/home/test/.kilo/skills/query-workflow/SKILL.md",
      "/home/test/.kilo/skills/data-checks/SKILL.md",
    ],
  })
  const bundled = messages.findLast((message) => message.type === "installMarketplaceItem")
  assert.deepEqual(bundled?.mpItem, mcp)
  assert.equal(bundled?.mpInstallOptions?.target, "global")
  assert.deepEqual(
    Array.from(document.querySelectorAll(".install-modal-result-path"), (node) => node.textContent),
    [
      "Installed to /home/test/.config/kilo/kilo.json",
      "Installed to /home/test/.kilo/skills/query-workflow/SKILL.md",
      "Installed to /home/test/.kilo/skills/data-checks/SKILL.md",
    ],
  )

  await mount("", mcp)
  assert.equal(document.querySelector('input[value="project"]'), null)
  assert.deepEqual(
    Array.from(
      document.querySelectorAll('[data-slot="marketplace-companion-skills"] code'),
      (node) => node.textContent,
    ),
    ["~/.kilo/skills/query-workflow/", "~/.kilo/skills/data-checks/"],
  )

  for (const skills of [undefined, []]) {
    const plain = { ...mcp, skills }
    await mount("/workspace", plain)
    assert.equal(document.querySelector('[data-slot="marketplace-companion-skills"]'), null)
    assert.equal(document.querySelector(".marketplace-badge-skills"), null)
    assert.equal(document.querySelector(".install-modal-destination code")?.textContent, ".kilo/kilo.json")
    complete({})
    assert.deepEqual(messages.findLast((message) => message.type === "installMarketplaceItem")?.mpItem, plain)
  }

  for (const skills of [undefined, [], mcp.skills]) {
    await mount("/workspace", { ...mcp, skills }, true)
    assert.equal(
      document.querySelector('[data-slot="marketplace-companion-removal"]')?.textContent,
      "This also removes companion skills owned by this installation. Independently installed skills are kept.",
    )
    assert.equal(document.querySelector('[role="dialog"]')?.textContent?.includes("query-workflow"), false)
  }
  await mount("/workspace", plugin, true)
  assert.equal(document.querySelector('[data-slot="marketplace-companion-removal"]'), null)
  assert.deepEqual(errors, [])
} finally {
  dispose()
  await window.happyDOM.close()
}
