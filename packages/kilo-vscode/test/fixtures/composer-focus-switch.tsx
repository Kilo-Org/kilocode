// The Agent Manager mounts one composer per worktree and session. v1 focused the prompt from the draft-change effect
// of its single, long-lived composer; the v2 composer is remounted instead, so the mount has to ask for focus the same
// way, unless the context keeps a terminal (or another text control) in control.
import assert from "node:assert/strict"
import type { JSX } from "solid-js"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
// The webview message guard compares the event origin with the window origin, and happy-dom's Window does not
// expose `origin` on its own.
Object.defineProperty(window, "origin", { configurable: true, value: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  FileReader: window.FileReader,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})
// The composer reads theme variables through getComputedStyle while its module loads.
Object.assign(globalThis, { getComputedStyle: window.getComputedStyle.bind(window) })

Object.assign(globalThis, {
  acquireVsCodeApi: () => ({
    postMessage: () => undefined,
    getState: () => undefined,
    setState: () => undefined,
  }),
})

const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { SpeechToTextStatusProvider } = await import("../../webview-ui/src/components/speech-to-text/status")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { createAutoApprove } = await import("../../webview-ui/src/v2/auto-approve")
const { createSandbox } = await import("../../webview-ui/src/v2/sandbox")
const { PromptInput } = await import("../../webview-ui/src/v2/prompt")
const { bindCloudFocus, cloudDraftMayFocus, focusCloudChat } = await import(
  "../../webview-ui/agent-manager/cloud/focus"
)
const { createTabFocus, createTabMenuAction } = await import("../../webview-ui/src/utils/tab-navigation")
const { createCloudShells, cloudShellAction } = await import("../../webview-ui/agent-manager/cloud/shell-tabs")

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const sandboxStatus = { directory: "/workspace", enabled: false, available: true, network: false, version: 1 }
const sandbox = {
  support: async () => ({ enabled: false, available: true, network: false }),
  status: async () => sandboxStatus,
  toggle: async () => sandboxStatus,
  events: { on: () => () => undefined },
}
const workspace = (directory: string) =>
  ({
    connection: { status: () => "connected" },
    report: () => undefined,
    directory,
    bindings: () => ({}),
    selection: () => false,
    api: { generate: { text: async () => ({ text: "" }) }, rpc: () => sandbox },
    kiloModels: () => ({ entries: new Map() }),
    data: {
      listen: () => () => undefined,
      on: () => () => undefined,
      session: { get: () => undefined, message: { list: () => [] } },
      location: { model: { list: () => [] }, provider: { list: () => [] } },
    },
  }) as never

function Composer(props: {
  session: string
  focusOnDraftChange?: () => boolean
  onFocusChange?: (focused: boolean) => void
}) {
  const autoApprove = createAutoApprove()
  const confinement = createSandbox({ session: () => props.session })
  return (
    <PromptInput
      session={props.session}
      draftKey={props.session}
      running={false}
      disabled={false}
      onSend={async () => true}
      onStop={() => undefined}
      focusOnDraftChange={props.focusOnDraftChange}
      onFocusChange={props.onFocusChange}
      autoApprove={{ enabled: autoApprove.enabled(), onToggle: autoApprove.toggle }}
      sandbox={{
        visible: confinement.visible,
        ready: confinement.ready,
        enabled: confinement.enabled,
        available: confinement.available,
        reason: confinement.reason,
        network: confinement.network,
        disabled: confinement.disabled,
        onToggle: confinement.toggle,
      }}
    />
  )
}

// What the Agent Manager does per worktree: dispose the whole scope and mount the next worktree's providers.
const isolate = (child: () => JSX.Element, directory = "/workspace") => {
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () => (
      <VSCodeProvider>
        <LanguageProvider>
          <V2Scope value={workspace(directory)}>
            <SpeechToTextStatusProvider>{child()}</SpeechToTextStatusProvider>
          </V2Scope>
        </LanguageProvider>
      </VSCodeProvider>
    ),
    root,
  )
  return { root, dispose }
}

const prompt = (root: Element) => root.querySelector<HTMLTextAreaElement>("textarea.prompt-input")!
const release = () => (document.activeElement as HTMLElement | null)?.blur()

// A worktree switch disposes one composer and mounts the next. The new composer takes focus, as v1's draft change did.
const first = isolate(() => <Composer session="ses_a" focusOnDraftChange={() => true} />)
first.dispose()
release()
const second = isolate(() => <Composer session="ses_b" focusOnDraftChange={() => true} />)
await wait(0)
assert.equal(document.activeElement, prompt(second.root), "the composer of the switched worktree takes focus")
second.dispose()
release()

// The destination context remembers a visible terminal, so the switch keeps the terminal in control.
const terminal = isolate(() => <Composer session="ses_c" focusOnDraftChange={() => false} />)
await wait(80)
assert.notEqual(document.activeElement, prompt(terminal.root), "a visible terminal keeps focus over the composer")
terminal.dispose()
release()

// Another text control owns focus, for example a worktree rename input; mounting must not steal it.
const input = document.createElement("input")
document.body.append(input)
input.focus()
const guarded = isolate(() => <Composer session="ses_d" focusOnDraftChange={() => true} />)
await wait(80)
assert.equal(document.activeElement, input, "a text control keeps focus over the composer")
input.remove()
guarded.dispose()
release()

// The composer reports focus and blur, so the Agent Manager remembers that this context returns to the prompt.
const reports: boolean[] = []
const memory = isolate(() => (
  <Composer session="ses_e" focusOnDraftChange={() => false} onFocusChange={(focused) => reports.push(focused)} />
))
const field = prompt(memory.root)
field.focus()
field.blur()
assert.deepEqual(reports, [true, false], "the composer reports the focus the Agent Manager remembers")
memory.dispose()
release()

// The sidebar shares the composer and focuses on a draft change too, as v1 did: switching its session tabs leaves the
// caret in the new draft.
const sidebar = isolate(() => <Composer session="ses_f" focusOnDraftChange={() => true} />)
await wait(0)
assert.equal(document.activeElement, prompt(sidebar.root), "the sidebar composer of a switched tab takes focus")
sidebar.dispose()
release()

// A surface that moves focus on purpose right after the mount keeps it: the sidebar tab strip focuses the new tab
// under arrow keys, and the immediate-only request must not take it back on a later frame or timer.
const ahead = isolate(() => <Composer session="ses_g" focusOnDraftChange={() => true} />)
const tab = document.createElement("div")
tab.setAttribute("role", "tab")
tab.tabIndex = 0
document.body.append(tab)
tab.focus()
await wait(80)
assert.equal(document.activeElement, tab, "a tab focused after the mount keeps focus")
tab.remove()
ahead.dispose()
release()

// A composer mounted without the request takes no focus at all, which read-only surfaces rely on.
const quiet = isolate(() => <Composer session="ses_h" />)
await wait(80)
assert.notEqual(document.activeElement, prompt(quiet.root), "a composer mounted without the request keeps no focus")
quiet.dispose()

// An unfocused window, for example the Agent Manager while the sidebar has focus, never takes focus on a switch.
const hasFocus = document.hasFocus.bind(document)
document.hasFocus = () => false
const unfocused = isolate(() => <Composer session="ses_i" focusOnDraftChange={() => true} />)
await wait(80)
document.hasFocus = hasFocus
assert.notEqual(document.activeElement, prompt(unfocused.root), "an unfocused window keeps no prompt focus")
unfocused.dispose()

const cloud = isolate(() => <Composer session="cloud" focusOnDraftChange={cloudDraftMayFocus} />)
cloud.root.classList.add("am-cloud-detail")
const strip = document.createElement("div")
strip.innerHTML =
  '<div data-tab-id="a"><button role="tab">A</button></div><div data-tab-id="b"><button role="tab">B</button></div>'
cloud.root.append(strip)
const terminalHost = document.createElement("div")
terminalHost.className = "am-cloud-terminal am-side-terminal-layer"
terminalHost.innerHTML = '<div class="am-terminal-host"><textarea></textarea></div>'
cloud.root.append(terminalHost)
const shell = terminalHost.querySelector("textarea")!
const reportsCloud: string[] = []
const cleanup = bindCloudFocus(cloud.root, (target) => reportsCloud.push(target))
const fieldCloud = prompt(cloud.root)
const [a, b] = strip.querySelectorAll("button")
let selected = "a"
const rove = createTabFocus({
  ids: () => ["a", "b"],
  select: (id) => (selected = id),
  activate: () => focusCloudChat(),
  root: () => strip,
})
for (const [button, id] of [
  [a!, "a"],
  [b!, "b"],
] as const) {
  button.addEventListener("keydown", (event) => rove.key(id, event))
  button.addEventListener("click", () => focusCloudChat())
}
const press = (button: HTMLElement, key: string) =>
  button.dispatchEvent(
    new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as unknown as KeyboardEvent,
  )
const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
for (const [from, key, expected, id] of [
  [a!, "ArrowRight", b!, "b"],
  [b!, "Home", a!, "a"],
  [a!, "End", b!, "b"],
] as const) {
  from.focus()
  press(from, key)
  await paint()
  assert.equal(selected, id)
  assert.equal(document.activeElement, expected, `roving ${key} leaves focus on selected tab`)
}
press(b!, "Enter")
assert.equal(document.activeElement, fieldCloud, "Enter opens the already-selected composer")
b!.focus()
b!.click()
assert.equal(document.activeElement, fieldCloud, "click opens the already-selected composer")
shell.focus()
assert.equal(reportsCloud.at(-1), "sideTerminal", "VS Code routes terminal shortcuts to the side shell")
focusCloudChat()
assert.equal(document.activeElement, shell, "normal recovery respects a terminal")
shell.blur()
window.dispatchEvent(new window.Event("focus"))
assert.equal(document.activeElement, shell, "a window which lost DOM focus restores the shell")
const dock = document.createElement("div")
dock.dataset.component = "question-dock"
dock.innerHTML = '<input data-slot="custom-input">'
cloud.root.append(dock)
focusCloudChat(true)
assert.equal(
  document.activeElement,
  dock.firstElementChild,
  "the explicit terminal shortcut prefers a free-text question",
)
const branch = document.createElement("input")
cloud.root.append(branch)
branch.focus()
focusCloudChat(true)
window.dispatchEvent(new window.Event("focus"))
assert.equal(document.activeElement, branch, "focus recovery never takes a branch editor away from the user")
branch.remove()
dock.remove()
b!.focus()
const menu = createTabMenuAction()
const dismissal = new window.Event("close", { cancelable: true }) as unknown as Event
menu.close(dismissal)
assert.ok(!dismissal.defaultPrevented, "dismissing a menu can restore its trigger")
menu.select(() => focusCloudChat())
menu.close(dismissal)
assert.ok(dismissal.defaultPrevented, "opening a session suppresses trigger restoration")
assert.equal(document.activeElement, fieldCloud, "menu selection enters the restored session")
const shells = createCloudShells({
  kind: "session",
  title: "Fixture",
  projectID: "test",
  directory: "/workspace",
  repository: "fixture",
  scope: "fixture",
  target: { scope: "fixture", providerID: "kilo-cloud", workspaceID: "fixture", sessionID: "test" },
})
const firstShell = shells.active()
shells.add()
let closed = 0
const closeShell = () => {
  closed++
  terminalHost.remove()
  focusCloudChat()
}
assert.equal(cloudShellAction("closeTab", shells, closeShell), false, "a composer close does not close the terminal")
shell.focus()
assert.equal(cloudShellAction("closeTab", shells, closeShell), true, "a terminal close is consumed")
assert.equal(shells.request().id, firstShell, "the surviving terminal receives keyboard focus")
cloudShellAction("closeTab", shells, closeShell)
assert.equal(closed, 1)
assert.equal(document.activeElement, fieldCloud, "closing the last terminal returns to the composer")
cleanup()
cloud.dispose()

await window.happyDOM.close()
