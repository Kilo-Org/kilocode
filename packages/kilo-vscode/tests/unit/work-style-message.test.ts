import { afterEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import { handleWorkStyleMessage } from "../../src/kilo-provider/work-style"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import type { WorkStyleState } from "../../src/shared/work-style-presets"

const workspace = vscode.workspace as unknown as {
  getConfiguration: typeof vscode.workspace.getConfiguration
}
const original = workspace.getConfiguration

function setup(initial?: WorkStyleState, sessions = false, enabled = true) {
  const state: { style?: WorkStyleState } = { style: initial }
  workspace.getConfiguration = (section) => {
    if (section === "kilo-code.new.internal") {
      return {
        get: <T>(key: string, fallback?: T) => (key === "agentSelectionOnboarding" ? enabled : fallback) as T,
      } as vscode.WorkspaceConfiguration
    }
    return {
      get: <T>(_key: string, fallback?: T) => (state.style ?? fallback) as T,
      inspect: () => ({ globalValue: state.style }),
      update: async (_key: string, value: WorkStyleState) => {
        state.style = value
      },
    } as vscode.WorkspaceConfiguration
  }

  const list = mock(async () => ({ data: sessions ? [{ id: "existing" }] : [] }))
  const connection = {
    getClientAsync: mock(async () => ({ experimental: { session: { list } } })),
  } as unknown as KiloConnectionService
  const posts: unknown[] = []
  return { state, connection, list, posts, post: (msg: unknown) => posts.push(msg) }
}

afterEach(() => {
  workspace.getConfiguration = original
})

describe("work style onboarding initialization", () => {
  it("uses one-page Code onboarding when agent selection is disabled", async () => {
    const ctx = setup(undefined, false, false)
    const prepare = mock(async () => ({ available: true as const }))

    await handleWorkStyleMessage({
      message: { type: "requestWorkStyle" },
      connection: ctx.connection,
      directory: "/repo",
      post: ctx.post,
      prepareDataAgent: prepare,
    })

    expect(prepare).not.toHaveBeenCalled()
    expect(ctx.state.style).toBe("unset")
    expect(ctx.posts).toEqual([{ type: "workStyleLoaded", style: "unset", dataAgentAvailable: false }])
  })

  it("skips Data preparation for persisted unset state when disabled", async () => {
    const ctx = setup("unset", false, false)
    const prepare = mock(async () => ({ available: true as const }))

    await handleWorkStyleMessage({
      message: { type: "requestWorkStyle" },
      connection: ctx.connection,
      directory: "/repo",
      post: ctx.post,
      prepareDataAgent: prepare,
    })

    expect(prepare).not.toHaveBeenCalled()
    expect(ctx.connection.getClientAsync).not.toHaveBeenCalled()
    expect(ctx.posts).toEqual([{ type: "workStyleLoaded", style: "unset", dataAgentAvailable: false }])
  })

  it("keeps a fresh profile loading until Data preparation finishes", async () => {
    const ctx = setup()
    const gate = Promise.withResolvers<{ available: true }>()
    const entered = Promise.withResolvers<void>()
    const prepare = mock(async () => {
      entered.resolve()
      return gate.promise
    })

    const pending = handleWorkStyleMessage({
      message: { type: "requestWorkStyle" },
      connection: ctx.connection,
      directory: "/repo",
      post: ctx.post,
      prepareDataAgent: prepare,
    })
    await entered.promise

    expect(ctx.posts).toEqual([])
    expect(ctx.state.style).toBeUndefined()

    gate.resolve({ available: true })
    expect(await pending).toBe(true)
    expect(ctx.state.style).toBe("unset")
    expect(ctx.posts).toEqual([{ type: "workStyleLoaded", style: "unset", dataAgentAvailable: true }])
  })

  it("falls back to one-page onboarding when Data is unavailable", async () => {
    const ctx = setup()
    const prepare = mock(async () => ({ available: false as const, reason: "install" as const }))

    await handleWorkStyleMessage({
      message: { type: "requestWorkStyle" },
      connection: ctx.connection,
      directory: "/repo",
      post: ctx.post,
      prepareDataAgent: prepare,
    })

    expect(ctx.state.style).toBe("unset")
    expect(ctx.posts).toEqual([{ type: "workStyleLoaded", style: "unset", dataAgentAvailable: false }])
  })

  it("bypasses Data preparation for configured and skipped profiles", async () => {
    for (const style of ["human-in-the-loop", "autonomous", "skipped"] as const) {
      const ctx = setup(style)
      const prepare = mock(async () => ({ available: true as const }))

      await handleWorkStyleMessage({
        message: { type: "requestWorkStyle" },
        connection: ctx.connection,
        directory: "/repo",
        post: ctx.post,
        prepareDataAgent: prepare,
      })

      expect(prepare).not.toHaveBeenCalled()
      expect(ctx.connection.getClientAsync).not.toHaveBeenCalled()
      expect(ctx.posts).toEqual([{ type: "workStyleLoaded", style, dataAgentAvailable: false }])
    }
  })

  it("skips Data preparation for existing sessions", async () => {
    const ctx = setup(undefined, true)
    const prepare = mock(async () => ({ available: true as const }))

    await handleWorkStyleMessage({
      message: { type: "requestWorkStyle" },
      connection: ctx.connection,
      directory: "/repo",
      post: ctx.post,
      prepareDataAgent: prepare,
    })

    expect(prepare).not.toHaveBeenCalled()
    expect(ctx.list).toHaveBeenCalledTimes(1)
    expect(ctx.state.style).toBe("skipped")
    expect(ctx.posts).toEqual([{ type: "workStyleLoaded", style: "skipped", dataAgentAvailable: false }])
  })

  it("rejects unsupported agents before connecting", async () => {
    const ctx = setup("unset")

    await handleWorkStyleMessage({
      message: { type: "applyWorkStyle", style: "autonomous", agent: "ask" },
      connection: ctx.connection,
      directory: "/repo",
      post: ctx.post,
    })

    expect(ctx.connection.getClientAsync).not.toHaveBeenCalled()
    expect(ctx.posts).toEqual([
      { type: "workStyleApplyFailed", message: "Invalid default agent", rollbackFailed: false },
    ])
  })

  it("prepares Data for persisted incomplete onboarding", async () => {
    const ctx = setup("unset")
    const prepare = mock(async () => ({ available: true as const }))

    await handleWorkStyleMessage({
      message: { type: "requestWorkStyle" },
      connection: ctx.connection,
      directory: "/repo",
      post: ctx.post,
      prepareDataAgent: prepare,
    })

    expect(prepare).toHaveBeenCalledTimes(1)
    expect(ctx.connection.getClientAsync).not.toHaveBeenCalled()
    expect(ctx.posts).toEqual([{ type: "workStyleLoaded", style: "unset", dataAgentAvailable: true }])
  })
})
