/** @jsxImportSource @opentui/solid */
import type { IntegrationInfo } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogIntegration } from "../../src/component/dialog-integration"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { LocationProvider } from "../../src/context/location"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource } from "../fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const integration = (id: string, name: string, metadata?: IntegrationInfo["metadata"]): IntegrationInfo => ({
  id,
  name,
  methods: [{ type: "key", label: `${name} key` }],
  connections: [],
  ...(metadata ? { metadata } : {}),
})

const services = [
  integration("opencode-go", "OpenCode Go"),
  integration("mistral", "Mistral"),
  integration("openai", "OpenAI"),
  integration("opencode", "OpenCode Console"),
  integration("anthropic", "Anthropic"),
  integration("kilo", "Kilo Gateway"),
]

test("lists Kilo first under Popular and OpenCode under Services, as v1", async () => {
  const app = await renderDialog(services)
  try {
    const rows = lines(app.captureCharFrame(), ["Popular", "Services", ...services.map((item) => item.name)])
    expect(rows).toEqual([
      "Popular",
      "Kilo Gateway",
      "Anthropic",
      "OpenAI",
      "Services",
      "Mistral",
      "OpenCode Console",
      "OpenCode Go",
    ])
    // Kilo is preselected: enter opens its key prompt.
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Kilo Gateway key"))
  } finally {
    app.renderer.destroy()
  }
})

test("keeps MCP integrations in their own group above Popular", async () => {
  const app = await renderDialog([...services, integration("linear", "Linear", { source: "mcp" })])
  try {
    expect(lines(app.captureCharFrame(), ["MCP", "Popular", "Linear", "Kilo Gateway"])).toEqual([
      "MCP",
      "Linear",
      "Popular",
      "Kilo Gateway",
    ])
  } finally {
    app.renderer.destroy()
  }
})

// The visible rows that start with one of the names, in screen order.
function lines(frame: string, names: string[]) {
  return frame
    .split("\n")
    .map((line) => line.trim())
    .flatMap((line) => names.find((name) => line === name || line.startsWith(`${name} `)) ?? [])
}

async function renderDialog(list: IntegrationInfo[]) {
  const calls = createFetch(async (url, request) => {
    const directory = url.searchParams.get("location[directory]") ?? process.cwd()
    const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
    if (url.pathname === "/api/integration") return json({ location, data: list })
    if (url.pathname === "/api/model" || url.pathname === "/api/provider") return json({ location, data: [] })
    return undefined
  }, createEventStream())

  function Probe() {
    const data = useData()
    const dialog = useDialog()
    onMount(() => {
      void data.location.integration.sync().then(() => dialog.replace(() => <DialogIntegration />))
    })
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
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
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 40, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Kilo Gateway"))
  return app
}
