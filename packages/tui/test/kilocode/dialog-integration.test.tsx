/** @jsxImportSource @opentui/solid */
import type { IntegrationInfo } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogIntegration } from "../../src/component/dialog-integration"
import { failedDescription } from "../../src/kilocode/dialog-provider"
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
    const rows = lines(app.captureCharFrame(), [
      "Popular",
      "Services",
      "OpenAI / Codex",
      ...services.map((item) => item.name),
    ])
    expect(rows).toEqual([
      "Popular",
      "Kilo Gateway",
      "Anthropic",
      "OpenAI / Codex",
      "Services",
      "Mistral",
      "OpenCode Console",
      "OpenCode Go",
    ])
    // Kilo is preselected: enter opens its key prompt with the v1 hint.
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Kilo Gateway key") && frame.includes("https://kilo.ai/gateway"))
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

test("shows the v1 provider descriptions and titles", async () => {
  const app = await renderDialog(services)
  try {
    const frame = app.captureCharFrame()
    expect(frame).toMatch(/Kilo Gateway\s+\(Recommended\)/)
    expect(frame).toMatch(/Anthropic\s+\(Claude Max or API key\)/)
    expect(frame).toMatch(/OpenAI \/ Codex\s+\(ChatGPT login or API key\)/)
    expect(frame).not.toContain("!")
  } finally {
    app.renderer.destroy()
  }
})

test("shows the v1 failure detail and gutter when the Kilo catalog fails", async () => {
  const app = await renderDialog(services, { kind: "unauthorized", status: 401 })
  try {
    // The dialog width cuts the end of the reason.
    await app.waitForFrame((frame) => frame.includes("(Credentials rejected (HTTP 401)"))
    const row = app
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes("Kilo Gateway"))
    expect(row).toMatch(/!\s*Kilo Gateway\s+\(Credentials rejected \(HTTP 401\)/)
  } finally {
    app.renderer.destroy()
  }
})

test("connects LM Studio without a key, as v1", async () => {
  const keys: unknown[] = []
  const app = await renderDialog([integration("lmstudio", "LMStudio")], undefined, async (request) => {
    keys.push((await request.json()).key)
  })
  try {
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Optional for localhost"))
    app.mockInput.pressEnter()
    for (let attempt = 0; attempt < 200 && keys.length === 0; attempt++) await Bun.sleep(10)
    expect(keys).toEqual(["local"])
  } finally {
    app.renderer.destroy()
  }
})

test("keeps Environment only for a v1-described integration without connect methods", async () => {
  const app = await renderDialog([
    {
      id: "openai",
      name: "OpenAI",
      methods: [],
      connections: [{ type: "credential", method: "key", id: "cred_env_key", label: "OPENAI_API_KEY" }],
    },
  ])
  try {
    const row = app
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes("OpenAI / Codex"))
    expect(row).toContain("Environment only")
    expect(row).not.toContain("ChatGPT login or API key")
  } finally {
    app.renderer.destroy()
  }
})

test("maps each Kilo catalog failure to the v1 message", () => {
  expect(failedDescription(undefined)).toBeUndefined()
  expect(failedDescription({ kind: "unauthorized" })).toBe("(Credentials rejected - sign in again)")
  expect(failedDescription({ kind: "network" })).toBe("(Couldn't reach the provider - check your connection)")
  expect(failedDescription({ kind: "http", status: 503 })).toBe("(Provider error (HTTP 503))")
  expect(failedDescription({ kind: "schema" })).toBe("(Unexpected response from the provider)")
  expect(failedDescription({ kind: "organization_missing" })).toBe(
    "(Selected team is no longer available - use /teams)",
  )
})

// The visible rows that start with one of the names, in screen order.
function lines(frame: string, names: string[]) {
  return frame
    .split("\n")
    .map((line) => line.trim())
    .flatMap((line) => names.find((name) => line === name || line.startsWith(`${name} `)) ?? [])
}

async function renderDialog(
  list: IntegrationInfo[],
  failure?: { kind: string; status?: number },
  onKey?: (request: Request) => Promise<void>,
) {
  const calls = createFetch(async (url, request) => {
    const directory = url.searchParams.get("location[directory]") ?? process.cwd()
    const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
    if (url.pathname === "/api/integration") return json({ location, data: list })
    if (url.pathname === "/api/model" || url.pathname === "/api/provider") return json({ location, data: [] })
    if (url.pathname.endsWith("/connect/key") && onKey) {
      await onKey(request)
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/rpc/kilocode.gateway/models")
      return failure
        ? json({ _tag: "RpcError", type: "failed", message: "catalog failed", data: failure }, { status: 400 })
        : json({ output: [] })
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
  await app.waitForFrame((frame) => frame.includes(list[0].name))
  return app
}
