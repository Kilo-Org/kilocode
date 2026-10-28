/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { DialogMarketplace } from "../../src/kilocode/marketplace"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test.each(["light", "dark"] as const)(
  "production browser works with %s theme and keeps resize listeners stable",
  async (mode) => {
    await using temporary = await tmpdir()
    const client = createApi(
      createFetch(async (url, request) => {
        if (url.pathname.endsWith("/installed")) return json({ output: [] })
        if (url.pathname.endsWith("/list")) {
          const body = (await request.json()) as { input: { kind: string } }
          return json({
            output: {
              items: [
                {
                  registry: "kilo",
                  kind: body.input.kind,
                  id: body.input.kind,
                  name: `${body.input.kind} entry`,
                  description: `${body.input.kind} description`,
                  author: `${body.input.kind} author`,
                  tags: [],
                  prerequisites: [],
                  parameters: [],
                  options: [],
                },
              ],
              failures: [],
            },
          })
        }
      }).fetch,
    )
    function Open() {
      const dialog = useDialog()
      onMount(() =>
        dialog.replace(() => (
          <DialogMarketplace
            context={{ client, target: { directory }, signal: new AbortController().signal }}
            state={{ tab: "all", query: "", selected: "installed" }}
            onChoose={() => {}}
          />
        )),
      )
      return null
    }
    const app = await testRender(
      () => (
        <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
          <ConfigProvider config={createTuiResolvedConfig()}>
            <Keymap.Provider>
              <ThemeProvider mode={mode} source={emptyThemeSource}>
                <ToastProvider>
                  <DialogProvider>
                    <Open />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </Keymap.Provider>
          </ConfigProvider>
        </TestTuiContexts>
      ),
      { width: 120, height: 30, kittyKeyboard: true },
    )
    try {
      await app.waitForFrame((frame) => frame.includes("skill entry") && frame.includes("mcp entry"))
      const count = () => (app.renderer as unknown as { listenerCount(event: string): number }).listenerCount("resize")
      const before = count()
      app.mockInput.pressArrow("down")
      app.mockInput.pressArrow("down")
      await app.waitForFrame((frame) => frame.includes("skill author"))
      app.mockInput.pressArrow("down")
      await app.waitForFrame((frame) => frame.includes("mcp author"))
      expect(app.captureCharFrame()).not.toContain("● Installed")
      expect(count()).toBe(before)
      app.resize(70, 30)
      await app.waitForFrame((frame) => frame.includes("mcp entry") && !frame.includes("mcp author"))
      app.resize(120, 30)
      await app.waitForFrame((frame) => frame.includes("mcp author"))
      expect(count()).toBe(before)
    } finally {
      app.renderer.destroy()
    }
  },
)
