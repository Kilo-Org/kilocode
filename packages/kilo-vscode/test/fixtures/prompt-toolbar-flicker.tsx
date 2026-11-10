// Renders the real v2 composer with the providers the Agent Manager mounts per worktree. Each worktree switch
// disposes the tree and mounts a new one, so the icons the toolbar shows on the first frame after the switch must
// match the frame before it. A tool that only knows its state from a host reply would otherwise blink out.
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
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  FileReader: window.FileReader,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

// happy-dom has no layout. A fixed toolbar width, a fixed icon size and a known font size let the real fold run:
// the toolbar rooms 320px of content, keeps 19em (209px) for the selectors and 52px of pinned actions, so one of
// the three foldable actions stays and two fold.
const TOOLBAR_WIDTH = 340
let hidden = false
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get: () => (hidden ? 0 : TOOLBAR_WIDTH),
})
Object.defineProperty(window.Element.prototype, "getBoundingClientRect", {
  configurable: true,
  value(this: Element) {
    const width = this instanceof window.HTMLElement && this.classList.contains("prompt-input-hint-pinned") ? 52 : 24
    return { x: 0, y: 0, width, height: 24, top: 0, left: 0, right: width, bottom: 24, toJSON: () => ({}) } as DOMRect
  },
})
const computed = window.getComputedStyle.bind(window)
Object.assign(globalThis, {
  getComputedStyle: ((element: Element) => {
    if (element instanceof window.HTMLElement && element.classList.contains("prompt-input-hint"))
      return { fontSize: "11px", paddingLeft: "6px", paddingRight: "6px", columnGap: "8px" }
    if (element instanceof window.HTMLElement && element.classList.contains("prompt-input-hint-actions"))
      return { columnGap: "4px" }
    return computed(element)
  }) as typeof getComputedStyle,
})

const replies: Promise<void>[] = []
// What the host would read from the config when it answers a sandbox default request.
let hostDefault = true
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
      if (message.type === "requestSandboxDefault")
        replies.push(reply({ type: "sandboxDefaultLoaded", explicit: hostDefault }))
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
const workspace = (directory: string) =>
  ({
    connection: { status: () => "connected" },
    report: () => undefined,
    directory,
    api: { generate: { text: async () => ({ text: "" }) }, rpc: () => sandbox },
    // The composer's `@` model reference picker reads the location's model catalog.
    kiloModels: () => ({ entries: new Map() }),
    data: {
      listen: () => () => undefined,
      on: () => () => undefined,
      session: { message: { list: () => [] } },
      location: { model: { list: () => [] }, provider: { list: () => [] } },
    },
  }) as never

function Composer(props: { session: string }) {
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
const isolate = (input: { child: () => JSX.Element; directory?: string; hidden?: boolean }) => {
  const root = document.createElement("div")
  document.body.append(root)
  hidden = input.hidden === true
  const dispose = render(
    () => (
      <VSCodeProvider>
        <LanguageProvider>
          <V2Scope value={workspace(input.directory ?? "/workspace")}>
            <SpeechToTextStatusProvider>{input.child()}</SpeechToTextStatusProvider>
          </V2Scope>
        </LanguageProvider>
      </VSCodeProvider>
    ),
    root,
  )
  hidden = false
  return { root, dispose }
}

// A draft composer exposes its sandbox control, so the first prompt's metadata can be read directly.
function Draft(props: { expose: (sandbox: ReturnType<typeof createSandbox>) => void }) {
  const sandbox = createSandbox({ session: () => undefined })
  props.expose(sandbox)
  return null
}
const draft = (expose: (sandbox: ReturnType<typeof createSandbox>) => void, directory = "/workspace") =>
  isolate({ child: () => <Draft expose={expose} />, directory })

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
// Let the debounced speech request, the host replies and the sandbox reads land.
const settleHost = async () => {
  await wait(120)
  await window.happyDOM.waitUntilComplete()
}

// The directory cache is capped. Mounting a 21st worktree evicts the one that has gone longest without a read, so a
// later return to it reads the sandbox state again.
const capped: Array<ReturnType<typeof createSandbox>> = []
const mountCached = async (directory: string) => {
  const mount = draft((sandbox) => capped.push(sandbox), directory)
  await wait(0)
  mount.dispose()
}
for (let index = 0; index < 20; index++) await mountCached(`/workspace/cap-${index}`)
await mountCached("/workspace/cap-20")
const evicted = draft((sandbox) => capped.push(sandbox), "/workspace/cap-0")
assert.equal(capped.at(-1)!.enabled(), false, "the 21st directory evicts the oldest cache entry")
await wait(0)
assert.equal(capped.at(-1)!.enabled(), true, "the evicted directory reads its state again")
evicted.dispose()

// The first worktree needs the real round trips: the speech provider debounces its request.
const first = isolate({ child: () => <Composer session="ses_a" /> })
await until(
  () => ["microphone", "lock"].every((icon) => icons(first.root).some((item) => item.icon === icon)),
  "the speech and sandbox buttons",
)
await settleHost()

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
assert.ok(
  before.filter((item) => item.folded).length > 0 && before.some((item) => !item.folded && item.icon !== "send"),
  `the toolbar folds one action and keeps another: ${JSON.stringify(before)}`,
)

// A worktree switch: the Agent Manager disposes the scope and mounts the next worktree's composer.
first.dispose()
const second = isolate({ child: () => <Composer session="ses_a" /> })
const switched = icons(second.root)
assert.deepEqual(switched, before, "a switched worktree composer shows the same icons on its first frame")
await settleHost()
assert.deepEqual(icons(second.root), before, "the icons stay put once the host answers")
assert.ok(
  second.root.querySelector(".prompt-input-hint-actions")?.hasAttribute("data-measured"),
  "the toolbar measures its fold once",
)

// A composer mounted with no measurable width keeps the last fold. Without the cached measurement it would show
// every action until the panel gets a width, which is the flash the cache prevents.
second.dispose()
const hiddenMount = isolate({ child: () => <Composer session="ses_a" />, hidden: true })
assert.deepEqual(icons(hiddenMount.root), before, "a composer mounted without a width keeps the last fold")
hiddenMount.dispose()

// Another worktree has its own directory, so the sandbox cache must not leak into it. The global tools do carry over.
const other = isolate({ child: () => <Composer session="ses_b" />, directory: "/workspace/other" })
const otherFirst = icons(other.root)
assert.ok(
  otherFirst.some((item) => item.icon === "microphone" && !item.disabled),
  `the other worktree keeps the mic: ${JSON.stringify(otherFirst)}`,
)
assert.ok(
  otherFirst.some((item) => item.icon === "shield" && item.active),
  `the other worktree keeps auto-approve: ${JSON.stringify(otherFirst)}`,
)
assert.ok(
  !otherFirst.some((item) => item.icon === "lock"),
  `the other worktree starts without the sandbox lock: ${JSON.stringify(otherFirst)}`,
)
await until(() => icons(other.root).some((item) => item.icon === "lock"), "the other worktree's sandbox read")
await settleHost()
assert.ok(
  icons(other.root).some((item) => item.icon === "lock" && item.active),
  `the other worktree reads its own sandbox state: ${JSON.stringify(icons(other.root))}`,
)
other.dispose()

// The remembered default only renders. The first prompt asks again, so a default changed while the composer was
// unmounted cannot seed the new session.
const draftSandboxes: Array<ReturnType<typeof createSandbox>> = []
const firstDraft = draft((sandbox) => draftSandboxes.push(sandbox))
await settleHost()
assert.equal(draftSandboxes.at(-1)!.enabled(), true, "the draft shows the configured default")
firstDraft.dispose()

hostDefault = false
const secondDraft = draft((sandbox) => draftSandboxes.push(sandbox))
const remembered = draftSandboxes.at(-1)!
assert.equal(remembered.enabled(), true, "the remounted draft renders the remembered default first")
assert.equal(
  (await remembered.metadata())["kilocode.sandbox"].enabled,
  false,
  "the first prompt uses the default read after the remount",
)
secondDraft.dispose()

await window.happyDOM.close()
