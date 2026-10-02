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
import { RouteProvider, useRoute } from "../../src/context/route"
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
import { createFetch, directory, eventSource, json } from "../fixture/tui-sdk"

const parent = {
  id: "ses_parent",
  slug: "parent",
  projectID: "proj_test",
  directory,
  title: "Parent",
  version: "test",
  time: { created: 1, updated: 1 },
}
const child = { ...parent, id: "ses_child", slug: "child", title: "Child", parentID: parent.id }

function message(sessionID: string) {
  return [
    {
      info: {
        id: `msg_${sessionID}`,
        sessionID,
        role: "user",
        agent: "build",
        model: { providerID: "test", modelID: "test" },
        time: { created: 1 },
      },
      parts: [{ id: `prt_${sessionID}`, sessionID, messageID: `msg_${sessionID}`, type: "text", text: "hello" }],
    },
  ]
}

async function mount(root: string) {
  await Bun.write(`${root}/kv.json`, JSON.stringify({ animations_enabled: false, sidebar: "hide", vim_enabled: false }))
  const aborts: string[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/session") return json([parent, child])
    if (url.pathname === "/session/status") return json({ [parent.id]: { type: "busy" }, [child.id]: { type: "busy" } })
    for (const item of [parent, child]) {
      if (url.pathname === `/session/${item.id}`) return json(item)
      if (url.pathname === `/session/${item.id}/message`) return json(message(item.id))
      if (url.pathname === `/session/${item.id}/abort`) {
        aborts.push(item.id)
        return json(true)
      }
      if ([`/session/${item.id}/todo`, `/session/${item.id}/diff`].includes(url.pathname)) return json([])
    }
    if (url.pathname.startsWith("/background-process/")) return json(true)
    return undefined
  })
  const config = createTuiResolvedConfig()
  const refs: {
    prompt?: ReturnType<typeof usePromptRef>
    sync?: ReturnType<typeof useSync>
    route?: ReturnType<typeof useRoute>
  } = {}

  function Ready() {
    const sync = useSync()
    refs.sync = sync
    return (
      <Show when={sync.status === "complete"}>
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
    refs.route = useRoute()
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
                    <RouteProvider initialRoute={{ type: "session", sessionID: parent.id }}>
                      <TuiConfigProvider config={config}>
                        <PluginRuntimeProvider value={runtime}>
                          <SDKProvider
                            url="http://test"
                            directory={directory}
                            fetch={calls.fetch}
                            events={eventSource()}
                          >
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

  const app = await testRender(() => <Harness />, { width: 80, height: 30, kittyKeyboard: true })
  await wait(() => !!refs.prompt?.current?.focused && refs.sync?.data.session_status?.[parent.id]?.type === "busy")
  await app.flush()
  return { app, refs, aborts }
}

test("Escape interrupts the parent session after returning from a child session", async () => {
  await using tmp = await tmpdir()
  const scene = await mount(tmp.path)
  try {
    scene.app.mockInput.pressKey("x", { ctrl: true })
    scene.app.mockInput.pressArrow("down")
    await wait(() => scene.refs.route?.data.type === "session" && scene.refs.route.data.sessionID === child.id)
    // The app evicts the previous session's store data on navigation.
    scene.refs.sync?.session.evict(parent.id)
    await scene.app.flush()
    scene.app.mockInput.pressArrow("up")
    await wait(() => scene.refs.route?.data.type === "session" && scene.refs.route.data.sessionID === parent.id)
    scene.refs.sync?.session.evict(child.id)
    await wait(() => !!scene.refs.prompt?.current?.focused)
    await scene.app.flush()
    scene.app.mockInput.pressEscape()
    await scene.app.flush()
    expect(scene.app.captureCharFrame()).toContain("again to interrupt")
    scene.app.mockInput.pressEscape()
    await wait(() => scene.aborts.length > 0)
    expect(scene.aborts).toEqual([parent.id])
  } finally {
    scene.app.renderer.destroy()
  }
})
