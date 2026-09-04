// kilocode_change - new file
/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import {
  KILO_BASE_MODE,
  OpencodeKeymapProvider,
  registerOpencodeKeymap,
  useBindings,
} from "../src/keymap"
import { sessionBindingCommands, sessionGlobalUnfocusedBindingCommands } from "../src/routes/session"

async function wait(fn: () => boolean, timeout = 5000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function mount(input: {
  extraBaseBindings?: ReturnType<ReturnType<typeof createTuiResolvedConfig>["keybinds"]["gather"]>
  firsts: number[]
  lasts?: number[]
}) {
  let area: TextareaRenderable | undefined
  let offKeymap: (() => void) | undefined

  function Layers() {
    const renderer = useRenderer()
    const config = createTuiResolvedConfig()
    useBindings(() => ({
      commands: [
        { name: "session.first", title: "First message", run: () => void input.firsts.push(1) },
        { name: "session.last", title: "Last message", run: () => void input.lasts?.push(1) },
      ],
    }))
    useBindings(() => ({
      mode: KILO_BASE_MODE,
      bindings: config.keybinds.gather("session", sessionBindingCommands),
    }))
    if (input.extraBaseBindings) {
      useBindings(() => ({
        mode: KILO_BASE_MODE,
        bindings: input.extraBaseBindings,
      }))
    }
    useBindings(() => ({
      enabled: () => renderer.currentFocusedEditor === null,
      bindings: config.keybinds.gather("session.global.unfocused", sessionGlobalUnfocusedBindingCommands),
    }))
    return null
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    offKeymap = registerOpencodeKeymap(keymap, renderer, config)

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <Layers />
        <textarea
          width={60}
          ref={(r: TextareaRenderable) => {
            area = r
            queueMicrotask(() => r.focus())
          }}
        />
      </OpencodeKeymapProvider>
    )
  }

  return testRender(() => <Harness />, { width: 80, height: 10, kittyKeyboard: true }).then((app) => ({
    app,
    get area() {
      return area
    },
    cleanup() {
      app.renderer.currentFocusedRenderable?.blur()
      app.renderer.currentFocusedEditor?.blur()
      offKeymap?.()
      app.renderer.destroy()
    },
  }))
}

test("home/end move the prompt cursor while session first/last stay gated to unfocused", async () => {
  const firsts: number[] = []
  const lasts: number[] = []
  const mountResult = await mount({ firsts, lasts })

  try {
    await wait(() => mountResult.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const editor = mountResult.area!
    await mountResult.app.mockInput.typeText("hello world", 0)
    expect(editor.plainText).toBe("hello world")
    expect(editor.cursorOffset).toBe(11)

    mountResult.app.mockInput.pressKey("HOME")
    expect(editor.cursorOffset).toBe(0)
    expect(firsts).toEqual([])

    mountResult.app.mockInput.pressKey("END")
    expect(editor.cursorOffset).toBe(11)
    expect(lasts).toEqual([])

    // Unfocus: home/end navigate to first/last message again.
    editor.blur()
    mountResult.app.mockInput.pressKey("HOME")
    mountResult.app.mockInput.pressKey("END")
    expect(firsts).toEqual([1])
    expect(lasts).toEqual([1])
  } finally {
    mountResult.cleanup()
  }
})

test("home/end bound in the always-on session layer are stolen from the prompt", async () => {
  const config = createTuiResolvedConfig()
  const extraBaseBindings = config.keybinds.gather("session", ["session.first"])
  const firsts: number[] = []
  const mountResult = await mount({ firsts, extraBaseBindings })

  try {
    await wait(() => mountResult.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const editor = mountResult.area!
    await mountResult.app.mockInput.typeText("hello world", 0)
    expect(editor.cursorOffset).toBe(11)

    mountResult.app.mockInput.pressKey("HOME")
    expect(firsts).toEqual([1])
    expect(editor.cursorOffset).toBe(11)
  } finally {
    mountResult.cleanup()
  }
})