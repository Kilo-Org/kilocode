import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
const style = window.getComputedStyle.bind(window)
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  FocusEvent: window.FocusEvent,
  InputEvent: window.InputEvent,
  KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  getComputedStyle: (node: Element) => {
    const value = style(node)
    Object.defineProperty(value, "animationName", { configurable: true, value: "none" })
    return value
  },
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const { Show, createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { SessionTabSwitcher } = await import("../../webview-ui/src/components/chat/SessionTabSwitcher")

const rows = [
  { id: "alpha", title: "Alpha", active: true, busy: false, pending: false },
  { id: "beta", title: "Beta", active: false, busy: true, pending: false },
  { id: "gamma", title: "Gamma", active: false, busy: false, pending: false },
]
const [items, setItems] = createSignal(rows)
const selected: string[] = []
const restored: boolean[] = []
const closed: string[] = []
const target = document.createElement("textarea")
const root = document.createElement("div")
document.body.append(root, target)

const dispose = render(
  () => (
    <Show when={items().length > 1}>
      <SessionTabSwitcher
        items={items}
        labels={{
          open: "Show open tabs",
          search: "Search open tabs",
          close: "Close tab",
          current: "Current",
          pending: "New",
          busy: "Working",
        }}
        onSelect={(id) => selected.push(id)}
        onRestore={() => {
          restored.push(true)
          target.focus()
        }}
        onClose={(id) => {
          closed.push(id)
          setItems((value) => value.filter((item) => item.id !== id))
        }}
        portal={false}
      />
    </Show>
  ),
  root,
)

function query<T extends Element>(selector: string, message: string) {
  const node = root.querySelector<T>(selector)
  assert(node, message)
  return node
}

const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}

const open = async () => {
  query<HTMLButtonElement>('[aria-label="Show open tabs"]', "Switcher trigger did not render").click()
  await settle()
  assert.equal(root.querySelector('[data-slot="list-item"][data-active="true"]'), null, "First tab was highlighted")
  assert.equal(
    query('[data-slot="list-item"][data-key="alpha"]', "Current tab did not render").getAttribute("data-selected"),
    "true",
    "Current tab was not selected",
  )
}

async function closeFiltered() {
  await open()

  const input = query<HTMLInputElement>('[data-slot="list-search"] input', "Switcher search did not render")
  input.value = "be"
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "be", inputType: "insertText" }))
  await settle()

  const close = query<HTMLButtonElement>(
    '[aria-label="Close tab: Beta"]',
    "Filtered result close button did not render",
  )
  assert.equal(close.tabIndex, 0, "Close button is not keyboard reachable")
  close.click()
  await settle()

  assert.deepEqual(closed, ["beta"], "Unexpected closed tabs")
  assert.equal(input.value, "be", "Closing a result cleared the filter")
  assert.equal(document.activeElement, input, "Search input was not refocused after closing a result")
}

async function selectFiltered() {
  setItems(rows)
  await settle()

  query<HTMLButtonElement>('[data-slot="list-item"][data-key="beta"]', "Filtered result did not return").click()
  await settle()

  assert.deepEqual(selected, ["beta"], "Unexpected selected tabs")
  assert.deepEqual(restored, [true], "Prompt focus was not restored")
  assert.equal(document.activeElement, target, "Popover close stole focus from the prompt")
}

async function enterSelectsFirst() {
  setItems(rows)
  selected.length = 0
  restored.length = 0
  await settle()

  await open()

  const input = query<HTMLInputElement>('[data-slot="list-search"] input', "Switcher search did not render")
  input.value = "ga"
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "ga", inputType: "insertText" }))
  await settle()

  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
  await settle()

  assert.deepEqual(selected, ["gamma"], "Enter did not select the first filtered result")
  assert.deepEqual(restored, [true], "Prompt focus was not restored after Enter")
  assert.equal(document.activeElement, target, "Popover close stole focus from the prompt")
}

async function deleteReopened() {
  await open()

  const alpha = query<HTMLButtonElement>(
    '[data-slot="list-item"][data-key="alpha"]',
    "Switcher did not reset its filter when reopened",
  )
  alpha.focus()
  alpha.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Delete" }))
  await settle()

  assert.deepEqual(closed, ["beta", "alpha"], "Keyboard close failed")
}

async function closeToOne() {
  closed.length = 0
  restored.length = 0

  const beta = query<HTMLButtonElement>(
    '[data-slot="list-item"][data-key="beta"]',
    "Switcher did not retain the remaining tabs",
  )
  beta.focus()
  beta.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Delete" }))
  await settle()

  assert.deepEqual(closed, ["beta"], "Final visible close failed")
  assert.deepEqual(restored, [true], "Prompt did not receive the focus handoff")
  assert.equal(root.querySelector('[aria-label="Show open tabs"]'), null, "Switcher did not unmount")
  assert.equal(document.activeElement, target, "Prompt was not focused after the switcher unmounted")
}

await closeFiltered()
await selectFiltered()
await enterSelectsFirst()
await deleteReopened()
await closeToOne()

dispose()
