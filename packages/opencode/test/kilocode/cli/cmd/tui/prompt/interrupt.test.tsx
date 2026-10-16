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
import { OpencodeKeymapProvider, registerOpencodeKeymap, useOpencodeKeymap } from "@tui/keymap"
import { FrecencyProvider } from "@tui/prompt/frecency"
import { PromptHistoryProvider } from "@tui/prompt/history"
import { PromptStashProvider } from "@tui/prompt/stash"
import { DialogProvider } from "@tui/ui/dialog"
import { ToastProvider } from "@tui/ui/toast"
import { NudgeProvider } from "@/kilocode/cli/cmd/tui/context/nudge"
import { tmpdir } from "../../../../../fixture/fixture"
import { TestTuiContexts } from "../../../../../fixture/tui-environment"
import { createEventSource, createFetch, directory, json } from "../../../../../../../tui/test/fixture/tui-sdk"

async function mount(root: string, vim = true) {
  await Bun.write(`${root}/kv.json`, JSON.stringify({ animations_enabled: false }))
  const calls: string[] = []
  const aborted = Promise.withResolvers<void>()
  const events = createEventSource()
  const transport = createFetch((url) => {
    if (url.pathname === "/agent") return json([{ name: "code", mode: "primary", options: {}, permission: [] }])
    if (url.pathname === "/session") {
      return json([{ id: "ses_goal", directory, title: "Goal", time: { created: 1, updated: 1 } }])
    }
    if (url.pathname === "/session/ses_goal/abort") {
      calls.push(url.pathname)
      aborted.resolve()
      return json(true)
    }
    if (url.pathname === "/project/proj_test/directory") return json([])
    return undefined
  }, events)
  const ready = Promise.withResolvers<{
    sync: ReturnType<typeof useSync>
    keymap: ReturnType<typeof useOpencodeKeymap>
  }>()

  function Content() {
    const sync = useSync()
    const keymap = useOpencodeKeymap()
    createEffect(() => {
      if (sync.status === "complete") ready.resolve({ sync, keymap })
    })
    return <Prompt sessionID="ses_goal" />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = resolve({ vim }, { terminalSuspend: false })
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
                        <SDKProvider
                          url="http://test"
                          directory={directory}
                          fetch={transport.fetch}
                          events={events.source}
                        >
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
    const { sync, keymap } = await ready.promise
    await app.renderOnce()
    const input = app.renderer.currentFocusedEditor
    if (!(input instanceof TextareaRenderable)) throw new Error("Prompt textarea is not focused")
    input.setText("draft")
    input.gotoBufferEnd()
    return { app, sync, keymap, input, calls, aborted: aborted.promise }
  } catch (err) {
    app.renderer.destroy()
    throw err
  }
}

test.each(["insert", "visual", "visual-line"])(
  "idle goal Escape leaves Vim %s before double-Escape pauses",
  async (mode) => {
    await using tmp = await tmpdir()
    const { app, sync, keymap, input, calls, aborted } = await mount(tmp.path)
    try {
      if (mode !== "insert") {
        app.mockInput.pressEscape()
        app.mockInput.pressKey(mode === "visual" ? "v" : "V")
      }
      sync.set("session", 0, "metadata", { "kilo.goal": { text: "Add tests", active: true } })
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain(mode === "visual-line" ? "V-LINE" : mode.toUpperCase())
      const command = keymap
        .getCommands({ visibility: "registered" })
        .find((command) => command.name === "session.interrupt")
      if (!command) throw new Error("Interrupt command is not registered")
      expect(command.enabled).toBe(false)
      keymap.dispatchCommand("session.interrupt")
      const off = keymap.registerLayer({ commands: [{ name: "test.interrupt", run: (ctx) => command.run(ctx) }] })
      keymap.dispatchCommand("test.interrupt")
      off()
      app.mockInput.pressEscape()
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("NORMAL")
      expect(app.captureCharFrame()).not.toContain("again to interrupt")
      expect(input.plainText).toBe("draft")
      expect(calls).toEqual([])

      app.mockInput.pressEscape()
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("again to interrupt")
      expect(calls).toEqual([])
      app.mockInput.pressEscape()
      await aborted
      await app.renderOnce()
      expect(calls).toEqual(["/session/ses_goal/abort"])
      expect(app.captureCharFrame()).not.toContain("again to interrupt")
    } finally {
      input.clear()
      app.renderer.destroy()
    }
  },
)

test.each([false, true])("busy session double-Escape interrupts in Vim insert mode with goal %s", async (active) => {
  await using tmp = await tmpdir()
  const { app, sync, input, calls, aborted } = await mount(tmp.path)
  try {
    sync.set("session", 0, "metadata", { "kilo.goal": { text: "Add tests", active } })
    sync.set("session_status", "ses_goal", { type: "busy" })
    app.mockInput.pressEscape()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("INSERT")
    expect(app.captureCharFrame()).toContain("again to interrupt")
    expect(calls).toEqual([])
    app.mockInput.pressEscape()
    await aborted
    expect(calls).toEqual(["/session/ses_goal/abort"])
  } finally {
    input.clear()
    app.renderer.destroy()
  }
})

test("non-Vim double-Escape still pauses an idle active goal", async () => {
  await using tmp = await tmpdir()
  const { app, sync, input, calls, aborted } = await mount(tmp.path, false)
  try {
    app.mockInput.pressEscape()
    app.mockInput.pressEscape()
    await app.renderOnce()
    expect(calls).toEqual([])
    sync.set("session", 0, "metadata", { "kilo.goal": { text: "Add tests", active: true } })
    app.mockInput.pressEscape()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("again to interrupt")
    expect(calls).toEqual([])
    app.mockInput.pressEscape()
    await aborted
    expect(calls).toEqual(["/session/ses_goal/abort"])
  } finally {
    input.clear()
    app.renderer.destroy()
  }
})
