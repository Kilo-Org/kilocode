import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { configurable: true, value: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLHeadElement: window.HTMLHeadElement,
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
  PointerEvent: window.PointerEvent,
  KeyboardEvent: window.KeyboardEvent,
  MessageEvent: window.MessageEvent,
  FileReader: window.FileReader,
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  acquireVsCodeApi: () => ({
    postMessage: () => undefined,
    getState: () => undefined,
    setState: () => undefined,
  }),
})
Object.assign(window, { KILO_SETTINGS: { "chat.sendWhileRunning": "steer" } })

const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { SpeechToTextStatusProvider } = await import("../../webview-ui/src/components/speech-to-text/status")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { PromptInput } = await import("../../webview-ui/src/v2/prompt")
const { applyKiloSettings } = await import("../../webview-ui/src/v2/kilo-settings")
import type { ReplyHandler, ReviewAppendHandler } from "../../webview-ui/src/v2/append-ready"
import type { SendMode } from "../../webview-ui/src/v2/pending-actions"
import type { SlashEntry } from "../../webview-ui/src/v2/slash"

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

const sandboxStatus = { directory: "/workspace", enabled: false, available: true, network: false, version: 1 }
const sandbox = {
  support: async () => ({ enabled: false, available: true, network: false }),
  status: async () => sandboxStatus,
  toggle: async () => sandboxStatus,
  events: { on: () => () => undefined },
}
const workspace = {
  connection: { status: () => "connected" },
  report: () => undefined,
  directory: "/workspace",
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
} as never

const [running, setRunning] = createSignal(false)
const [submitting, setSubmitting] = createSignal(false)
const [blocked, setBlocked] = createSignal(false)
const [disabled, setDisabled] = createSignal(false)

const sends: Array<{ text: string; mode: SendMode; resolve: (ok: boolean) => void }> = []
let autoResolve = true
let reply: ReplyHandler | undefined
let reviewAppend: ReviewAppendHandler | undefined

// Goal mode needs the plugin's command in the slash catalog, as it is in the real composer.
const goalEntry: SlashEntry = {
  kind: "command",
  name: "goal",
  hints: [],
  command: { name: "goal", description: "Start a goal" },
}

const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <V2Scope value={workspace}>
          <SpeechToTextStatusProvider>
            <PromptInput
              session="ses_1"
              draftKey="ses_1"
              running={running()}
              submitting={submitting()}
              blocked={blocked()}
              disabled={disabled()}
              onSend={(text, mode) =>
                new Promise<boolean>((resolve) => {
                  sends.push({ text, mode, resolve })
                  if (autoResolve) resolve(true)
                })
              }
              onStop={() => undefined}
              slash={{ entries: () => [goalEntry], run: async () => false }}
              onReplyReady={(value) => (reply = value)}
              onReviewAppendReady={(value) => (reviewAppend = value)}
            />
          </SpeechToTextStatusProvider>
        </V2Scope>
      </LanguageProvider>
    </VSCodeProvider>
  ),
  root,
)

try {
  await tick()
  const textarea = root.querySelector<HTMLTextAreaElement>("textarea.prompt-input")!
  assert.ok(textarea && reply && reviewAppend, "PromptInput mounted with reply and review handlers")

  const ref = (id: string, comment = "nit") => ({
    id,
    origin: "chat" as const,
    messageID: "msg_1",
    partID: "prt_1",
    offset: 0,
    quote: "Earlier answer passage",
    comment,
  })
  const local = (id: string, comment = "Fix line 3") => ({
    id,
    file: "src/a.ts",
    side: "additions" as const,
    line: 3,
    comment,
    selectedText: "const x = 1",
  })

  // 1. Running turn: Option-click reply queues and leaves composer empty (never pastes markdown).
  setRunning(true)
  await tick()
  reply.send(ref("r-1"), "alternate")
  await tick()
  assert.equal(sends.length, 1)
  assert.equal(sends[0]!.mode, "queue")
  assert.equal(textarea.value, "", "composer stays empty after queued reply")

  // 2. While a previous send HTTP request is still in flight, a second reply still queues instead of pasting.
  autoResolve = false
  reply.send(ref("r-2"), "enter")
  reply.send(ref("r-3"), "alternate")
  await tick()
  assert.equal(sends.length, 3, "second send queues even while the first HTTP send is still in flight")
  assert.equal(sends[1]!.mode, "steer")
  assert.equal(sends[2]!.mode, "queue")
  assert.equal(textarea.value, "", "composer stays empty while concurrent sends are in flight")
  sends[1]!.resolve(true)
  sends[2]!.resolve(true)
  autoResolve = true
  await tick()

  // 3. Admitted prompt starting (`submitting` true before `running` turns true): Option-click / ⌥↵ already queues.
  setRunning(false)
  setSubmitting(true)
  await tick()
  reply.send(ref("r-4"), "alternate")
  reviewAppend([local("c-1")], "alternate")
  await tick()
  assert.equal(sends.at(-2)!.mode, "queue", "reply Option-click queues while submitting")
  assert.equal(sends.at(-1)!.mode, "queue", "review Option-click queues while submitting")
  assert.equal(textarea.value, "")

  // 4. Pending permission (`blocked` true while running): queueing via Option-click or ⌥↵ still works!
  setSubmitting(false)
  setRunning(true)
  setBlocked(true)
  await tick()
  reply.send(ref("r-5"), "alternate")
  reviewAppend([local("c-2")], "alternate")
  await tick()
  assert.equal(sends.at(-2)!.mode, "queue", "reply Option-click queues even while blocked on a permission")
  assert.equal(sends.at(-1)!.mode, "queue", "review Option-click queues even while blocked on a permission")
  assert.equal(textarea.value, "", "blocked permission does not paste raw markdown into composer on queue")

  // Plain steer click while blocked keeps the reply as a structured chip, NOT raw markdown in textarea.
  const countBeforeBlockedSteer = sends.length
  reply.send(ref("r-blocked-steer"), "enter")
  await tick()
  assert.equal(sends.length, countBeforeBlockedSteer, "steer does not bypass a pending permission")
  assert.equal(textarea.value, "", "blocked steer keeps a structured reply chip instead of pasting raw markdown")
  assert.equal(reply.pending().length, 1, "blocked steer keeps the ChatReferenceData in pending replies")

  // Unblock and click composer's 'Send all' on Replies (1) with Option-click -> queues!
  setBlocked(false)
  await tick()
  const sendAll = [...root.querySelectorAll<HTMLButtonElement>("[data-source=chat] button")].find(
    (btn) => btn.textContent?.trim() === "Send all",
  )!
  assert.ok(sendAll, "Replies group renders Send all")
  sendAll.dispatchEvent(new window.MouseEvent("click", { bubbles: true, altKey: true }))
  await tick()
  assert.equal(sends.at(-1)!.mode, "queue", "Replies Send all Option-click queues")
  assert.equal(reply.pending().length, 0)

  // 5. Flip chat.sendWhileRunning to "queue": plain click queues, Option-click steers.
  applyKiloSettings({ "chat.sendWhileRunning": "queue" })
  await tick()
  reply.send(ref("r-6"), "enter")
  reply.send(ref("r-7"), "alternate")
  await tick()
  assert.equal(sends.at(-2)!.mode, "queue")
  assert.equal(sends.at(-1)!.mode, "steer")

  // 6. Disconnected (`disabled` true): reply falls back to structured chip, never raw markdown text.
  setDisabled(true)
  await tick()
  const beforeDisabled = sends.length
  reply.send(ref("r-offline"), "alternate")
  await tick()
  assert.equal(sends.length, beforeDisabled)
  assert.equal(textarea.value, "", "offline fallback never pastes raw markdown into textarea")
  assert.equal(reply.pending().length, 1, "offline fallback preserves the reply chip")

  // 7. Goal mode: a plain-click batch stays in the draft, and an Option-click sends both batches together.
  setDisabled(false)
  await tick()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!
  setter.call(textarea, "/goal")
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }))
  await tick()
  textarea.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  await tick()
  assert.ok(root.querySelector(".prompt-goal-header"), "the composer entered goal mode")
  const beforeGoal = sends.length
  reviewAppend([local("c-goal-1", "Fix the first note")], "enter")
  await tick()
  assert.equal(sends.length, beforeGoal, "a plain click in goal mode keeps the chip in the draft")
  assert.equal(
    root.querySelectorAll("[data-component=review-comments][data-source=local]").length,
    1,
    "goal mode shows the chip",
  )
  reviewAppend([local("c-goal-2", "Fix the second note")], "alternate")
  await tick()
  assert.equal(sends.length, beforeGoal + 1, "the Option-click sends the merged chips once")
  assert.match(sends.at(-1)!.text, /Fix the first note/, "the send keeps the chip already in the draft")
  assert.match(sends.at(-1)!.text, /Fix the second note/, "the send adds the new chip")
  assert.equal(
    root.querySelectorAll("[data-component=review-comments][data-source=local]").length,
    0,
    "the sent chips leave the draft",
  )
} finally {
  dispose()
  root.remove()
}
