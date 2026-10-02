/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal, onCleanup } from "solid-js"
import { resolve, TuiConfigProvider } from "@tui/config"
import {
  OpencodeKeymapProvider,
  registerOpencodeKeymap,
  useBindings,
  useOpencodeModeStack,
} from "@tui/keymap"
import { tmpdir } from "../../../../../fixture/fixture"
import { TestTuiContexts } from "../../../../../fixture/tui-environment"
import { swapEnterToggleCommand, useSwapEnter } from "@/kilocode/cli/cmd/tui/component/prompt/swap-enter"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountSwapHarness(input: { root: string; swap: boolean }) {
  const submitted: string[] = []
  let target: TextareaRenderable | undefined
  // terminalSuspend false keeps ctrl+z out of the input undo defaults
  const config = resolve({ swap_enter: input.swap }, { terminalSuspend: false })

  function Editor() {
    const [textarea, setTextarea] = createSignal<TextareaRenderable | undefined>()
    useSwapEnter({
      target: textarea,
      blocked: () => false,
      enabled: () => config.swap_enter === true,
    })
    return (
      <textarea
        height={3}
        placeholder="test"
        ref={(r: TextareaRenderable) => {
          target = r
          setTextarea(r)
          r.focus()
        }}
        onSubmit={() => submitted.push(target?.plainText ?? "")}
      />
    )
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts directory={input.root} paths={{ state: input.root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <Editor />
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  return {
    app,
    textarea: () => target,
    submitted,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

test("swap enabled: Enter inserts a newline and Ctrl+Enter submits", async () => {
  await using tmp = await tmpdir()
  const mount = await mountSwapHarness({ root: tmp.path, swap: true })

  try {
    await wait(() => mount.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = mount.textarea()
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused textarea")

    textarea.insertText("hello")
    mount.app.mockInput.pressEnter()
    await wait(() => textarea.plainText.includes("\n"))
    expect(mount.submitted).toEqual([])

    mount.app.mockInput.pressEnter({ ctrl: true })
    await wait(() => mount.submitted.length > 0)
    // exactly one newline: the submit must not also fall through to the
    // default ctrl+return newline binding on the global input layer
    expect(textarea.plainText).toBe("hello\n")
  } finally {
    await mount.cleanup()
  }
})

test("swap disabled: Enter submits and Ctrl+Enter inserts a newline", async () => {
  await using tmp = await tmpdir()
  const mount = await mountSwapHarness({ root: tmp.path, swap: false })

  try {
    await wait(() => mount.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = mount.textarea()
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused textarea")

    textarea.insertText("hello")
    mount.app.mockInput.pressEnter()
    await wait(() => mount.submitted.length > 0)
    expect(mount.submitted).toEqual(["hello"])

    mount.app.mockInput.pressEnter({ ctrl: true })
    await wait(() => textarea.plainText.includes("\n"))
    // exactly one newline: the default ctrl+return newline binding must not
    // fire twice or fall through to anything else
    expect(textarea.plainText).toBe("hello\n")
  } finally {
    await mount.cleanup()
  }
})

test("swap layer keeps losing to a later overlay layer after enables flip", async () => {
  await using tmp = await tmpdir()
  const selections: number[] = []
  let target: TextareaRenderable | undefined
  const swapSignal = createSignal(true)

  function Overlay() {
    useBindings(() => ({
      target: () => target,
      enabled: () => target !== undefined,
      // Deliberately no mode push: order alone must keep this layer above the
      // swap layer, the way a later-registered targeted layer is expected to.
      bindings: [
        {
          key: "return",
          cmd: () => {
            selections.push(1)
            return true
          },
        },
      ],
    }))
    return null
  }

  function Editor() {
    const [textarea, setTextarea] = createSignal<TextareaRenderable | undefined>()
    useSwapEnter({
      target: textarea,
      blocked: () => false,
      enabled: () => swapSignal[0](),
    })
    return (
      <textarea
        height={3}
        ref={(r: TextareaRenderable) => {
          target = r
          setTextarea(r)
          r.focus()
        }}
      />
    )
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = resolve({ swap_enter: true }, { terminalSuspend: false })
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts directory={tmp.path} paths={{ state: tmp.path }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <Editor />
            <Overlay />
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })

  try {
    await wait(() => target !== undefined)

    for (const next of [false, true, false, true]) {
      swapSignal[1](next)
      await Bun.sleep(10)
      app.mockInput.pressEnter()
      await Bun.sleep(10)
    }

    // every Enter must go to the overlay (autocomplete-like) layer, never to
    // the swap layer's newline, even though the swap layer's enable reads flip
    expect(selections.length).toBe(4)
  } finally {
    app.renderer.destroy()
  }
})

test("swap layer is suppressed while an overlay pushes a mode", async () => {
  await using tmp = await tmpdir()
  const submitted: string[] = []
  let target: TextareaRenderable | undefined
  let popMode: (() => void) | undefined

  function Overlay() {
    popMode = useOpencodeModeStack().push("swap-test-overlay")
    return null
  }

  function Editor() {
    const [textarea, setTextarea] = createSignal<TextareaRenderable | undefined>()
    useSwapEnter({
      target: textarea,
      blocked: () => false,
      enabled: () => true,
    })
    return (
      <textarea
        height={3}
        ref={(r: TextareaRenderable) => {
          target = r
          setTextarea(r)
          r.focus()
        }}
        onSubmit={() => submitted.push(target?.plainText ?? "")}
      />
    )
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = resolve({ swap_enter: true }, { terminalSuspend: false })
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts directory={tmp.path} paths={{ state: tmp.path }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <Editor />
            <Overlay />
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })

  try {
    await wait(() => target !== undefined && popMode !== undefined)
    const textarea = target!
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused textarea")

    textarea.insertText("hello")
    // overlay mode is active: the swap layer must be suppressed and the
    // default Enter-to-submit semantics apply
    app.mockInput.pressEnter()
    await wait(() => submitted.length > 0)
    expect(submitted).toEqual(["hello"])
    expect(textarea.plainText).toBe("hello")

    // popping the overlay mode restores the swapped semantics
    popMode?.()
    app.mockInput.pressEnter()
    await wait(() => textarea.plainText.includes("\n"))
    expect(textarea.plainText).toBe("hello\n")
  } finally {
    app.renderer.destroy()
  }
})

test("swap layer registered disabled starts obeying swap on an enable flip", async () => {
  await using tmp = await tmpdir()
  const submitted: string[] = []
  let target: TextareaRenderable | undefined
  const [swapOn, setSwapOn] = createSignal(false)

  function Editor() {
    const [textarea, setTextarea] = createSignal<TextareaRenderable | undefined>()
    useSwapEnter({
      target: textarea,
      blocked: () => false,
      enabled: () => swapOn(),
    })
    return (
      <textarea
        height={3}
        ref={(r: TextareaRenderable) => {
          target = r
          setTextarea(r)
          r.focus()
        }}
        onSubmit={() => submitted.push(target?.plainText ?? "")}
      />
    )
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = resolve({ swap_enter: true }, { terminalSuspend: false })
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts directory={tmp.path} paths={{ state: tmp.path }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <Editor />
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })

  try {
    await wait(() => target !== undefined)
    const textarea = target!
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused textarea")

    textarea.insertText("hello")

    // registered while disabled: native Enter-to-submit applies
    app.mockInput.pressEnter()
    await wait(() => submitted.length > 0)
    expect(textarea.plainText).toBe("hello")

    // mid-session enable flip is honored without re-registration
    setSwapOn(true)
    await Bun.sleep(10)
    app.mockInput.pressEnter()
    await wait(() => textarea.plainText.includes("\n"))
    expect(textarea.plainText).toBe("hello\n")

    app.mockInput.pressEnter({ ctrl: true })
    await wait(() => submitted.length > 1)
    expect(submitted.length).toBe(2)
  } finally {
    app.renderer.destroy()
  }
})

test("swap toggle command flips state and reports the change", () => {
  let value = false
  const toasts: string[] = []
  let cleared = 0

  const command = swapEnterToggleCommand({
    swapEnabled: () => value,
    setSwapEnabled: (next) => (value = next),
    clearDialog: () => cleared++,
    showToast: (message) => toasts.push(message),
  })

  expect(command.title).toBe("Use Enter for a new line")
  command.run()
  expect(value).toBe(true)
  expect(cleared).toBe(1)
  expect(toasts).toEqual(["Enter inserts a newline, Ctrl+Enter submits"])
  expect(command.title).toBe("Use Enter to send")

  command.run()
  expect(value).toBe(false)
  expect(toasts[1]).toBe("Enter submits")
})
