// kilocode_change - new file
/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { BoxRenderable, InputRenderable } from "@opentui/core"
import { extend, testRender, useRenderer } from "@opentui/solid"
import { createSignal, type Signal } from "solid-js"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "@opencode-ai/tui/keymap"
import { RunCommandMenuBody } from "@/cli/cmd/run/footer.command"
import { RUN_THEME_FALLBACK, type RunFooterTheme } from "@/cli/cmd/run/theme"
import type { RunCommand } from "@/cli/cmd/run/types"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

extend({ spinner: BoxRenderable })

const tuiConfig = createTuiResolvedConfig()

function cmd(name: string): RunCommand {
  return { name, description: name, source: "command", template: "", hints: [] }
}

async function mountMenu(input: {
  onCommand?: (name: string) => void
  onEditor?: () => void
  onExit?: () => void
}) {
  let offKeymap: (() => void) | undefined
  let field: InputRenderable | undefined
  const theme: Signal<RunFooterTheme> = createSignal(RUN_THEME_FALLBACK.footer)
  const commandEvents: string[] = []

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    offKeymap = registerOpencodeKeymap(keymap, renderer, tuiConfig)
    const [commands] = createSignal<RunCommand[]>([cmd("practice"), cmd("prep"), cmd("lint"), cmd("build")])

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <RunCommandMenuBody
          theme={theme[0]}
          commands={commands}
          subagents={() => []}
          queued={() => []}
          variants={() => []}
          variantCycle=""
          onClose={() => {}}
          onModel={() => {}}
          onEditor={input.onEditor ?? (() => commandEvents.push("editor"))}
          onSkill={() => {}}
          onSubagent={() => {}}
          onQueued={() => {}}
          onVariant={() => {}}
          onVariantCycle={() => {}}
          onCommand={(name) => {
            commandEvents.push(name)
            input.onCommand?.(name)
          }}
          onNew={() => {}}
          onExit={input.onExit ?? (() => commandEvents.push("exit"))}
        />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 14, kittyKeyboard: true })

  return {
    app,
    get field() {
      return app.renderer.currentFocusedEditor as InputRenderable
    },
    commandEvents,
    cleanup() {
      app.renderer.currentFocusedRenderable?.blur()
      app.renderer.currentFocusedEditor?.blur()
      offKeymap?.()
      app.renderer.destroy()
    },
  }
}

test("home/end move the cursor while the run panel filter holds text", async () => {
  const menu = await mountMenu({})
  try {
    const field = menu.field
    expect(menu.app.renderer.currentFocusedEditor instanceof InputRenderable).toBe(true)
    expect(field.plainText).toBe("")

    await menu.app.mockInput.typeText("li", 0)
    expect(field.plainText).toBe("li")

    menu.app.mockInput.pressKey("END")
    expect(field.cursorOffset).toBe(2)

    menu.app.mockInput.pressKey("HOME")
    expect(field.cursorOffset).toBe(0)
  } finally {
    menu.cleanup()
  }
})

test("home/end still jump the run panel list while the filter is empty", async () => {
  const onEditor: string[] = []
  const onExit: string[] = []
  const menu = await mountMenu({
    onEditor: () => onEditor.push("ed"),
    onExit: () => onExit.push("ex"),
  })
  try {
    const field = menu.field
    expect(field.plainText).toBe("")

    // END jumps to the last entry (Exit); Enter picks it.
    menu.app.mockInput.pressKey("END")
    menu.app.mockInput.pressEnter()
    expect(onExit).toEqual(["ex"])

    // HOME jumps back to the first entry (Open editor); Enter picks it.
    menu.app.mockInput.pressKey("HOME")
    menu.app.mockInput.pressEnter()
    expect(onEditor).toEqual(["ed"])
  } finally {
    menu.cleanup()
  }
})