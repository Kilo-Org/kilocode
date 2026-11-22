import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createSlot, createSolidSlotRegistry, testRender, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, Show } from "solid-js"
import { NudgeProvider } from "../../../opencode/src/kilocode/cli/cmd/tui/context/nudge"
import { TuiConfigProvider } from "../../src/config"
import { ArgsProvider } from "../../src/context/args"
import { ClipboardProvider } from "../../src/context/clipboard"
import { DataProvider } from "../../src/context/data"
import { EditorContextProvider } from "../../src/context/editor"
import { EpilogueProvider } from "../../src/context/epilogue"
import { ExitProvider } from "../../src/context/exit"
import { KVProvider } from "../../src/context/kv"
import { LocalProvider } from "../../src/context/local"
import { LocationProvider } from "../../src/context/location"
import { PermissionProvider } from "../../src/context/permission"
import { ProjectProvider } from "../../src/context/project"
import { PromptRefProvider, usePromptRef } from "../../src/context/prompt"
import { RouteProvider } from "../../src/context/route"
import { TuiTerminalEnvironmentProvider } from "../../src/context/runtime"
import { SDKProvider } from "../../src/context/sdk"
import { SyncProvider, useSync } from "../../src/context/sync"
import { ThemeProvider } from "../../src/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { createPluginRuntime, PluginRuntimeProvider } from "../../src/plugin/runtime"
import { FrecencyProvider } from "../../src/prompt/frecency"
import { PromptHistoryProvider } from "../../src/prompt/history"
import { PromptStashProvider } from "../../src/prompt/stash"
import { Session } from "../../src/routes/session"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { wait } from "../cli/cmd/tui/sync-fixture"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

const sessionID = "ses_redo_order"

// Conversational order is the array order. Order comes from position in this
// list, so the tests below read the resulting request rather than any id.
const conversation = [
  { id: "msg_ff0cb2300001Z6YIo5V52u114f", role: "user" as const, created: 1 },
  { id: "msg_ff0cb2300002Z6YIo5V52u114f", role: "assistant" as const, created: 2 },
  { id: "msg_019f1d3da001955TwEJ8qKEbj3", role: "user" as const, created: 3 },
  { id: "msg_019f1d3da002955TwEJ8qKEbj3", role: "assistant" as const, created: 4 },
  { id: "msg_010000000003955TwEJ8qKEbj3", role: "user" as const, created: 5 },
  { id: "msg_010000000004955TwEJ8qKEbj3", role: "assistant" as const, created: 6 },
]

type Request = { path: string; body: unknown }

function info(item: (typeof conversation)[number]) {
  const base = {
    id: item.id,
    sessionID,
    role: item.role,
    time: { created: item.created },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
  }
  if (item.role === "user") return base
  return {
    ...base,
    parentID: conversation[0]!.id,
    mode: "build",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: item.created, completed: item.created + 1 },
  }
}

async function mount(root: string, boundary: string) {
  await Bun.write(`${root}/kv.json`, JSON.stringify({ animations_enabled: false, sidebar: "hide", vim_enabled: false }))
  const session = {
    id: sessionID,
    slug: "redo-order",
    projectID: "proj_test",
    directory,
    title: "Redo ordering",
    version: "test",
    time: { created: 1, updated: 6 },
    revert: { messageID: boundary },
  }
  const messages = conversation.map((item) => ({
    info: info(item),
    parts: [
      {
        id: `prt_${item.id}`,
        sessionID,
        messageID: item.id,
        type: "text",
        text: `Row ${item.created}`,
      },
    ],
  }))
  const requests: Request[] = []
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/session") return json([session])
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) return json(messages)
    if ([`/session/${sessionID}/todo`, `/session/${sessionID}/diff`, "/session/status"].includes(url.pathname))
      return json([])
    if (url.pathname.startsWith("/background-process/")) return json(true)
    return undefined
  }, events)
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (init?.method === "POST" || input instanceof Request) {
      const raw = input instanceof Request ? await input.clone().text() : await new Response(init?.body).text()
      if (url.pathname.endsWith("/revert") || url.pathname.endsWith("/unrevert")) {
        requests.push({ path: url.pathname, body: raw ? JSON.parse(raw) : undefined })
      }
    }
    return calls.fetch(input, init)
  }) as typeof globalThis.fetch

  const config = createTuiResolvedConfig()
  const refs: { sync?: ReturnType<typeof useSync>; prompt?: ReturnType<typeof usePromptRef> } = {}

  function Ready() {
    refs.sync = useSync()
    return (
      <Show when={refs.sync.status === "complete"}>
        <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
          <LocalProvider>
            <PromptStashProvider>
              <DialogProvider>
                <NudgeProvider>
                  <FrecencyProvider>
                    <PromptHistoryProvider>
                      <PromptRefProvider>
                        <EditorContextProvider integration={{}}>
                          <LocationProvider>
                            <Content />
                          </LocationProvider>
                        </EditorContextProvider>
                      </PromptRefProvider>
                    </PromptHistoryProvider>
                  </FrecencyProvider>
                </NudgeProvider>
              </DialogProvider>
            </PromptStashProvider>
          </LocalProvider>
        </ThemeProvider>
      </Show>
    )
  }

  function Content() {
    refs.prompt = usePromptRef()
    const dimensions = useTerminalDimensions()
    return (
      <box width={dimensions().width} height={dimensions().height} flexDirection="column">
        <box flexGrow={1} minHeight={0} flexDirection="column">
          <Session />
        </box>
      </box>
    )
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const runtime = {
      ...createPluginRuntime(),
      Slot: createSlot(createSolidSlotRegistry<Record<string, object>>(renderer, {})),
    }
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts directory={root} paths={{ home: root, state: root, worktree: root }}>
        <TuiTerminalEnvironmentProvider value={{ platform: process.platform }}>
          <ClipboardProvider value={{}}>
            <OpencodeKeymapProvider keymap={keymap}>
              <ArgsProvider>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider initialRoute={{ type: "session", sessionID }}>
                      <TuiConfigProvider config={config}>
                        <PluginRuntimeProvider value={runtime}>
                          <SDKProvider url="http://test" directory={directory} fetch={fetch} events={events.source}>
                            <PermissionProvider>
                              <ProjectProvider>
                                <ExitProvider
                                  exit={() => {
                                    throw new Error("Unexpected exit")
                                  }}
                                >
                                  <EpilogueProvider set={() => {}}>
                                    <SyncProvider>
                                      <DataProvider>
                                        <Ready />
                                      </DataProvider>
                                    </SyncProvider>
                                  </EpilogueProvider>
                                </ExitProvider>
                              </ProjectProvider>
                            </PermissionProvider>
                          </SDKProvider>
                        </PluginRuntimeProvider>
                      </TuiConfigProvider>
                    </RouteProvider>
                  </ToastProvider>
                </KVProvider>
              </ArgsProvider>
            </OpencodeKeymapProvider>
          </ClipboardProvider>
        </TuiTerminalEnvironmentProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 100, height: 40 })
  try {
    await wait(() => refs.sync?.data.message[sessionID]?.length === conversation.length)
    await wait(() => !!refs.prompt?.current)
    await Bun.sleep(60)
    await app.flush()
    return {
      app,
      requests,
      async redo() {
        app.mockInput.pressKey("x", { ctrl: true })
        await app.flush()
        app.mockInput.pressKey("r")
        await app.flush()
      },
      async capture(text: string, timeout = 4000) {
        const start = Date.now()
        let frame = app.captureCharFrame()
        while (!frame.includes(text)) {
          if (Date.now() - start > timeout) throw new Error(`timed out waiting for "${text}" in frame:\n${frame}`)
          await app.renderOnce()
          await Bun.sleep(10)
          frame = app.captureCharFrame()
        }
        return frame
      },
      [Symbol.dispose]() {
        app.renderer.destroy()
      },
    }
  } catch (error) {
    app.renderer.destroy()
    throw error
  }
}

test("redo advances the boundary to the next user message in conversation order", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path, conversation[0]!.id)
  await scene.redo()
  await wait(() => scene.requests.length > 0)
  expect(scene.requests).toEqual([
    { path: `/session/${sessionID}/revert`, body: { messageID: conversation[2]!.id } },
  ])
})

test("redo restores the session when the boundary is the newest user message", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path, conversation[4]!.id)
  await scene.redo()
  await wait(() => scene.requests.length > 0)
  expect(scene.requests).toEqual([{ path: `/session/${sessionID}/unrevert`, body: undefined }])
})

test("redo reports an absent boundary and changes nothing", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path, "msg_000000000000detached")
  await scene.redo()
  // The toast wraps at this width, so match the stable opening phrase.
  await scene.capture("Cannot redo:")
  expect(scene.requests).toEqual([])
})
