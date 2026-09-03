// kilocode_change - new file
/** @jsxImportSource @opentui/solid */
import { InputRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "./fixture/fixture"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { TestTuiContexts } from "./fixture/tui-environment"
import { DialogSelect, type DialogSelectOption } from "../src/ui/dialog-select"

async function wait(fn: () => boolean, timeout = 10000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("home/end keys move the text cursor in a dialog filter input", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { DialogProvider },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { ToastProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
  ] = await Promise.all([
    import("../src/ui/dialog"),
    import("../src/context/kv"),
    import("../src/context/theme"),
    import("../src/config"),
    import("../src/ui/toast"),
    import("../src/keymap"),
  ])

  const options: DialogSelectOption<string>[] = [
    { title: "Alpha", value: "alpha" },
    { title: "Beta", value: "beta" },
    { title: "Gamma", value: "gamma" },
  ]
  const moves: string[] = []

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts
        directory={tmp.path}
        paths={{
          home: tmp.path,
          state,
          worktree: tmp.path,
        }}
      >
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <DialogProvider>
                    <DialogSelect title="Pick one" options={options} onMove={(option) => moves.push(option.value)} />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />)
  try {
    await wait(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    const input = app.renderer.currentFocusedEditor
    if (!(input instanceof InputRenderable)) throw new Error("expected focused dialog filter input")
    expect(input.placeholder).toBe("Search")

    app.mockInput.pressKey("END")
    await app.flush()
    expect(moves.at(-1)).toBe("gamma")
    app.mockInput.pressKey("HOME")
    await app.flush()
    expect(moves.at(-1)).toBe("alpha")

    await app.mockInput.typeText("Alpha")
    await wait(() => input.plainText === "Alpha")
    await app.flush()
    await Bun.sleep(60)
    expect(input.cursorOffset).toBe(5)
    const beforeEditing = moves.length

    app.mockInput.pressArrow("left")
    await app.flush()
    expect(input.cursorOffset).toBe(4)

    app.mockInput.pressKey("END")
    await app.flush()
    expect(input.cursorOffset).toBe(5)
    expect(moves.length).toBe(beforeEditing)

    app.mockInput.pressKey("HOME")
    await app.flush()
    expect(input.cursorOffset).toBe(0)
    expect(moves.length).toBe(beforeEditing)
  } finally {
    app.renderer.destroy()
  }
})
