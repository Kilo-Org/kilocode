import { createTestRenderer } from "@opentui/core/testing"
import {
  attributesWithLink,
  getLinkId,
  link,
  t,
  TextAttributes,
  TextRenderable,
  type MouseEvent,
  type OptimizedBuffer,
} from "@opentui/core"
import { expect, test } from "bun:test"
import {
  installLinkInteractions,
  isOpenableLink,
  type LinkRenderer,
  type LinkOpener,
} from "../../src/kilocode/link-interactions"

function event(input: Partial<MouseEvent>): MouseEvent {
  return {
    type: "move",
    button: 0,
    x: 0,
    y: 0,
    modifiers: { shift: false, alt: false, ctrl: false },
    target: null,
    currentTarget: null,
    preventDefault() {},
    stopPropagation() {},
    get defaultPrevented() {
      return false
    },
    get propagationStopped() {
      return false
    },
    ...input,
  } as MouseEvent
}

function setup(url = "https://example.com", opener?: LinkOpener) {
  const root: LinkRenderer["root"] = { onMouse: undefined }
  const attributes = new Uint32Array([attributesWithLink(0, 7), 0])
  const pointers: string[] = []
  const notices: string[] = []
  const opened: string[] = []
  let post: ((buffer: OptimizedBuffer, deltaTime: number) => void) | undefined
  let selected = ""
  const renderer: LinkRenderer = {
    root,
    getLinkIdAt: (x, y) => (x === 0 && y === 0 ? 7 : 0),
    getLinkAt: (x, y) => (x === 0 && y === 0 ? url : null),
    setMousePointer: (pointer) => pointers.push(pointer),
    requestRender: () => {},
    addPostProcessFn: (fn) => {
      post = fn
    },
    removePostProcessFn: (fn) => {
      if (post === fn) post = undefined
    },
    getSelection: () => (selected ? { getSelectedText: () => selected } : null),
    clearSelection: () => {
      selected = ""
    },
  }
  const dispose = installLinkInteractions(
    renderer,
    (message) => notices.push(message),
    opener ??
      (async (value) => {
        opened.push(value)
      }),
    0,
  )
  return {
    renderer,
    attributes,
    pointers,
    notices,
    opened,
    get post() {
      return post
    },
    set selected(value: string) {
      selected = value
    },
    dispose,
  }
}

test("opens the link under a completed click and underlines its cells", async () => {
  const state = setup()
  const move = event({ type: "move" })
  state.renderer.root.onMouse?.(move)
  state.post?.({ buffers: { attributes: state.attributes } } as OptimizedBuffer, 0)

  expect(state.pointers).toEqual(["pointer"])
  expect(getLinkId(state.attributes[0]!)).toBe(7)
  expect(state.attributes[0]! & TextAttributes.UNDERLINE).toBe(TextAttributes.UNDERLINE)

  state.renderer.root.onMouse?.(event({ type: "down" }))
  state.renderer.root.onMouse?.(event({ type: "up" }))
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(state.opened).toEqual(["https://example.com"])
  expect(state.notices).toEqual([])
  state.dispose()
})

test("opens a link from the real OpenTUI render buffer", async () => {
  const setup = await createTestRenderer({ width: 40, height: 8, useThread: false })
  setup.renderer.root.add(
    new TextRenderable(setup.renderer, {
      content: t`${link("https://example.com")("Label")}`,
      width: 20,
      height: 2,
    }),
  )
  await setup.flush()

  const opened: string[] = []
  const dispose = installLinkInteractions(
    setup.renderer,
    () => {},
    async (url) => {
      opened.push(url)
    },
    0,
  )
  await setup.mockMouse.click(1, 0)
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(opened).toEqual(["https://example.com"])
  dispose()
  setup.renderer.destroy()
})

test("does not open after a drag or a double click", async () => {
  const state = setup()
  state.renderer.root.onMouse?.(event({ type: "down" }))
  state.renderer.root.onMouse?.(event({ type: "drag", x: 1 }))
  state.renderer.root.onMouse?.(event({ type: "up", x: 1 }))

  state.renderer.root.onMouse?.(event({ type: "down" }))
  state.renderer.root.onMouse?.(event({ type: "up" }))
  state.renderer.root.onMouse?.(event({ type: "down" }))
  state.renderer.root.onMouse?.(event({ type: "up" }))
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(state.opened).toEqual([])
  state.dispose()
})

test("does not open while text is selected", async () => {
  const state = setup()
  state.selected = "selected text"
  state.renderer.root.onMouse?.(event({ type: "down" }))
  state.renderer.root.onMouse?.(event({ type: "up" }))
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(state.opened).toEqual([])
  state.dispose()
})

test("rejects unsafe link targets and reports opener failures", async () => {
  expect(isOpenableLink("https://example.com")).toBe(true)
  expect(isOpenableLink("mailto:user@example.com")).toBe(false)
  expect(isOpenableLink("https://example.com/\u0000")).toBe(false)

  const unsafe = setup("javascript:alert(1)")
  unsafe.renderer.root.onMouse?.(event({ type: "down" }))
  unsafe.renderer.root.onMouse?.(event({ type: "up" }))
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(unsafe.opened).toEqual([])
  expect(unsafe.notices).toEqual(["Only HTTP(S) links can be opened from the CLI"])
  unsafe.dispose()

  const failed = setup("https://example.com", async () => {
    throw new Error("failed")
  })
  failed.renderer.root.onMouse?.(event({ type: "down" }))
  failed.renderer.root.onMouse?.(event({ type: "up" }))
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(failed.notices).toEqual(["Could not open the link in the default browser"])
  failed.dispose()
})
