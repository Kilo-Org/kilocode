import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { JSX } from "solid-js"

const win = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window: win,
  document: win.document,
  navigator: win.navigator,
  Node: win.Node,
  Element: win.Element,
  HTMLElement: win.HTMLElement,
  HTMLDivElement: win.HTMLDivElement,
  HTMLSpanElement: win.HTMLSpanElement,
  HTMLButtonElement: win.HTMLButtonElement,
  SVGElement: win.SVGElement,
  MutationObserver: win.MutationObserver,
  ResizeObserver: win.ResizeObserver,
  CustomEvent: win.CustomEvent,
  Event: win.Event,
  MouseEvent: win.MouseEvent,
  requestAnimationFrame: win.requestAnimationFrame.bind(win),
  cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  getComputedStyle: win.getComputedStyle.bind(win),
})

const { render } = await import("solid-js/web")
const { BasicTool } = await import("@opencode-ai/ui/basic-tool")

const settle = async () => {
  await Promise.resolve()
  await win.happyDOM.waitUntilComplete()
}
const mount = (view: () => JSX.Element) => {
  const root = win.document.createElement("div")
  win.document.body.append(root)
  const dispose = render(view, root)
  return { root, dispose }
}

try {
  // A collapsed card must not construct its body; opening it builds the body once.
  {
    let built = 0
    const body = () => {
      built += 1
      return <div data-testid="body">collapsed body</div>
    }
    const { root, dispose } = mount(() => (
      <BasicTool icon="task" status="completed" trigger={{ title: "Lazy body" }}>
        {body()}
      </BasicTool>
    ))
    await settle()
    assert.equal(built, 0)
    const trigger = root.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
    assert.ok(trigger)
    assert.equal(trigger.getAttribute("aria-expanded"), "false")
    trigger.click()
    await settle()
    assert.equal(built, 1)
    assert.ok(root.querySelector('[data-testid="body"]'))
    dispose()
  }

  // A structured trigger still renders its title and detail.
  {
    const { root, dispose } = mount(() => (
      <BasicTool icon="task" status="completed" trigger={{ title: "Read file", subtitle: "basic-tool.tsx" }} />
    ))
    await settle()
    assert.match(root.textContent ?? "", /Read file/)
    assert.match(root.textContent ?? "", /basic-tool\.tsx/)
    dispose()
  }

  // A JSX trigger still renders.
  {
    const { root, dispose } = mount(() => (
      <BasicTool icon="task" status="completed" trigger={<span data-testid="custom-trigger">Custom</span>} />
    ))
    await settle()
    assert.ok(root.querySelector('[data-testid="custom-trigger"]'))
    dispose()
  }
} finally {
  await win.happyDOM.cancelAsync()
  await win.happyDOM.close()
}
