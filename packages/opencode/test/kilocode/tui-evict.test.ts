import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Event, GlobalEvent } from "@kilocode/sdk/v2"
import { onMount, type Component, type JSX } from "solid-js"
import { createComponent } from "solid-js/web"
import { ArgsProvider } from "../../src/cli/cmd/tui/context/args"
import { ExitProvider } from "../../src/cli/cmd/tui/context/exit"
import { ProjectProvider } from "../../src/cli/cmd/tui/context/project"
import { SDKProvider, type EventSource } from "../../src/cli/cmd/tui/context/sdk"
import { SyncProvider, useSync } from "../../src/cli/cmd/tui/context/sync"
import { ToastProvider } from "../../src/cli/cmd/tui/ui/toast"

const sighup = new Set(process.listeners("SIGHUP"))

afterEach(() => {
  for (const fn of process.listeners("SIGHUP")) {
    if (!sighup.has(fn)) process.off("SIGHUP", fn)
  }
})

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
    },
  })
}

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function createFetch(log: string[]) {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const url = new URL(req.url)
      log.push(url.pathname)

      if (url.pathname === "/config/providers") return json({ providers: [], default: {} })
      if (url.pathname === "/provider") return json({ all: [], default: {}, connected: [] })
      if (url.pathname === "/provider/auth") return json({})
      if (url.pathname === "/experimental/console") return json({})
      if (url.pathname === "/agent") return json([])
      if (url.pathname === "/config") return json({})
      if (url.pathname === "/config/warnings") return json([])
      if (url.pathname === "/project/current") return json({ id: "proj_root" })
      if (url.pathname === "/path") {
        return json({
          state: "/tmp/root/state",
          config: "/tmp/root/config",
          worktree: "/tmp/worktree",
          directory: "/tmp/root",
        })
      }
      if (url.pathname === "/session") return json([])
      if (url.pathname === "/session/status") return json({})
      if (url.pathname === "/network") return json([])
      if (url.pathname === "/command") return json([])
      if (url.pathname === "/lsp") return json([])
      if (url.pathname === "/mcp") return json({})
      if (url.pathname === "/experimental/resource") return json({})
      if (url.pathname === "/formatter") return json([])
      if (url.pathname === "/vcs") return json({ branch: "main" })
      if (url.pathname === "/experimental/workspace") return json([])

      throw new Error(`unexpected request: ${req.method} ${url.pathname}`)
    },
    { preconnect: fetch.preconnect.bind(fetch) },
  ) satisfies typeof fetch
}

function emit(sink: (event: GlobalEvent) => void, payload: Event) {
  sink({ directory: "/tmp/root", payload } as GlobalEvent)
}

function Probe(props: { onReady: (sync: ReturnType<typeof useSync>) => void }) {
  const sync = useSync()
  onMount(() => props.onReady(sync))
  return null
}

function withChildren<T extends Record<string, unknown>>(
  component: Component<T & { children?: JSX.Element }>,
  props: T,
  child: () => JSX.Element,
) {
  return createComponent(component, {
    ...props,
    get children() {
      return child()
    },
  } as T & { children?: JSX.Element })
}

async function mount(log: string[], events: EventSource) {
  let sync!: ReturnType<typeof useSync>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() =>
    withChildren(SDKProvider, { url: "http://test", directory: "/tmp/root", fetch: createFetch(log), events }, () =>
      withChildren(ArgsProvider, { continue: false }, () =>
        withChildren(ExitProvider, {}, () =>
          withChildren(ProjectProvider, {}, () =>
            withChildren(ToastProvider, {}, () =>
              withChildren(SyncProvider, {}, () =>
                createComponent(Probe, {
                  onReady: (ctx) => {
                    sync = ctx
                    done()
                  },
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  )

  await ready
  return { app, sync }
}

describe("tui session eviction", () => {
  test("clears prompt state when evicting a session", async () => {
    const log: string[] = []
    let sink!: (event: GlobalEvent) => void
    const events: EventSource = {
      subscribe: async (handler) => {
        sink = handler
        return () => {}
      },
    }
    const { app, sync } = await mount(log, events)

    try {
      await wait(() => log.includes("/session"))

      emit(sink, {
        type: "permission.asked",
        properties: { id: "perm_1", sessionID: "ses_1" },
      } as Event)
      emit(sink, {
        type: "question.asked",
        properties: { id: "question_1", sessionID: "ses_1" },
      } as Event)

      await wait(() => sync.data.permission.ses_1?.length === 1 && sync.data.question.ses_1?.length === 1)

      emit(sink, {
        type: "session.deleted",
        properties: { info: { id: "ses_1" } },
      } as Event)

      await wait(() => !sync.data.permission.ses_1 && !sync.data.question.ses_1)

      expect(sync.data.permission.ses_1).toBeUndefined()
      expect(sync.data.question.ses_1).toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })
})
