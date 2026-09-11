import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { capture } from "../../../kilo-ui/src/pierre/scroll"

function setup() {
  const window = new Window()
  const document = window.document as unknown as Document
  const root = document.createElement("div")
  const container = document.createElement("div")
  const host = document.createElement("diffs-container")
  document.body.append(root)
  root.append(container)
  container.append(host)
  const shadow = host.attachShadow({ mode: "open" })
  let height = 0
  root.scrollTop = 30
  root.getBoundingClientRect = () => new window.DOMRect(0, 0, 300, 100)
  container.getBoundingClientRect = () => new window.DOMRect(0, -root.scrollTop, 300, 200 + height)
  for (const index of [0, 1, 2]) {
    const node = document.createElement("div")
    node.dataset.line = String(index + 1)
    node.dataset.lineIndex = String(index)
    node.getBoundingClientRect = () =>
      new window.DOMRect(0, index * 20 + (index > 0 ? height : 0) - root.scrollTop, 300, 20)
    shadow.append(node)
  }
  return { root, container, resize: (value: number) => (height = value) }
}

describe("diff annotation scroll anchor", () => {
  it("keeps the visible line in place when annotations above it grow or disappear", () => {
    const view = setup()
    const move = (offset: number) => (view.root.scrollTop = offset)
    const added = capture(view.container, view.root, move)
    expect(added).toBeDefined()
    view.resize(100)
    added!()
    expect(view.root.scrollTop).toBe(130)

    const removed = capture(view.container, view.root, move)
    view.resize(0)
    removed!()
    expect(view.root.scrollTop).toBe(30)
  })

  it("does not override navigation or restore a detached diff", () => {
    const view = setup()
    const move = (offset: number) => (view.root.scrollTop = offset)
    const navigated = capture(view.container, view.root, move)
    view.resize(100)
    view.root.scrollTop = 75
    navigated!()
    expect(view.root.scrollTop).toBe(75)

    const detached = capture(view.container, view.root, move)
    view.container.remove()
    view.resize(200)
    detached!()
    expect(view.root.scrollTop).toBe(75)
  })
})
