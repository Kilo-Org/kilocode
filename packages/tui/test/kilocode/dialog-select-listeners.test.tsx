/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createSignal, onMount } from "solid-js"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("keeps renderer resize listeners stable when a row hides and shows a footer action", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  const config = createTuiResolvedConfig()
  const [
    { ConfigProvider },
    { ThemeProvider },
    { Keymap },
    { DialogProvider, useDialog },
    { DialogSelect },
    { ToastProvider },
  ] = await Promise.all([
    import("../../src/config"),
    import("../../src/context/theme"),
    import("../../src/context/keymap"),
    import("../../src/ui/dialog"),
    import("../../src/ui/dialog-select"),
    import("../../src/ui/toast"),
  ])

  function Harness() {
    const [selected, setSelected] = createSignal("add")

    function Fixture() {
      const dialog = useDialog()
      onMount(() =>
        dialog.replace(() => (
          <DialogSelect
            title="Accounts"
            renderFilter={false}
            options={[
              { title: "Add account", value: "add" },
              { title: "Personal", value: "personal" },
            ]}
            onMove={(option) => setSelected(option.value)}
            actions={[
              {
                command: "dialog.integration.rename",
                title: "rename",
                hidden: selected() === "add",
                onTrigger: () => {},
              },
            ]}
          />
        )),
      )
      return null
    }

    return (
      <TestTuiContexts directory={tmp.path} paths={{ home: tmp.path, state, worktree: tmp.path }}>
        <ConfigProvider config={config}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <Fixture />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 24, kittyKeyboard: true })
  app.renderer.start()

  try {
    await app.waitForFrame((frame) => frame.includes("Add account") && !frame.includes("rename"))
    const count = () =>
      (app.renderer as unknown as { listenerCount(event: string): number }).listenerCount("resize")
    const before = count()

    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("rename"))
    expect(count()).toBe(before)

    app.mockInput.pressArrow("up")
    await app.waitForFrame((frame) => !frame.includes("rename"))
    expect(count()).toBe(before)
  } finally {
    app.renderer.destroy()
  }
})