/** @jsxImportSource @opentui/solid */ // kilocode_change - new file
import { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createSlot, createSolidSlotRegistry, testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, Show } from "solid-js"
import type { PermissionRequest } from "@kilocode/sdk/v2"
import { ArgsProvider } from "../../../src/context/args"
import { KVProvider } from "../../../src/context/kv"
import { LocationProvider } from "../../../src/context/location"
import { PermissionProvider } from "../../../src/context/permission"
import { ProjectProvider } from "../../../src/context/project"
import { SDKProvider } from "../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../src/context/sync"
import { ThemeProvider } from "../../../src/context/theme"
import { ExitProvider } from "../../../src/context/exit"
import { EpilogueProvider } from "../../../src/context/epilogue"
import { ToastProvider } from "../../../src/ui/toast"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { TuiConfigProvider } from "../../../src/config"
import { createPluginRuntime, PluginRuntimeProvider } from "../../../src/plugin/runtime"
import { PermissionPrompt } from "../../../src/routes/session/permission"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createEventSource, createFetch, directory } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { tmpdir } from "../../fixture/fixture"

async function wait(fn: () => boolean, timeout = 4000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function capture(app: Awaited<ReturnType<typeof testRender>>, text: string, timeout = 4000) {
  const start = Date.now()
  let frame = app.captureCharFrame()
  while (!frame.includes(text)) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for "${text}" in frame:\n${frame}`)
    await app.renderOnce()
    await Bun.sleep(10)
    frame = app.captureCharFrame()
  }
  return frame
}

const diff = ["--- a/demo.txt", "+++ b/demo.txt", "@@ -1 +1 @@", "-world", "+hello", ""].join("\n")

function request(
  metadata: PermissionRequest["metadata"] = { filepath: "/workspace/demo.txt", diff },
): PermissionRequest {
  return {
    id: "perm-reject-1",
    sessionID: "session-1",
    permission: "edit",
    patterns: ["/workspace/demo.txt"],
    metadata,
    always: [],
  }
}

async function mount(root: string, requests: { path: string; body: unknown }[], req: PermissionRequest = request()) {
  await Bun.write(`${root}/kv.json`, JSON.stringify({ animations_enabled: false, vim_enabled: false }))
  const events = createEventSource()
  const calls = createFetch(undefined, events)
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const raw = input instanceof Request ? await input.clone().text() : await new Response(init?.body).text()
    if (url.pathname.endsWith("/reply")) requests.push({ path: url.pathname, body: raw ? JSON.parse(raw) : undefined })
    return calls.fetch(input, init)
  }) as typeof globalThis.fetch

  const config = createTuiResolvedConfig()

  function Ready() {
    const sync = useSync()
    return (
      <Show when={sync.status === "complete"}>
        <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
          <LocationProvider>
            <box width={80} height={24}>
              <PermissionPrompt request={req} directory={directory} />
            </box>
          </LocationProvider>
        </ThemeProvider>
      </Show>
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
        <OpencodeKeymapProvider keymap={keymap}>
          <ArgsProvider>
            <KVProvider>
              <ToastProvider>
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
                                <Ready />
                              </SyncProvider>
                            </EpilogueProvider>
                          </ExitProvider>
                        </ProjectProvider>
                      </PermissionProvider>
                    </SDKProvider>
                  </PluginRuntimeProvider>
                </TuiConfigProvider>
              </ToastProvider>
            </KVProvider>
          </ArgsProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 24, kittyKeyboard: true })
  try {
    await app.renderOnce()
    await Bun.sleep(200)
    await app.flush()
    return app
  } catch (error) {
    app.renderer.destroy()
    throw error
  }
}

test("rejecting a permission stages a feedback prompt and sends the message", async () => {
  await using tmp = await tmpdir()
  const requests: { path: string; body: unknown }[] = []
  const app = await mount(tmp.path, requests)

  try {
    app.mockInput.pressEscape()
    await app.flush()
    await wait(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await Bun.sleep(50)
    await app.flush()

    expect(app.renderer.currentFocusedEditor).toBeInstanceOf(TextareaRenderable)

    await app.mockInput.typeText("use spaces, not tabs")
    await app.flush()
    app.mockInput.pressEnter()
    await app.flush()
    await Bun.sleep(50)

    const reply = requests.find((item) => item.path === "/permission/perm-reject-1/reply")
    expect(reply).toBeDefined()
    expect((reply?.body as { reply?: string; message?: string })?.reply).toBe("reject")
    expect((reply?.body as { message?: string })?.message).toBe("use spaces, not tabs")
  } finally {
    app.renderer.destroy()
  }
})

test("rejecting with no feedback omits the message", async () => {
  await using tmp = await tmpdir()
  const requests: { path: string; body: unknown }[] = []
  const app = await mount(tmp.path, requests)

  try {
    app.mockInput.pressEscape()
    await app.flush()
    await wait(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await Bun.sleep(50)
    await app.flush()
    app.mockInput.pressEnter()
    await app.flush()
    await Bun.sleep(50)

    const reply = requests.find((item) => item.path === "/permission/perm-reject-1/reply")
    expect(reply).toBeDefined()
    expect((reply?.body as { reply?: string })?.reply).toBe("reject")
    expect((reply?.body as { message?: string })?.message).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("renders a real edit diff instead of a fallback", async () => {
  await using tmp = await tmpdir()
  const app = await mount(tmp.path, [], request())

  try {
    const frame = await capture(app, "hello")
    expect(frame).toContain("hello")
    expect(frame).toContain("world")
    expect(frame).not.toContain("No changes to review")
    expect(frame).not.toContain("No diff provided")
  } finally {
    app.renderer.destroy()
  }
})

test("shows a no changes fallback for a header-only edit patch", async () => {
  await using tmp = await tmpdir()
  const app = await mount(
    tmp.path,
    [],
    request({ filepath: "/workspace/demo.txt", diff: "--- a/demo.txt\n+++ b/demo.txt" }),
  )

  try {
    const frame = await capture(app, "No changes to review")
    expect(frame).toContain("No changes to review")
    expect(frame).not.toContain("No diff provided")
  } finally {
    app.renderer.destroy()
  }
})

test("shows the no diff provided fallback when metadata has no diff", async () => {
  await using tmp = await tmpdir()
  const app = await mount(tmp.path, [], request({ filepath: "/workspace/demo.txt" }))

  try {
    const frame = await capture(app, "No diff provided")
    expect(frame).toContain("No diff provided")
    expect(frame).not.toContain("No changes to review")
  } finally {
    app.renderer.destroy()
  }
})

test("scrolls a large edit to the last changed line and opens rejection feedback", async () => {
  await using tmp = await tmpdir()
  const lines = Array.from({ length: 200 }, (_, index) => index + 1)
  const patch = [
    "--- a/demo.txt",
    "+++ b/demo.txt",
    "@@ -1,200 +1,200 @@",
    ...lines.map((line) => `-before ${line}`),
    ...lines.map((line) => `+after ${line}`),
    "",
  ].join("\n")
  const app = await mount(tmp.path, [], request({ filepath: "/workspace/demo.txt", diff: patch }))
  try {
    expect(await capture(app, "before 1")).not.toContain("after 200")
    const nodes = app.renderer.root.getChildren()
    for (const node of nodes) nodes.push(...node.getChildren())
    const scroll = nodes.find((node) => node instanceof ScrollBoxRenderable)
    expect(scroll).toBeInstanceOf(ScrollBoxRenderable)
    if (!(scroll instanceof ScrollBoxRenderable)) throw new Error("Missing edit scrollbox")
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.height)
    scroll.scrollTo(scroll.scrollHeight)
    expect(await capture(app, "after 200")).toContain("after 200")
    app.mockInput.pressEscape()
    await app.flush()
    expect(await capture(app, "Reject permission")).toContain("Tell Kilo what to do differently")
  } finally {
    app.renderer.destroy()
  }
})
