/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"
import type { GlobalEvent } from "@kilocode/sdk/v2"

function branchEvent(branch: string, workspace?: string): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    workspace,
    payload: {
      id: `evt_vcs_${branch}`,
      type: "vcs.branch.updated",
      properties: { branch },
    },
  }
}

// kilocode_change start - workspace fence test helpers
function configEvent(): GlobalEvent {
  return {
    directory: "global",
    payload: {
      id: "evt_global_config",
      type: "global.config.updated",
      properties: {},
    },
  }
}

// holds a stubbed response open so a test can switch workspace while the request is in flight
function deferred<T>() {
  return Promise.withResolvers<T>()
}

function ask(id: string, sessionID: string) {
  return { id, sessionID, permission: "bash", patterns: [], metadata: {}, always: [] }
}
// kilocode_change end

describe("tui sync", () => {
  test("refresh scopes sessions by default and lists project sessions when disabled", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, kv, sync, session } = await mount(undefined, tmp.path)

    try {
      expect(kv.get("session_directory_filter_enabled", true)).toBe(true)
      expect(session.at(-1)?.searchParams.get("roots")).toBeNull()
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
      expect(session.at(-1)?.searchParams.get("path")).toBe("packages/tui")

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
      expect(session.at(-1)?.searchParams.get("roots")).toBeNull()
    } finally {
      app.renderer.destroy()
    }
  })

  test("vcs branch updates only apply for the active workspace", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, project, sync } = await mount(
      (url) => (url.pathname === "/experimental/workspace" ? json([{ id: "ws_a" }]) : undefined),
      tmp.path,
    ) // kilocode_change - workspace re-bootstrap retains the selected test workspace

    try {
      expect(sync.data.vcs?.branch).toBe("main")

      project.workspace.set("ws_a")
      emit(branchEvent("other", "ws_b"))
      await Bun.sleep(30)

      expect(sync.data.vcs?.branch).toBe("main")

      emit(branchEvent("feature", "ws_a"))
      await wait(() => sync.data.vcs?.branch === "feature")

      expect(sync.data.vcs?.branch).toBe("feature")
    } finally {
      app.renderer.destroy()
    }
  })

  // kilocode_change start - a bootstrap run publishes under the selection that started it
  test("a workspace switch during an in-flight bootstrap keeps the new workspace's config", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const configs: URL[] = []
    const commands: URL[] = []
    const heldConfig = deferred<Response>()
    const heldPath = deferred<Response>()
    let hold = false
    const { app, project, sync } = await mount((url) => {
      if (url.pathname === "/experimental/workspace") return json([{ id: "ws_a" }, { id: "ws_b" }])
      const workspace = url.searchParams.get("workspace")
      const held = hold && workspace === "ws_a"
      // the run reaches its follow-up stage only after it published its batch
      if (url.pathname === "/command") commands.push(url)
      if (url.pathname === "/path") {
        // the earlier selection's responses stay in flight until after the switch resolves
        if (held) return heldPath.promise
        return json({ home: "", state: "", config: "", worktree: "/tmp/opencode", directory: `/tmp/opencode/${workspace}` })
      }
      if (url.pathname !== "/config") return undefined
      configs.push(url)
      if (held) return heldConfig.promise
      return json({ model: workspace ?? "default" })
    }, tmp.path)

    try {
      expect(sync.data.config.model).toBe("default")

      hold = true
      project.workspace.set("ws_a")
      await wait(() => configs.some((url) => url.searchParams.get("workspace") === "ws_a"))

      project.workspace.set("ws_b")
      await wait(() => sync.data.config.model === "ws_b")

      heldConfig.resolve(json({ model: "ws_a" }))
      heldPath.resolve(json({ home: "", state: "", config: "", worktree: "/tmp/opencode", directory: "/tmp/opencode/ws_a" }))
      // the earlier run reached its own follow-up call, so its batch already ran; a round-trip
      // through the stubbed client then settles after that point
      await wait(() => commands.some((url) => url.searchParams.get("workspace") === "ws_a"))
      await sync.session.refresh()

      expect(sync.data.config.model).toBe("ws_b")
      expect(project.instance.path().directory).toBe("/tmp/opencode/ws_b")
      expect(configs.some((url) => url.searchParams.get("workspace") === "ws_a")).toBe(true)
      expect(configs.some((url) => url.searchParams.get("workspace") === "ws_b")).toBe(true)
    } finally {
      heldConfig.resolve(json({ model: "ws_a" }))
      heldPath.resolve(json({ home: "", state: "", config: "", worktree: "/tmp/opencode", directory: "/tmp/opencode/ws_a" }))
      app.renderer.destroy()
    }
  })
  // kilocode_change end

  // kilocode_change start - the notification refresh names the active workspace and keeps its reply under that run
  test("a global config notification refreshes the workspace config with the active workspace", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const configs: URL[] = []
    const held = deferred<Response>()
    let reads = 0
    let hold = false
    const { app, emit, project, sync } = await mount((url) => {
      if (url.pathname === "/experimental/workspace") return json([{ id: "ws_a" }])
      if (url.pathname !== "/config") return undefined
      configs.push(url)
      reads += 1
      // the read the notification starts stays in flight; bootstrap reads resolve normally
      if (hold) return held.promise
      return json({ model: url.searchParams.get("workspace") ?? "default" })
    }, tmp.path)

    try {
      project.workspace.set("ws_a")
      await wait(() => sync.data.config.model === "ws_a")
      const before = configs.length

      hold = true
      emit(configEvent())
      await wait(() => configs.length > before && reads > before)

      // the refresh must name the active workspace, not the control-plane default
      expect(configs.slice(before).some((url) => url.searchParams.get("workspace") === "ws_a")).toBe(true)

      // a newer run takes ownership while the notification's reply is still in flight
      hold = false
      await sync.bootstrap()
      await wait(() => sync.status === "complete")

      held.resolve(json({ model: "reply-from-an-older-run" }))
      // a real client round-trip settles after that reply has been delivered
      await sync.session.refresh()

      expect(sync.data.config.model).toBe("ws_a")
    } finally {
      held.resolve(json({ model: "ws_a" }))
      app.renderer.destroy()
    }
  })
  // kilocode_change end

  // kilocode_change start - a pending-ask recovery publishes under the selection that started it
  test("a workspace switch during an in-flight pending-ask recovery keeps the new workspace's asks", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const configs: URL[] = []
    const lists: URL[] = []
    const held = deferred<Response>()
    const { app, project, sync } = await mount((url) => {
      if (url.pathname === "/experimental/workspace") return json([{ id: "ws_a" }, { id: "ws_b" }])
      if (url.pathname === "/config") {
        configs.push(url)
        return json({ model: url.searchParams.get("workspace") ?? "default" })
      }
      if (url.pathname !== "/permission") return undefined
      lists.push(url)
      const workspace = url.searchParams.get("workspace")
      if (workspace === "ws_a") return held.promise
      if (workspace === "ws_b") return json([ask("perm_b", "ses_b")])
      return json([])
    }, tmp.path)

    try {
      project.workspace.set("ws_a")
      await wait(() => lists.some((url) => url.searchParams.get("workspace") === "ws_a"))

      project.workspace.set("ws_b")
      await wait(() => configs.some((url) => url.searchParams.get("workspace") === "ws_b"))

      held.resolve(json([ask("perm_a", "ses_a")]))
      // a real client round-trip settles after that recovery has finished
      await sync.session.refresh()

      // the earlier recovery resolved after the switch and published nothing
      expect(sync.data.permission["ses_a"]).toBeUndefined()
      await wait(() => sync.data.permission["ses_b"]?.length === 1)
      expect(lists.some((url) => url.searchParams.get("workspace") === "ws_b")).toBe(true)
    } finally {
      held.resolve(json([]))
      app.renderer.destroy()
    }
  })
  // kilocode_change end

  // kilocode_change start - auto-mode replies act on the server, so a superseded recovery still sends them
  test("an auto-mode reply still reaches the server when the selection moved during a pending-ask recovery", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const lists: URL[] = []
    const replies: URL[] = []
    const held = deferred<Response>()
    const { app, project, sync } = await mount(
      (url) => {
        if (url.pathname === "/experimental/workspace") return json([{ id: "ws_a" }, { id: "ws_b" }])
        if (url.pathname === "/config") return json({ model: url.searchParams.get("workspace") ?? "default" })
        if (/^\/permission\/[^/]+\/reply$/.test(url.pathname)) {
          replies.push(url)
          return json(true)
        }
        if (url.pathname !== "/permission") return undefined
        lists.push(url)
        if (url.searchParams.get("workspace") === "ws_a") return held.promise
        return json([])
      },
      tmp.path,
      { auto: true },
    )

    try {
      project.workspace.set("ws_a")
      await wait(() => lists.some((url) => url.searchParams.get("workspace") === "ws_a"))

      project.workspace.set("ws_b")
      await wait(() => sync.data.config.model === "ws_b")

      // the earlier selection's list resolves after the switch: its run no longer owns the store,
      // but auto mode answers on the server and that reply must still go out, under its own workspace
      held.resolve(json([ask("perm_a", "ses_a")]))
      await wait(() => replies.length === 1)

      expect(replies[0].pathname).toBe("/permission/perm_a/reply")
      expect(replies[0].searchParams.get("workspace")).toBe("ws_a")
      expect(sync.data.permission["ses_a"]).toBeUndefined()
    } finally {
      held.resolve(json([]))
      app.renderer.destroy()
    }
  })
  // kilocode_change end

  // kilocode_change start - a failed run that no longer owns the selection does not exit the TUI
  test("a failed bootstrap for a previous workspace does not exit the app", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const held = deferred<Response>()
    const settled = deferred<undefined>()
    const exited: unknown[] = []
    const seen: string[] = []
    const { app, project, sync } = await mount((url) => {
      if (url.pathname === "/experimental/workspace") return json([{ id: "ws_a" }, { id: "ws_b" }])
      if (url.pathname !== "/config") return undefined
      const workspace = url.searchParams.get("workspace")
      if (workspace !== "ws_a") return json({ model: workspace ?? "default" })
      // the earlier selection's read stays in flight until after the switch resolved
      seen.push(workspace)
      return held.promise.finally(() => settled.resolve(undefined))
    }, tmp.path, undefined, (error) => exited.push(error))

    try {
      project.workspace.set("ws_a")
      // the switch happens while that read is in flight
      await wait(() => seen.length === 1)
      project.workspace.set("ws_b")
      await wait(() => sync.data.config.model === "ws_b")

      held.reject(new Error("Workspace not found"))
      // the rejection reached the client, then a real round-trip through the stubbed client
      // settled after it
      await settled.promise
      await sync.session.refresh()

      expect(exited).toEqual([])
      expect(sync.data.config.model).toBe("ws_b")
    } finally {
      held.resolve(json({ model: "ws_a" }))
      app.renderer.destroy()
    }
  })
  // kilocode_change end

  // kilocode_change start - a failed newest run must not leave the store waiting
  test("a failed bootstrap for the current workspace reaches a settled status", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let fail = false
    const { app, sync } = await mount((url) => {
      if (url.pathname !== "/config") return undefined
      if (fail) return new Response("boom", { status: 500 })
      return json({ model: "default" })
    }, tmp.path)

    try {
      await wait(() => sync.status === "complete")

      // the first run's state: the store is still loading, and this run fails non-fatally
      sync.set("status", "loading")
      fail = true
      await sync.bootstrap({ fatal: false }).catch(() => undefined)

      // a non-fatal failure must still settle, so the app is not stuck on its loading screen
      expect(sync.status).not.toBe("loading")
    } finally {
      app.renderer.destroy()
    }
  })
  // kilocode_change end


})
