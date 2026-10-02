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
import { createFetch, directory, eventSource, json } from "../fixture/tui-sdk"

const parent = {
  id: "ses_parent",
  slug: "parent",
  projectID: "proj_test",
  directory,
  title: "Parent session",
  version: "test",
  time: { created: 1, updated: 1 },
}
const child = {
  ...parent,
  id: "ses_child",
  slug: "child",
  parentID: parent.id,
  title: "inspect bug (@general subagent)",
}

const reply = {
  info: {
    id: "msg_child_reply",
    sessionID: child.id,
    role: "assistant",
    parentID: "msg_child_user",
    agent: "general",
    mode: "subagent",
    providerID: "test",
    modelID: "test",
    path: { cwd: directory, root: directory },
    cost: 0.0123,
    tokens: { input: 12000, output: 3456, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 2 },
  },
  parts: [],
}

async function mount(
  root: string,
  width = 100,
  opts: { route?: string; agents?: object[]; config?: Parameters<typeof createTuiResolvedConfig>[0] } = {},
) {
  const route = opts.route ?? child.id
  const agents = opts.agents ?? []
  await Bun.write(`${root}/kv.json`, JSON.stringify({ animations_enabled: false, sidebar: "hide", vim_enabled: false }))
  const aborts: URL[] = []
  const exits: unknown[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/agent") return json(agents)
    if (url.pathname === "/session") return json([parent, child])
    if (url.pathname === `/session/${child.id}`) return json(child)
    if (url.pathname === `/session/${parent.id}`) return json(parent)
    if (url.pathname === "/session/status") return json({ [child.id]: { type: "busy" } })
    if (url.pathname === `/session/${child.id}/abort`) {
      aborts.push(url)
      return json(true)
    }
    if (url.pathname.startsWith("/session/") && url.pathname.endsWith("/children")) return json([child])
    if (url.pathname === `/session/${child.id}/message`) return json([reply])
    if (["/message", "/todo", "/diff"].some((suffix) => url.pathname.endsWith(suffix))) return json([])
    if (url.pathname.startsWith("/background-process/")) return json(true)
    return undefined
  })
  const config = createTuiResolvedConfig(opts.config)
  const refs: { sync?: ReturnType<typeof useSync>; prompt?: ReturnType<typeof usePromptRef> } = {}

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
                    <RouteProvider initialRoute={{ type: "session", sessionID: route }}>
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
                                <ExitProvider exit={(reason) => exits.push(reason)}>
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

  const app = await testRender(() => <Harness />, { width, height: 30 })
  const frame = () => app.captureCharFrame()
  try {
    await wait(() =>
      route === child.id
        ? refs.sync?.data.session_status?.[child.id]?.type === "busy" && frame().includes("General")
        : !!refs.prompt?.current?.focused,
    )
    await app.flush()
    return {
      aborts,
      exits,
      frame,
      spans: () => app.captureSpans(),
      async press(sequence: string) {
        app.renderer.stdin.emit("data", Buffer.from(sequence))
        // a lone ESC is disambiguated from escape sequences after a short delay
        await Bun.sleep(80)
        await app.flush()
      },
      [Symbol.dispose]() {
        app.renderer.destroy()
      },
    }
  } catch (err) {
    app.renderer.destroy()
    throw err
  }
}

test("running subagent view shows the interrupt shortcut beside the navigation shortcuts", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path)
  const row =
    scene
      .frame()
      .split("\n")
      .find((line) => line.includes("General")) ?? ""
  expect(row).toMatch(/Interrupt esc\s+Parent up\s+Prev left\s+Next right/)
})

test("double Esc stops the running subagent like the VS Code task-card Stop", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path)
  await scene.press("\x1b")
  expect(scene.frame()).toContain("Interrupt esc again")
  expect(scene.aborts).toHaveLength(0)
  await scene.press("\x1b")
  await wait(() => scene.aborts.length === 1)
  expect(scene.aborts[0]?.pathname).toBe(`/session/${child.id}/abort`)
  expect(scene.aborts[0]?.searchParams.get("scope")).toBe("tree")
  expect(scene.frame()).not.toContain("esc again")
})

test("exit keys need a second press in the subagent view", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path)
  await scene.press("\x03")
  expect(scene.frame()).toContain("again to exit")
  expect(scene.exits).toHaveLength(0)
  await scene.press("\x03")
  expect(scene.exits).toHaveLength(1)
})

for (const width of [80, 120]) {
  test(`footer stays on one row at ${width} columns in every key-hint state`, async () => {
    await using tmp = await tmpdir()
    using scene = await mount(tmp.path, width)
    // footer content only: the steering prompt below it also draws "┃" rows with text
    const rows = () =>
      scene
        .frame()
        .split("\n")
        .filter((row) => /General \(1 of 1\)|Interrupt esc|again to exit|Parent up|Prev left|Next right/.test(row))
    const states = [] as string[][]
    states.push(rows())
    await scene.press("\x1b")
    states.push(rows())
    await scene.press("\x03")
    states.push(rows())
    expect(states.map((item) => item.length)).toEqual([1, 1, 1])
    expect(states[0]?.[0]).toContain("Interrupt esc")
    expect(states[1]?.[0]).toContain("Interrupt esc again")
    expect(states[2]?.[0]).toContain("again to exit")
    for (const item of states) expect(item[0]).toContain("Next right")
  })
}

// The subagent view also mounts the steering prompt: its keys must coexist with the footer's.
// The prompt keeps an unmounted draft for its next mount, so each test clears what it typed.
test("the steering prompt names the subagent it steers instead of the parent's agent", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path)
  expect(scene.frame()).toContain("Steer the General subagent...")
  expect(scene.frame()).toContain("Steering General")
})

test("running subagent view shows the steering prompt without a second interrupt hint", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path)
  await scene.press("steer")
  expect(scene.frame()).toContain("steer")
  expect(scene.frame()).toContain("Interrupt esc")
  expect(scene.frame()).not.toContain("esc interrupt")
  await scene.press("\x03")
})

test("ctrl+c clears a typed steer before it arms exit", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path)
  await scene.press("redirect the worker")
  expect(scene.frame()).toContain("redirect the worker")
  await scene.press("\x03")
  expect(scene.frame()).not.toContain("redirect the worker")
  expect(scene.frame()).not.toContain("again to exit")
  await scene.press("\x03")
  expect(scene.frame()).toContain("again to exit")
  expect(scene.exits).toHaveLength(0)
})

test("double Esc still stops the subagent while a steer is typed", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path)
  await scene.press("half typed")
  await scene.press("\x1b")
  await scene.press("\x1b")
  await wait(() => scene.aborts.length === 1)
  expect(scene.aborts[0]?.searchParams.get("scope")).toBe("tree")
  expect(scene.frame()).toContain("half typed")
  await scene.press("\x03")
})

test("Esc closes the mention list before it arms the interrupt", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path)
  const before = scene.frame()
  await scene.press("@")
  expect(scene.frame()).not.toBe(before)
  await scene.press("\x1b")
  expect(scene.frame()).not.toContain("esc again")
  expect(scene.aborts).toHaveLength(0)
  await scene.press("\x1b")
  await scene.press("\x1b")
  await wait(() => scene.aborts.length === 1)
  await scene.press("\x03")
})

test("recalling a shell history entry in a subagent view keeps it a plain steer", async () => {
  await using tmp = await tmpdir()
  await Bun.write(
    `${tmp.path}/prompt-history.jsonl`,
    JSON.stringify({ input: "ls -la", parts: [], mode: "shell" }) + "\n",
  )
  // third agent: the palette gives it a color distinct from the shell-mode color
  const agents = [
    { name: "build", mode: "primary", permission: [], options: {} },
    { name: "plan", mode: "primary", permission: [], options: {} },
    { name: "general", mode: "subagent", permission: [], options: {} },
  ]
  // with default keys, up on an empty subagent prompt goes to the parent; a user who unbinds that
  // reaches prompt history, which is shared across sessions and can hold a shell entry
  using scene = await mount(tmp.path, 100, { agents, config: { keybinds: { session_parent: "none" } } })
  const color = (row: string, text: string) => {
    const line = scene.spans().lines.find((item) =>
      item.spans
        .map((span) => span.text)
        .join("")
        .includes(row),
    )
    const span = line?.spans.find((item) => item.text.includes(text))
    return span ? [span.fg.r, span.fg.g, span.fg.b, span.fg.a] : undefined
  }
  const steered = color("Steering General", "┃")
  expect(steered).toBeDefined()
  // the steering label is drawn in the subagent's color, and so is the prompt border
  expect(steered).toEqual(color("Steering General", "Steering"))
  await scene.press("\x1b[A")
  expect(scene.frame()).toContain("ls -la")
  // shell mode would switch the prompt border to the shell color
  expect(color("ls -la", "┃")).toEqual(steered)
  await scene.press("\x03")
})

test("the main prompt's exit guard uses the same double press", async () => {
  await using tmp = await tmpdir()
  using scene = await mount(tmp.path, 100, { route: parent.id })
  await scene.press("\x03")
  expect(scene.frame()).toContain("again to exit")
  expect(scene.exits).toHaveLength(0)
  await scene.press("\x03")
  expect(scene.exits).toHaveLength(1)
  expect(scene.frame()).not.toContain("again to exit")
})
