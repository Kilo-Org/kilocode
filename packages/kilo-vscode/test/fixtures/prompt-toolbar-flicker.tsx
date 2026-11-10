// Renders the real v2 composer with the providers the Agent Manager mounts per worktree. Each worktree switch
// disposes the tree and mounts a new one, so the icons the toolbar shows on the first frame after the switch must
// match the frame before it. A tool that only knows its state from a host reply would otherwise blink out.
import assert from "node:assert/strict"
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
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  FileReader: window.FileReader,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})
// happy-dom has no layout, so the toolbar would measure zero and skip the fold. A fixed width exercises the real path.
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 })

const replies: Promise<void>[] = []
// The host answers over the extension relay, so every reply lands after the frame that asked for it.
const reply = (message: unknown) =>
  new Promise<void>((resolve) =>
    setTimeout(() => {
      post(message, window)
      resolve()
    }, 5),
  )
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({
    postMessage: (message: { type: string }) => {
      if (message.type === "requestAutoApproveState")
        replies.push(reply({ type: "autoApproveStateLoaded", value: true }))
      if (message.type === "speechToTextConfig") replies.push(reply({ type: "speechToTextConfigLoaded", status }))
    },
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
const { post } = await import("../../webview-ui/src/utils/webview-message")
const { emptySpeechStatus } = await import("../../webview-ui/src/components/speech-to-text/availability")

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const status = { ...emptySpeechStatus(), enabled: true, signedIn: true }
const sandboxStatus = { directory: "/workspace", enabled: true, available: true, network: false, version: 1 }
const sandbox = {
  support: async () => ({ enabled: true, available: true, network: false }),
  status: async () => {
    await wait(5)
    return sandboxStatus
  },
  toggle: async () => sandboxStatus,
  events: { on: () => () => undefined },
}
const v2 = {
  connection: { status: () => "connected" },
  report: () => undefined,
  directory: "/workspace",
  // The prompt hint reads the keybindings and the editor selection of the scope.
  bindings: () => ({}),
  selection: () => false,
  api: { generate: { text: async () => ({ text: "" }) }, rpc: () => sandbox },
  data: {
    listen: () => () => undefined,
    on: () => () => undefined,
    session: { message: { list: () => [] } },
  },
} as never

function Composer() {
  const autoApprove = createAutoApprove()
  const confinement = createSandbox({ session: () => "ses_a" })
  return (
    <PromptInput
      session="ses_a"
      draftKey="ses_a"
      running={false}
      disabled={false}
      onSend={async () => true}
      onStop={() => undefined}
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
const isolate = () => {
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () => (
      <VSCodeProvider>
        <LanguageProvider>
          <V2Scope value={v2}>
            <SpeechToTextStatusProvider>
              <Composer />
            </SpeechToTextStatusProvider>
          </V2Scope>
        </LanguageProvider>
      </VSCodeProvider>
    ),
    root,
  )
  return { root, dispose }
}

// Every icon the toolbar shows, in order, with the state that makes it look different between frames.
const icons = (root: Element) =>
  [...root.querySelectorAll("button[data-component='icon-button']")].map((node) => ({
    icon: node.getAttribute("data-icon"),
    active: node.getAttribute("aria-pressed") === "true",
    disabled: node.hasAttribute("disabled"),
    folded: node.closest(".prompt-action")?.hasAttribute("data-folded") ?? false,
  }))

// Wait for a condition the host's replies drive, so a slow CI runner does not race the assertion.
const until = async (check: () => boolean, what: string) => {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (check()) return
    await wait(5)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

// The first worktree needs the real round trips: the speech provider debounces its request.
const first = isolate()
await until(() => replies.length >= 2, "the first worktree's host replies")
await Promise.all(replies)
await until(
  () => ["microphone", "lock"].every((icon) => icons(first.root).some((item) => item.icon === icon)),
  "the speech and sandbox buttons",
)
await window.happyDOM.waitUntilComplete()

const before = icons(first.root)
for (const icon of ["microphone", "shield", "lock", "wand-sparkles"])
  assert.ok(
    before.some((item) => item.icon === icon),
    `the composer shows ${icon}: ${JSON.stringify(before)}`,
  )
assert.ok(
  before.some((item) => item.icon === "shield" && item.active),
  `auto-approve shows as on: ${JSON.stringify(before)}`,
)
assert.ok(
  before.some((item) => item.icon === "lock" && item.active),
  `the sandbox shows as on: ${JSON.stringify(before)}`,
)

// A worktree switch: the Agent Manager disposes the scope and mounts the next worktree's composer.
first.dispose()
const second = isolate()
const switched = icons(second.root)
assert.deepEqual(switched, before, "a switched worktree composer shows the same icons on its first frame")

// The next worktree's host replies must not move anything, because nothing was missing.
await until(() => replies.length >= 4, "the next worktree's requests")
await Promise.all(replies.slice(2))
await window.happyDOM.waitUntilComplete()
assert.deepEqual(icons(second.root), before, "the icons stay put once the host answers")
second.dispose()
await window.happyDOM.close()
