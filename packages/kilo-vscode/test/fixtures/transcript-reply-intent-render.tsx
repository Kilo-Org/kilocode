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
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  KeyboardEvent: window.KeyboardEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})
Object.assign(window, { KILO_SETTINGS: { "chat.sendWhileRunning": "steer" } })

const { render } = await import("solid-js/web")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { resolveTemplate } = await import("../../webview-ui/src/context/language-utils")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { dict: amDict } = await import("../../webview-ui/agent-manager/i18n/en")
const { TranscriptReply } = await import("../../webview-ui/src/v2/transcript-reply")
const { applyKiloSettings } = await import("../../webview-ui/src/v2/kilo-settings")
const { isMac } = await import("../../webview-ui/src/v2/pending-actions")
const { clickModifier } = await import("../../webview-ui/src/v2/send-hint-text")

const english = { ...dict, ...amDict } as Record<string, string>
const language = {
  locale: () => "en" as const,
  setLocale: () => undefined,
  userOverride: () => "" as const,
  t: (key: string, params?: Record<string, string | number | boolean | undefined>) =>
    resolveTemplate(english[key] ?? key, params),
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

async function exercise(run: (ctx: { field: HTMLTextAreaElement; send: HTMLButtonElement }) => Promise<void>) {
  const transcript = document.createElement("div")
  transcript.innerHTML =
    '<div data-row="assistant" data-message="msg_1"><div data-part-id="prt_1">' +
    '<span data-slot="text-part-body">Hello seeded answer for the reply tools.</span></div></div>'
  document.body.append(transcript)
  const body = transcript.querySelector("[data-slot=text-part-body]")!
  const sent: Array<{ quote: string; comment: string; intent: string }> = []
  const saved: Array<{ quote: string; comment: string }> = []
  const reply = {
    pending: () => [],
    add: (reference: { quote: string; comment: string }) => saved.push({ quote: reference.quote, comment: reference.comment }),
    remove: () => undefined,
    send: (reference: { quote: string; comment: string }, intent = "enter") =>
      sent.push({ quote: reference.quote, comment: reference.comment, intent }),
  }

  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () => (
      <LanguageContext.Provider value={language}>
        <TranscriptReply root={() => transcript} reply={reply} sent={() => []} />
      </LanguageContext.Provider>
    ),
    host,
  )
  try {
    await tick()
    const range = document.createRange()
    range.selectNodeContents(body)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }))
    await tick()

    const comment = [...document.querySelectorAll<HTMLButtonElement>(".transcript-reply-bar button")].find(
      (item) => item.textContent?.trim() === "Comment",
    )
    assert.ok(comment, "the selection toolbar offers Comment")
    comment.click()
    await tick()

    const field = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")].find(
      (item) => item.placeholder === "Leave a comment...",
    )
    assert.ok(field, "the comment card opened")
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!
    setter.call(field, "nit")
    field.dispatchEvent(new window.Event("input", { bubbles: true }))
    await tick()

    const send = [...document.querySelectorAll<HTMLButtonElement>(".transcript-reply-card button")].find(
      (item) => item.textContent?.trim() === "Send to Kilo",
    )
    assert.ok(send, "the card offers Send to Kilo")
    await run({ field, send })
    await tick()
    return { sent, saved }
  } finally {
    dispose()
    host.remove()
    transcript.remove()
    document.querySelectorAll(".transcript-reply-bar, .transcript-reply-card").forEach((node) => node.remove())
  }
}

const plainClick = await exercise(async ({ send }) => {
  const mac = isMac()
  const mod = clickModifier()
  const trigger = send.closest("[data-component=tooltip-trigger]")!
  trigger.dispatchEvent(new window.PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }))
  await tick(600)
  const rows = () =>
    [...document.querySelectorAll(".send-hint [data-slot=tooltip-keybind]")].map((row) =>
      [...row.querySelectorAll("span")].map((span) => span.textContent),
    )
  assert.deepEqual(rows(), [
    ["Send to Kilo", mac ? "↵" : "Enter"],
    ["Queue for after this turn", `${mac ? "⌥↵" : "Alt+Enter"} / ${mod}+click`],
  ])
  applyKiloSettings({ "chat.sendWhileRunning": "queue" })
  await tick()
  assert.deepEqual(rows(), [
    ["Send to Kilo", mac ? "↵" : "Enter"],
    ["Steer this turn", `${mac ? "⌥↵" : "Alt+Enter"} / ${mod}+click`],
  ])
  applyKiloSettings({ "chat.sendWhileRunning": "steer" })
  await tick()
  send.dispatchEvent(new window.MouseEvent("click", { bubbles: true, altKey: false }))
})
assert.equal(plainClick.sent.length, 1, "a plain click sends the reply")
assert.equal(plainClick.sent[0]!.intent, "enter")
assert.equal(plainClick.sent[0]!.comment, "nit")
assert.match(plainClick.sent[0]!.quote, /Hello seeded answer/)

const optionClick = await exercise(async ({ send }) => {
  send.dispatchEvent(new window.MouseEvent("click", { bubbles: true, altKey: true }))
})
assert.equal(optionClick.sent.length, 1, "an Option-click sends the reply with alternate delivery")
assert.equal(optionClick.sent[0]!.intent, "alternate")

const plainEnter = await exercise(async ({ field }) => {
  field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
})
assert.equal(plainEnter.sent.length, 1, "plain Enter sends the reply like Enter")
assert.equal(plainEnter.sent[0]!.intent, "enter")

const optionEnter = await exercise(async ({ field }) => {
  field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", altKey: true, bubbles: true }))
})
assert.equal(optionEnter.sent.length, 1, "Option+Enter sends the reply with alternate delivery")
assert.equal(optionEnter.sent[0]!.intent, "alternate")

const saveShortcut = await exercise(async ({ field }) => {
  field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }))
})
assert.equal(saveShortcut.sent.length, 0, "Cmd+Enter saves for later instead of sending")
assert.equal(saveShortcut.saved.length, 1)
