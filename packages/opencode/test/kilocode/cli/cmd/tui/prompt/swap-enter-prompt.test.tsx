/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { createEffect, onCleanup } from "solid-js"
import { Prompt } from "@tui/component/prompt"
import { resolve, TuiConfigProvider } from "@tui/config"
import { ArgsProvider } from "@tui/context/args"
import { DataProvider } from "@tui/context/data"
import { EditorContextProvider } from "@tui/context/editor"
import { ExitProvider } from "@tui/context/exit"
import { KVProvider } from "@tui/context/kv"
import { LocalProvider } from "@tui/context/local"
import { LocationProvider } from "@tui/context/location"
import { PermissionProvider } from "@tui/context/permission"
import { ProjectProvider } from "@tui/context/project"
import { RouteProvider } from "@tui/context/route"
import { SDKProvider } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { ThemeProvider } from "@tui/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "@tui/keymap"
import { FrecencyProvider } from "@tui/prompt/frecency"
import { PromptHistoryProvider } from "@tui/prompt/history"
import { PromptStashProvider } from "@tui/prompt/stash"
import { DialogProvider } from "@tui/ui/dialog"
import { ToastProvider } from "@tui/ui/toast"
import { NudgeProvider } from "@/kilocode/cli/cmd/tui/context/nudge"
import { tmpdir } from "../../../../../fixture/fixture"
import { TestTuiContexts } from "../../../../../fixture/tui-environment"
import { createEventSource, createFetch, directory, json } from "../../../../../../../tui/test/fixture/tui-sdk"

// Real Prompt wiring: these tests run against the production prompt component
// with a KVProvider seeded from an actual kv.json fixture, pinning the
// `kv.get(SWAP_ENTER_KV_KEY, tuiConfig.swap_enter ?? false)` expression,
// the composite blocked() guard and the layer registration order.

async function mountPrompt(root: string, kvSeed: Record<string, unknown>, configSwapEnter?: boolean) {
  await Bun.write(`${root}/kv.json`, JSON.stringify({ animations_enabled: false, ...kvSeed }))
  const calls: string[] = []
  const events = createEventSource()
  const transport = createFetch((url) => {
    calls.push(url.pathname)
    if (url.pathname === "/agent") return json([{ name: "code", mode: "primary", options: {}, permission: [] }])
    if (url.pathname === "/session") return json([{ id: "ses_goal", directory, title: "Goal", time: { created: 1, updated: 1 } }])
    if (url.pathname === "/project/proj_test/directory") return json([])
    return undefined
  }, events)
  const ready = Promise.withResolvers<{ sync: ReturnType<typeof useSync> }>()

  function Content() {
    const sync = useSync()
    createEffect(() => {
      if (sync.status === "complete") ready.resolve({ sync })
    })
    return <Prompt sessionID="ses_goal" />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = resolve({ swap_enter: configSwapEnter, vim: false }, { terminalSuspend: false })
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts paths={{ state: root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <ArgsProvider>
              <KVProvider>
                <RouteProvider>
                  <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                    <ToastProvider>
                      <ExitProvider exit={() => {}}>
                        <SDKProvider url="http://test" directory={directory} fetch={transport.fetch} events={events.source}>
                          <PermissionProvider>
                            <ProjectProvider>
                              <SyncProvider>
                                <DataProvider>
                                  <LocalProvider>
                                    <DialogProvider>
                                      <NudgeProvider>
                                        <FrecencyProvider>
                                        <PromptHistoryProvider>
                                          <PromptStashProvider>
                                            <EditorContextProvider integration={{}}>
                                              <LocationProvider>
                                                <Content />
                                              </LocationProvider>
                                            </EditorContextProvider>
                                          </PromptStashProvider>
                                        </PromptHistoryProvider>
                                      </FrecencyProvider>
                                    </NudgeProvider>
                                  </DialogProvider>
                                </LocalProvider>
                              </DataProvider>
                            </SyncProvider>
                          </ProjectProvider>
                        </PermissionProvider>
                      </SDKProvider>
                    </ExitProvider>
                  </ToastProvider>
                </ThemeProvider>
              </RouteProvider>
            </KVProvider>
          </ArgsProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 100, height: 24, kittyKeyboard: true })
  try {
    await ready.promise
    await app.renderOnce()
    // give the async KV fixture read time to land before key presses
    await Bun.sleep(200)
    const input = app.renderer.currentFocusedEditor
    if (!(input instanceof TextareaRenderable)) throw new Error("Prompt textarea is not focused")
    input.setText("draft")
    input.gotoBufferEnd()
    return { app, input, calls }
  } catch (err) {
    app.renderer.destroy()
    throw err
  }
}

test("real prompt with kv swap_enter_enabled true inserts newline on Enter", async () => {
  await using tmp = await tmpdir()
  const state = await mountPrompt(tmp.path, { swap_enter_enabled: true }, false)
  try {
    const before = state.calls.length
    state.app.mockInput.pressEnter()
    await Bun.sleep(100)
    // swapped: Enter is a newline, no network traffic from a submission
    expect(state.input.plainText).toBe("draft\n")
    expect(state.calls.slice(before)).toEqual([])
  } finally {
    state.app.renderer.destroy()
  }
})

test("real prompt honors kv false over swap_enter config default", async () => {
  await using tmp = await tmpdir()
  const state = await mountPrompt(tmp.path, { swap_enter_enabled: false }, true)
  try {
    state.app.mockInput.pressEnter()
    await Bun.sleep(100)
    // KV false wins over the config default true: the swap layer stays off,
    // so Enter must NOT have turned into a newline (it goes down the native
    // submit path, mocked transport swallows the submission error)
    expect(state.input.plainText).toBe("draft")
  } finally {
    state.app.renderer.destroy()
  }
})
