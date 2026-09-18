import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { MigrationSessionInfo, WebviewMessage } from "../../webview-ui/src/types/messages"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: window.location.origin })
const style = window.getComputedStyle.bind(window)
const sent: WebviewMessage[] = []
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLInputElement: window.HTMLInputElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  getComputedStyle: (node: Element) => {
    const value = style(node)
    Object.defineProperty(value, "animationName", { configurable: true, value: "none" })
    return value
  },
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  acquireVsCodeApi: () => ({
    postMessage: (message: WebviewMessage) => sent.push(message),
    getState: () => undefined,
    setState: () => {},
  }),
})

const { Show, createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { ConfigProvider } = await import("../../webview-ui/src/context/config")
const { default: AboutKiloCodeTab } = await import("../../webview-ui/src/components/settings/AboutKiloCodeTab")
const { default: MigrationWizard } = await import("../../webview-ui/src/components/migration/MigrationWizard")

const root = document.createElement("div")
document.body.append(root)
const [open, setOpen] = createSignal(false)
const closed: string[] = []
const close = (reason: string) => {
  closed.push(reason)
  setOpen(false)
}
const dispose = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider languageOverride={() => "en"}>
        <ConfigProvider>
          <DialogProvider>
            <Show
              when={open()}
              fallback={
                <AboutKiloCodeTab
                  port={null}
                  connectionState="disconnected"
                  onMigrationClick={(source) => {
                    assert.equal(source, "roo")
                    setOpen(true)
                  }}
                />
              }
            >
              <MigrationWizard onBack={() => close("back")} onComplete={() => close("complete")} />
            </Show>
          </DialogProvider>
        </ConfigProvider>
      </LanguageProvider>
    </VSCodeProvider>
  ),
  root,
)

const button = (text: string) => {
  const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  )
  assert(node, `Missing button: ${text}`)
  return node
}
const query = (selector: string) => {
  const node = document.querySelector(selector)
  assert(node, `Missing element: ${selector}`)
  return node
}
const { post: emit } = await import("../../webview-ui/src/utils/webview-message")
const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}
const requests = () => sent.filter((item) => item.type === "requestMigrationData")
const starts = () => sent.filter((item) => item.type === "startMigration")
const sessions: MigrationSessionInfo[] = [
  { id: "roo-a", title: "First Roo session", directory: "/workspace/test", time: 1 },
  { id: "roo-b", title: "Skipped Roo session", directory: "/workspace/test", time: 2 },
  { id: "roo-c", title: "Failed Roo session", directory: "/workspace/test", time: 3 },
]
const catalog = {
  sessions,
  providers: [{ profileName: "Unsupported provider", supported: true, hasApiKey: true }],
  mcpServers: [{ name: "Unsupported server", type: "stdio" }],
  customModes: [{ name: "Unsupported mode", slug: "unsupported" }],
  defaultModel: { provider: "unsupported", model: "unsupported" },
  settings: { language: "de", autoApprovalEnabled: true, autocomplete: { enableAutoTrigger: true } },
}

assert.equal(requests().length, 0)
assert.doesNotMatch(root.textContent ?? "", /Legacy Migration|Migrate from Legacy Version/)
button("Import Sessions from Roo Code").click()
const first = requests().at(-1)!
assert.equal(first.source, "roo")
assert(first.operationId)
assert.equal(button("Import Sessions").disabled, true)
assert.match(root.textContent ?? "", /No Roo Code sessions found/)
button("Back").click()
assert.deepEqual(closed, ["back"])
assert.equal(starts().length, 0)
button("Import Sessions from Roo Code").click()
const request = requests().at(-1)!
assert.notEqual(request.operationId, first.operationId)
const scope = { source: "roo", operationId: request.operationId }
for (const stale of [
  { ...scope, source: "legacy" },
  { ...scope, operationId: first.operationId },
]) {
  emit({ ...stale, type: "migrationData", data: catalog })
}
assert.equal(button("Import Sessions").disabled, true)
emit({ ...scope, type: "migrationData", data: catalog })
assert.equal(root.querySelectorAll('input[type="checkbox"]').length, 1)
assert.doesNotMatch(
  root.textContent ?? "",
  /Migrate Your Settings|Provider API Keys|MCP Servers|Custom Modes|UI Language/,
)
assert.match(root.textContent ?? "", /3 sessions detected/)
const checkbox = query('input[aria-label="Chat Sessions & History"]') as HTMLInputElement
checkbox.click()
assert.equal(button("Import Sessions").disabled, true)
checkbox.click()
button("Import Sessions").click()
const started = starts().at(-1)!
assert.equal(started.source, "roo")
assert.equal(started.operationId, request.operationId)
assert.deepEqual(started.selections, {
  sessions: sessions.map((session) => ({ id: session.id })),
})

const update = (index: number, phase: string, error?: string) =>
  emit({
    ...scope,
    type: "migrationSessionProgress",
    session: sessions.at(index),
    index: index + 1,
    total: 3,
    phase,
    error,
  })
update(0, "preparing")
assert.match(query(".migration-session-progress__header").textContent ?? "", /Migrating 1 of 3/)
update(0, "storing")
assert.equal(root.querySelectorAll(".migration-session-progress__dot--active").length, 1)
for (const stale of [
  { ...scope, source: "legacy" },
  { ...scope, operationId: first.operationId },
]) {
  emit({ ...stale, type: "migrationProgress", item: "roo-a", status: "error", message: "Stale error" })
  emit({
    ...stale,
    type: "migrationSessionProgress",
    session: sessions.at(0),
    index: 1,
    total: 3,
    phase: "error",
    error: "Stale error",
  })
  emit({ ...stale, type: "migrationComplete", results: [{ item: "roo-a", category: "session", status: "error" }] })
}
assert.equal(button("Import Sessions").disabled, true)
assert.doesNotMatch(root.textContent ?? "", /Stale error/)
button("Back").click()
await settle()
assert.match(query('[data-component="dialog"]').textContent ?? "", /Migration in Progress/)
button("Stay").click()
await settle()
assert.deepEqual(closed, ["back"])
assert.equal(button("Import Sessions").disabled, true)

update(0, "done")
update(1, "skipped")
update(2, "error", "Could not import test session")
update(2, "summary")
emit({
  ...scope,
  type: "migrationComplete",
  results: [
    { item: "roo-a", category: "session", status: "success" },
    { item: "roo-b", category: "session", status: "warning" },
    { item: "roo-c", category: "session", status: "error" },
  ],
})
assert.match(query(".migration-session-summary__list--success").textContent ?? "", /First Roo session/)
assert.match(query(".migration-session-summary__list--skipped").textContent ?? "", /Skipped Roo session/)
assert.match(query(".migration-session-summary__list--errored").textContent ?? "", /Could not import test session/)
button("Continue").click()
assert.match(query(".migration-wizard__summary").textContent ?? "", /1 of 3 items migrated successfully/)
;(query(".migration-session-summary__pick input") as HTMLInputElement).click()
button("Force Re-import").click()
await settle()
assert.match(query('[data-component="dialog"]').textContent ?? "", /overwrite them and delete any new messages/)
button("Cancel").click()
await settle()
assert.equal(starts().length, 1)
button("Force Re-import").click()
await settle()
button("Proceed").click()
await settle()
const forced = starts().at(-1)!
assert.equal(forced.operationId, request.operationId)
assert.equal(forced.source, "roo")
assert.deepEqual(forced.selections.sessions, [{ id: "roo-b", force: true }])
assert.deepEqual({ ...forced.selections, sessions: started.selections.sessions }, started.selections)
emit({ ...scope, type: "migrationProgress", item: "roo-b", status: "success" })
update(1, "done")
update(1, "summary")
emit({ ...scope, type: "migrationComplete", results: [{ item: "roo-b", category: "session", status: "success" }] })
assert.match(query(".migration-session-summary__list--success").textContent ?? "", /First Roo session/)
assert.match(query(".migration-session-summary__list--success").textContent ?? "", /Skipped Roo session/)
assert.equal(root.querySelector(".migration-session-summary__list--skipped"), null)
assert(root.querySelector(".migration-wizard__status-icon--success"))
button("Done").click()
assert.deepEqual(closed, ["back", "complete"])
assert.equal(sent.at(-1)?.type, "loadSessions")

button("Import Sessions from Roo Code").click()
const latest = requests().at(-1)!
emit({ source: "roo", operationId: latest.operationId, type: "migrationData", data: { sessions } })
button("Import Sessions").click()
button("Back").click()
await settle()
button("Proceed").click()
await settle()
assert.deepEqual(closed, ["back", "complete", "back"])
assert.equal(root.querySelector(".migration-wizard"), null)
assert.equal(
  sent.some((item) => /Legacy/.test(item.type)),
  false,
)
dispose()
await window.happyDOM.close()
