/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount, type JSX } from "solid-js"
import { DialogMcp } from "../../src/component/dialog-mcp"
import { DialogStatus } from "../../src/component/dialog-status"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { LocationProvider } from "../../src/context/location"
import { RouteProvider } from "../../src/context/route"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { createApi, createEventStream, createFetch, json } from "../fixture/tui-client"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const reason = "Not on your organization's MCP allowlist"

test.each(["enter", "space"])("%s on a blocked MCP server shows why it is blocked and never connects", async (key) => {
  const fixture = await renderBlocked(() => <DialogMcp />)

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("Blocked ⊘"))
    expect(fixture.app.captureCharFrame()).toContain("view reason")
    expect(fixture.app.captureCharFrame()).not.toContain("view error")
    if (key === "enter") fixture.app.mockInput.pressEnter()
    else fixture.app.mockInput.pressKey(" ")
    await fixture.app.waitForFrame((frame) => frame.includes("MCP server: linear") && frame.includes(reason))

    expect(fixture.connect).toBe(0)
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("the status dialog names the reason a server is blocked", async () => {
  const fixture = await renderBlocked(() => <DialogStatus />)

  try {
    // The reason wraps, so the frame is checked in the two pieces the line breaks between.
    await fixture.app.waitForFrame((frame) => frame.includes("Blocked: Not on your organization's") && frame.includes("allowlist"))
  } finally {
    fixture.app.renderer.destroy()
  }
})

async function renderBlocked(dialogContent: () => JSX.Element) {
  const events = createEventStream()
  let connect = 0
  const calls = createFetch((url, request) => {
    const location = {
      directory: process.cwd(),
      project: { id: "proj_test", directory: process.cwd(), canonical: process.cwd() },
    }
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/mcp")
      return json({ location, data: [{ name: "linear", status: { status: "blocked", reason } }] })
    if (url.pathname === "/api/integration") return json({ location, data: [] })
    if (url.pathname === "/api/experimental/mcp/linear/connect" && request.method === "POST") {
      connect++
      return new Response(null, { status: 204 })
    }
    return undefined
  }, events)

  function Probe() {
    const data = useData()
    const dialog = useDialog()
    onMount(() => {
      void Promise.all([data.location.mcp.server.sync(), data.location.integration.sync()]).then(() =>
        dialog.replace(dialogContent),
      )
    })
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
              <RouteProvider initialRoute={{ type: "session", sessionID: "ses_existing" }}>
                <ClientProvider api={createApi(calls.fetch)}>
                  <DataProvider directory={process.cwd()}>
                    <LocationProvider>
                      <ThemeProvider mode="dark" source={emptyThemeSource}>
                        <DialogProvider>
                          <Probe />
                        </DialogProvider>
                      </ThemeProvider>
                    </LocationProvider>
                  </DataProvider>
                </ClientProvider>
              </RouteProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  return {
    app,
    get connect() {
      return connect
    },
  }
}
