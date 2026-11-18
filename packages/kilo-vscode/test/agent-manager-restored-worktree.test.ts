// The Agent Manager restores a worktree folder deleted on disk from its own worktree card. Once the folder is back, the
// session must stop showing the failed Location load, so the directory whose health entry the host cleared is reloaded.
import { afterAll, describe, expect, mock, test } from "bun:test"
import { OpenCode } from "@opencode/client"

// The reload is an effect, and the package resolves the server build of Solid outside a renderer, where effects never
// run. The panel-data test needs the same mock for its effects.
const CLIENT_SOLID = "solid-js/dist/solid.js"
mock.module("solid-js", () => import(CLIENT_SOLID))
const CLIENT_STORE = "solid-js/store/dist/store.js"
mock.module("solid-js/store", () => import(CLIENT_STORE))
const { createRoot } = (await import(CLIENT_SOLID)) as {
  createRoot: <T>(fn: (dispose: () => void) => T) => T
}
// The webview page: the event stream reconnects on page lifecycle events.
Object.assign(globalThis, {
  window: new EventTarget(),
  document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
})
const { createPanelData } = await import("../webview-ui/agent-manager/v2/panel-data")
const { createAppDirectories } = await import("../webview-ui/agent-manager/app-directories")
const { createProjectStore } = await import("../webview-ui/agent-manager/project/store")
const { reloadRestoredDirectories } = await import("../webview-ui/agent-manager/restored-directories")

const ROOT = "/repo"
const WORKTREE = "/repo/.kilo/worktrees/one"
const PROJECT = "prj_1"

const requests: { path: string; location: string | null }[] = []
const encoder = new TextEncoder()
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    requests.push({ path: url.pathname, location: url.searchParams.get("location[directory]") })
    if (url.pathname === "/api/event") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.add(controller)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "server.connected", id: "evt_0", created: 0, data: {} })}\n\n`,
            ),
          )
        },
        cancel(controller) {
          streams.delete(controller as unknown as ReadableStreamDefaultController<Uint8Array>)
        },
      })
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    }
    return new Response(JSON.stringify({ _tag: "NotFound", message: "not found" }), { status: 404 })
  },
})

afterAll(() => {
  for (const controller of streams) controller.close()
  server.stop(true)
})

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error("condition not reached")
}

function state(health: Record<string, string>) {
  return {
    type: "agentManager.state",
    worktrees: [
      { id: "wt-1", branch: "one", path: WORKTREE, parentBranch: "main", createdAt: "2026-08-01T00:00:00.000Z" },
    ],
    sessions: [],
    worktreeHealth: health,
  } as never
}

describe("reloadRestoredDirectories", () => {
  test("reloads the directory of a worktree folder restored on disk", async () => {
    requests.length = 0
    const store = createProjectStore(PROJECT)
    const directories = createAppDirectories({
      projects: () => [
        {
          id: PROJECT,
          root: ROOT,
          label: "repo",
          expanded: true,
          active: true,
          pinned: false,
          worktrees: [],
          sessions: [],
        } as never,
      ],
      activeProjectId: () => PROJECT,
      store: () => store,
      currentProjectId: () => PROJECT,
      selection: () => "wt-1",
      managedSessions: () => [],
      openTabs: () => [],
    })
    await createRoot(async (dispose) => {
      const panel = createPanelData({ post: () => {}, api: OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}` }) })
      reloadRestoredDirectories(panel, directories)
      const located = () => requests.filter((item) => item.path === "/api/location" && item.location === WORKTREE)

      // The folder is deleted on disk: the store cannot load, and the effect sees it in the missing set.
      store.applyState(state({ "wt-1": "absent-restorable" }))
      panel.show(directories.visibleDirectories())
      await until(() => located().length > 0)
      const before = located().length

      // Restore worktree answers with a folder that exists again, so the next push drops its health entry.
      store.applyState(state({}))
      await until(() => located().length > before)
      // One reload per restore, not one per push.
      expect(located()).toHaveLength(before + 1)
      dispose()
    })
  })
})
