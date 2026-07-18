/** @jsxImportSource @opentui/solid */
import { expect, spyOn, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { TuiPluginApi } from "@kilocode/plugin/tui"
import type { Event, GlobalEvent, Message, Part, Session } from "@kilocode/sdk/v2"
import { createSignal } from "solid-js"
import { ArgsProvider } from "@tui/context/args"
import { ExitProvider } from "@tui/context/exit"
import { KVProvider } from "@tui/context/kv"
import { ProjectProvider } from "@tui/context/project"
import { SDKProvider } from "@tui/context/sdk"
import { SyncProvider } from "@tui/context/sync"
import { ToastProvider } from "@tui/ui/toast"
import { MemorySidebar } from "@/kilocode/cli/cmd/tui/component/memory-status"
import { MemoryMessageMeta, MemorySessionTui } from "@/kilocode/cli/cmd/tui/routes/session/memory"
import { Global } from "@opencode-ai/core/global"
import { createEventSource, createFetch, directory, json } from "../../../../fixture/tui-sdk"
import { tmpdir } from "../../../../fixture/fixture"
import { TestTuiContexts } from "../../../../fixture/tui-environment"

const id = "ses_memory_status"

const session = {
  id,
  slug: "memory-status",
  projectID: "proj_test",
  directory,
  title: "Memory status",
  version: "1",
  time: { created: 1, updated: 1 },
} satisfies Session

function event(sessionID?: string, count?: number): Extract<Event, { type: "memory.status" }> {
  return {
    id: `evt_memory_${sessionID ?? "project"}_${count ?? 0}`,
    type: "memory.status",
    properties: {
      directory,
      ...(sessionID ? { sessionID } : {}),
      enabled: true,
      state: "idle",
      project: { bytes: 0, estimatedTokens: 0, truncated: false },
      ...(count === undefined
        ? {}
        : { detail: { type: "saved" as const, message: `Memory saved · ${count}`, operationCount: count } }),
    },
  }
}

function global(payload: Event): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

async function wait(fn: () => boolean, timeout = 2_000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for memory TUI state")
    await Bun.sleep(10)
  }
}

function Probe(props: { sessionID: string }) {
  const verbose = MemorySessionTui.verbose({ sessionID: () => props.sessionID })
  return <text>{verbose() ? "verbose" : "quiet"}</text>
}

test("session memory status refetches live and ignores other sessions", async () => {
  await using tmp = await tmpdir()
  const prior = Global.Path.state
  Global.Path.state = tmp.path
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const events = createEventSource()
  const state = { verbose: false }
  const calls = { count: 0 }
  const fetch = createFetch((url) => {
    if (url.pathname === "/session") return json([session])
    if (url.pathname !== "/memory/status") return
    calls.count += 1
    return json({ state: { verbose: state.verbose } })
  })
  try {
    const app = await testRender(() => (
      <TestTuiContexts paths={{ state: tmp.path }}>
        <ArgsProvider>
          <ExitProvider exit={() => {}}>
            <KVProvider>
              <ToastProvider>
                <SDKProvider url="http://test" directory={directory} fetch={fetch.fetch} events={events.source}>
                  <ProjectProvider>
                    <SyncProvider>
                      <Probe sessionID={id} />
                    </SyncProvider>
                  </ProjectProvider>
                </SDKProvider>
              </ToastProvider>
            </KVProvider>
          </ExitProvider>
        </ArgsProvider>
      </TestTuiContexts>
    ))
    try {
      await wait(() => calls.count === 1 && app.captureCharFrame().includes("quiet"))
      events.emit(global(event("ses_other")))
      await Bun.sleep(30)
      expect(calls.count).toBe(1)

      state.verbose = true
      events.emit(global(event(id)))
      await wait(() => calls.count === 2 && app.captureCharFrame().includes("verbose"))
    } finally {
      app.renderer.destroy()
    }
  } finally {
    Global.Path.state = prior
  }
})

test("message memory metadata reacts to verbose changes and bounds snippets", async () => {
  const [verbose, setVerbose] = createSignal(false)
  const [parts, setParts] = createSignal<Part[]>([])
  const first = "a".repeat(100)
  const part = {
    id: "part_memory_recall",
    sessionID: id,
    messageID: "msg_memory_recall",
    type: "text",
    text: "",
    metadata: { kiloMemory: { type: "recall", count: 3, items: [first, "second", "third"] } },
  } satisfies Part
  setParts([part])
  const app = await testRender(
    () => (
      <text>
        <MemoryMessageMeta parts={parts()} color={RGBA.fromHex("#ffffff")} verbose={verbose} />
      </text>
    ),
    { width: 200, height: 3 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("memory · recalled 3")
    expect(app.captureCharFrame()).not.toContain("second")

    setVerbose(true)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("a".repeat(80))
    expect(app.captureCharFrame()).not.toContain("a".repeat(81))
    expect(app.captureCharFrame()).toContain("second")
    expect(app.captureCharFrame()).not.toContain("third")

    setVerbose(false)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("second")

    setParts([
      {
        ...part,
        id: "part_memory_startup",
        metadata: { kiloMemory: { type: "startup", count: 2, tokens: 40 } },
      },
    ])
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("memory · Startup Context")
    expect(app.captureCharFrame()).not.toContain("recalled")
  } finally {
    app.renderer.destroy()
  }
})

type Handler = (event: Event) => void

function bus() {
  const handlers = new Map<string, Set<Handler>>()
  return {
    on(type: string, fn: Handler) {
      const items = handlers.get(type) ?? new Set<Handler>()
      items.add(fn)
      handlers.set(type, items)
      return () => items.delete(fn)
    },
    emit(value: Event) {
      for (const fn of handlers.get(value.type) ?? []) fn(value)
    },
  }
}

test("sidebar refetches status and scopes recall and save flashes", async () => {
  const [parts, setParts] = createSignal<Part[]>([])
  const events = bus()
  const calls = { count: 0 }
  const api = {
    state: {
      path: { directory },
      session: {
        get: () => session,
        messages: () => [{ id: "msg_memory_sidebar" } as Message],
      },
      part: () => parts(),
    },
    client: {
      memory: {
        status: async () => {
          calls.count += 1
          return { data: { state: { enabled: true, verbose: true } } }
        },
      },
    },
    event: events,
    theme: {
      current: {
        text: RGBA.fromHex("#ffffff"),
        textMuted: RGBA.fromHex("#888888"),
        success: RGBA.fromHex("#00ff00"),
        error: RGBA.fromHex("#ff0000"),
      },
    },
  } as unknown as TuiPluginApi
  const clear = spyOn(globalThis, "clearTimeout")
  const app = await testRender(() => <MemorySidebar api={api} sessionID={id} />, { width: 80, height: 5 })

  try {
    await wait(() => calls.count === 1 && app.captureCharFrame().includes("Enabled"))
    setParts([
      {
        id: "part_memory_sidebar",
        sessionID: id,
        messageID: "msg_memory_sidebar",
        type: "text",
        text: "",
        metadata: { kiloMemory: { type: "recall", count: 2 } },
      },
    ])
    await wait(() => app.captureCharFrame().includes("recalled 2"))
    await Bun.sleep(5_100)
    expect(app.captureCharFrame()).not.toContain("recalled 2")

    events.emit(event("ses_other", 4))
    await wait(() => calls.count === 2)
    expect(app.captureCharFrame()).not.toContain("saved 4")

    events.emit(event(id, 3))
    await wait(() => calls.count === 3 && app.captureCharFrame().includes("saved 3"))
    const before = clear.mock.calls.length
    app.renderer.destroy()
    expect(clear.mock.calls.length).toBeGreaterThan(before)
  } finally {
    if (!app.renderer.isDestroyed) app.renderer.destroy()
    clear.mockRestore()
  }
}, 10_000)
