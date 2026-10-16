import assert from "node:assert/strict"
import { Window } from "happy-dom"

const win = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window: win,
  document: win.document,
  navigator: win.navigator,
  Node: win.Node,
  Element: win.Element,
  HTMLElement: win.HTMLElement,
  HTMLDivElement: win.HTMLDivElement,
  MutationObserver: win.MutationObserver,
  ResizeObserver: win.ResizeObserver,
  requestAnimationFrame: win.requestAnimationFrame.bind(win),
  cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  getComputedStyle: win.getComputedStyle.bind(win),
})

const { render } = await import("solid-js/web")
const { batch, createContext, createMemo, createSignal, For, onCleanup, onMount, useContext } = await import("solid-js")
const { Virtualizer } = await import("virtua/solid")
const { createRowHandoff } = await import("../../webview-ui/src/components/chat/transcript-row-handoff")
const Context = createContext("missing")
const [direct, setDirect] = createSignal(["one", "two"])
const [virtual, setVirtual] = createSignal<string[]>([])
const [text, setText] = createSignal("initial")
const [sid, setSid] = createSignal("first")
const mounts = new Map<string, number>()
const cleanups = new Map<string, number>()
const root = document.createElement("div")
document.body.append(root)
const settle = async () => {
  await Promise.resolve()
  await win.happyDOM.waitUntilComplete()
}

const View = () => {
  const handoff = createRowHandoff()
  const indexes = createMemo(() => new Map(virtual().map((key, index) => [key, index])))
  const Row = (props: { id: string }) => {
    const key = `${sid()}:${props.id}`
    return handoff(key, () => {
      const context = useContext(Context)
      onMount(() => mounts.set(key, (mounts.get(key) ?? 0) + 1))
      onCleanup(() => cleanups.set(key, (cleanups.get(key) ?? 0) + 1))
      return (
        <div data-row-key={props.id} data-index={indexes().get(props.id)} data-context={context}>
          <span>{text()}</span>
          <input value="retained input" />
        </div>
      ) as HTMLElement
    })
  }
  const scroll = document.createElement("div")
  return (
    <div ref={(el) => el.append(scroll)}>
      <Virtualizer
        data={virtual()}
        scrollRef={scroll}
        itemSize={28}
        bufferSize={520}
        keepMounted={virtual()
          .slice(0, 3)
          .map((_, index) => index)}
      >
        {(key) => <Row id={key} />}
      </Virtualizer>
      <For each={direct()}>{(key) => <Row id={key} />}</For>
    </div>
  )
}

const dispose = render(
  () => (
    <Context.Provider value="inherited">
      <View />
    </Context.Provider>
  ),
  root,
)
try {
  await settle()
  const one = root.querySelector<HTMLElement>('[data-row-key="one"]')!
  const input = one.querySelector("input")!
  input.value = "edited before handoff"
  assert.equal(one.dataset.context, "inherited")
  assert.equal(mounts.get("first:one"), 1)

  batch(() => {
    setVirtual(["one", "two"])
    setDirect([])
  })
  await settle()
  assert.ok(root.querySelector('[data-row-key="one"]') === one, "direct row survives virtualizer handoff")
  assert.equal(root.querySelectorAll('[data-row-key="one"]').length, 1)
  assert.ok(one.querySelector("input") === input)
  assert.equal(input.value, "edited before handoff")
  assert.equal(one.dataset.index, "0")
  assert.equal(mounts.get("first:one"), 1)
  assert.equal(cleanups.get("first:one"), undefined)

  setVirtual(["older", "one", "two"])
  setText("updated after handoff")
  await settle()
  assert.equal(one.dataset.index, "1")
  assert.equal(one.querySelector("span")?.textContent, "updated after handoff")

  // Reverse ownership order must also retain the existing root.
  batch(() => {
    setDirect(["one", "two"])
    setVirtual([])
  })
  await settle()
  assert.ok(root.querySelector('[data-row-key="one"]') === one, "virtual row survives direct handoff")
  assert.equal(one.dataset.index, undefined)
  assert.equal(cleanups.get("first:older"), 1)
  assert.equal(cleanups.get("first:one"), undefined)

  setDirect([])
  await settle()
  assert.equal(cleanups.get("first:one"), 1)
  assert.equal(cleanups.get("first:two"), 1)
  batch(() => {
    setSid("second")
    setDirect(["one"])
  })
  await settle()
  assert.ok(root.querySelector('[data-row-key="one"]') !== one)
  assert.equal(mounts.get("second:one"), 1)
  dispose()
  await settle()
  assert.equal(cleanups.get("second:one"), 1)
  assert.equal(cleanups.get("first:one"), 1)
} finally {
  dispose()
  await win.happyDOM.cancelAsync()
  await win.happyDOM.close()
}
