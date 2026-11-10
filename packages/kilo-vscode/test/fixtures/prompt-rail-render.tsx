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
  HTMLHeadElement: window.HTMLHeadElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent,
  WheelEvent: window.WheelEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})
window.innerWidth = 420
window.innerHeight = 720

// happy-dom does not lay out, so the rail would report no height and the card
// would refuse to place itself. Give the rail the transcript box it occupies in
// the extension; every other element keeps a zero box.
// The rail is a 16px column 8px inside its pane edge, as the CSS lays it out.
function box(this: Element) {
  const left = this.getAttribute?.("data-side") === "right" ? 420 - 8 - 16 : 8
  const value = { x: left, y: 0, top: 0, left, right: left + 16, bottom: 700, width: 16, height: 700 }
  return { ...value, toJSON: () => value }
}
const zero = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => undefined }
Object.defineProperty(window.Element.prototype, "getBoundingClientRect", {
  configurable: true,
  value(this: Element) {
    return this.classList?.contains("prompt-rail") ? box.call(this) : zero
  },
})

const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { resolveTemplate } = await import("../../webview-ui/src/context/language-utils")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { PromptRail } = await import("../../webview-ui/src/v2/prompt-rail")
import type { PromptRailItem } from "../../webview-ui/src/v2/prompt-rail-data"

const language = {
  locale: () => "en" as const,
  setLocale: () => undefined,
  userOverride: () => "" as const,
  t: (key: string, params?: Record<string, string | number | boolean | undefined>) =>
    resolveTemplate((dict as Record<string, string>)[key] ?? key, params),
}

const items: PromptRailItem[] = Array.from({ length: 5 }, (_, index) => ({
  key: `k${index + 1}`,
  turn: `t${index + 1}`,
  queued: false,
  prompt: `p${index + 1}`,
  answer: `a${index + 1}`,
}))
items.push({ key: "queued:q1", turn: "queued:q1", queued: true, prompt: "later", answer: "" })

const root = document.createElement("div")
document.body.append(root)
const outside = document.createElement("button")
outside.textContent = "outside"
document.body.append(outside)

const [active, setActive] = createSignal<string | undefined>(items[0]?.key)
const [wheel, setWheel] = createSignal(0)
const [older, setOlder] = createSignal(false)
const [loading, setLoading] = createSignal(false)
const [prepending, setPrepending] = createSignal(false)
const [seeking, setSeeking] = createSignal(false)
const calls = { first: 0, latest: 0, load: 0, wheel: 0 }

const rail = (history: boolean, side: "left" | "right" = "left") =>
  render(
    () => (
      <LanguageContext.Provider value={language}>
        <div class="message-list-container" data-testid="host" data-selected={active()}>
          <div class="message-list" data-testid="content" tabIndex={0}>
            {active()}
          </div>
          <PromptRail
            side={side}
            entries={() =>
              history
                ? [{ type: "history" }, { type: "prompt", item: items[0]!, index: 0 }]
                : items.map((item, index) => ({ type: "prompt", item, index }))
            }
            items={() => items}
            active={active}
            onSelect={(item) => setActive(item.key)}
            onFirst={() => calls.first++}
            onLatest={() => calls.latest++}
            onLoadOlder={() => calls.load++}
            onWheel={(delta) => {
              calls.wheel++
              setWheel(delta)
            }}
            height={() => 700}
            hasOlder={older}
            loadingOlder={loading}
            prepending={prepending}
            seeking={seeking}
          />
        </div>
      </LanguageContext.Provider>
    ),
    root,
  )

const page = () => root.querySelector<HTMLElement>('[data-testid="host"]')!
const content = () => root.querySelector<HTMLElement>('[data-testid="content"]')!
const ticks = () => [...root.querySelectorAll<HTMLElement>(".prompt-rail-tick")]
const card = () => document.querySelector<HTMLElement>(".prompt-rail-card")
const rows = () => [...document.querySelectorAll<HTMLElement>(".prompt-rail-row")]
const key = (node: Element, value: string) =>
  node.dispatchEvent(new window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const mouse = (node: Element, type: string, init: Record<string, unknown> = {}) =>
  node.dispatchEvent(new window.MouseEvent(type, { bubbles: false, cancelable: true, ...init }))
const button = (label: string) =>
  [...(card()?.querySelectorAll("button") ?? [])].find((node) => node.getAttribute("aria-label") === label)

const dispose = rail(false)

assert.equal(ticks().length, 6)
assert.equal(card(), null)

// A focused tick opens the card immediately, beside its own tick.
assert.equal(root.querySelector<HTMLElement>(".prompt-rail")!.getBoundingClientRect().height, 700)
ticks()[0]!.focus()
await wait(30)
assert.ok(card())
assert.equal(card()!.getAttribute("data-side"), "left")
assert.equal(card()!.style.left, "32px")
assert.equal(card()!.style.right, "auto")
const top = Number.parseFloat(card()!.style.top)
assert.ok(top >= 12 && top <= 708)
assert.equal(card()!.querySelector(".prompt-rail-card-title")?.textContent, "Prompt navigator")
assert.equal(rows().length, 6)
assert.ok(rows()[0]!.textContent?.includes("p1"))
assert.ok(rows()[0]!.textContent?.includes("a1"))
assert.ok(rows()[5]!.textContent?.includes("Queued"))
assert.ok(rows()[5]!.textContent?.includes("later"))
assert.equal(rows()[0]!.getAttribute("data-prompt-index"), "0")

// Keyboard navigation moves focus between ticks and opens the matching row.
key(ticks()[0]!, "End")
await wait(30)
assert.equal(document.activeElement, ticks()[5])
assert.ok(card()!.querySelector('[data-prompt-index="5"]'))
key(ticks()[5]!, "Home")
assert.equal(document.activeElement, ticks()[0])
key(ticks()[0]!, "ArrowDown")
assert.equal(document.activeElement, ticks()[1])
key(ticks()[1]!, "Enter")
assert.equal(page().dataset.selected, "k2")
key(ticks()[1]!, "ArrowDown")
key(ticks()[2]!, " ")
assert.equal(page().dataset.selected, "k3")

// Card buttons jump to the ends of the list.
button("Latest prompt")!.click()
assert.equal(calls.latest, 1)
button("First prompt")!.click()
assert.equal(calls.first, 1)

// Rows are selectable.
card()!.querySelector<HTMLElement>('[data-prompt-index="2"]')!.click()
assert.equal(page().dataset.selected, "k3")

// Escape dismisses the card before any other chat shortcut sees it.
let escapes = 0
document.addEventListener("keydown", () => escapes++)
key(document.body, "Escape")
await wait(150)
assert.equal(card(), null)
assert.equal(escapes, 0)
key(document.body, "Escape")
assert.equal(escapes, 1)

// A deliberate hover opens; crossing before the delay restarts it.
mouse(ticks()[0]!, "mouseenter")
await wait(200)
mouse(ticks()[1]!, "mouseenter")
await wait(200)
assert.equal(card(), null)
await wait(200)
assert.ok(card())
assert.ok(card()!.querySelector('[data-prompt-index="1"]'))

// Moving from the rail onto the card keeps it open across the gap.
mouse(document.querySelector<HTMLElement>(".prompt-rail")!, "mouseleave")
mouse(card()!, "mouseenter")
await wait(240)
assert.ok(card())
mouse(card()!, "mouseleave")
await wait(150)
assert.equal(card(), null)

// Wheel over the rail scrolls the transcript, forwards the delta and does not
// open a closed card.
key(document.body, "Escape")
await wait(150)
assert.equal(card(), null)
const wheelEvent = new window.WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true })
ticks()[0]!.dispatchEvent(wheelEvent)
assert.equal(wheelEvent.defaultPrevented, true)
assert.equal(calls.wheel, 1)
assert.equal(wheel(), -120)
await wait(400)
assert.equal(card(), null)

// A button held during a pointer sweep is a pane drag, not a hover.
mouse(content(), "mouseenter")
ticks()[2]!.dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: false, buttons: 1 }))
await wait(400)
assert.equal(card(), null)

// Focus leaving the navigator closes it.
ticks()[0]!.focus()
await wait(30)
assert.ok(card())
outside.focus()
await wait(150)
assert.equal(card(), null)

// Older history in the card pages on an upward wheel at the top.
setOlder(true)
ticks()[0]!.focus()
await wait(30)
assert.ok(card())
card()!.scrollTop = 0
card()!.dispatchEvent(new window.WheelEvent("wheel", { deltaY: -80, bubbles: true, cancelable: true }))
assert.equal(calls.load, 1)

// The loading row reports a seek in progress.
setSeeking(true)
assert.ok(card()!.querySelector(".prompt-rail-loading"))
setSeeking(false)

dispose()
root.replaceChildren()

// The card opens on the other physical edge with the same gap to its rail.
const disposeRight = rail(false, "right")
await wait(30)
root.querySelector<HTMLElement>(".prompt-rail-tick")!.focus()
await wait(30)
assert.equal(card()!.style.right, "32px")
assert.equal(card()!.style.left, "auto")
assert.equal(card()!.getAttribute("data-side"), "right")
disposeRight()
root.replaceChildren()

// A history entry takes the first tick and calls onFirst.
const disposeHistory = rail(true)
await wait(30)
assert.equal(ticks().length, 2)
ticks()[0]!.click()
assert.equal(calls.first, 2)
disposeHistory()
root.replaceChildren()

// A single prompt hides the rail entirely.
items.splice(1)
const disposeSingle = rail(false)
await wait(30)
assert.equal(root.querySelector(".prompt-rail"), null)
disposeSingle()

console.log("prompt rail render ok")
