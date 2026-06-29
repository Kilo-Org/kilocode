import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import {
  applyVSCodeExtensionRequirements,
  requirementDirectory,
  requirementKey,
  type BackendAgentRequirementResult,
  type HostAgentRequirementResult,
} from "../../src/kilo-provider/agent-requirements"
import { AgentRequirementsController } from "../../src/kilo-provider/agent-requirements-controller"
import { keepAgentRequirementsResult } from "../../webview-ui/src/context/agent-requirements-state"

const root = "/repo"

function result(input: Partial<BackendAgentRequirementResult> = {}): BackendAgentRequirementResult {
  return {
    agent: "demo",
    directory: root,
    enabled: true,
    state: "ready",
    skills: [],
    mcps: [],
    vscode_extensions: [],
    ...input,
  }
}

function client(value: BackendAgentRequirementResult | (() => BackendAgentRequirementResult)) {
  const calls: Array<{ agent: string; directory: string }> = []
  const api = {
    kilocode: {
      agentRequirements: async (parameters: { agent: string; directory: string }) => {
        calls.push(parameters)
        return { data: typeof value === "function" ? value() : value }
      },
    },
  } as unknown as KiloClient
  return { calls, api }
}

function controller(
  input: {
    api?: KiloClient | null
    posts?: unknown[]
    sessions?: ReadonlyMap<string, string>
    worktrees?: () => readonly string[]
    extensions?: ReadonlySet<string>
    subscribe?: (listener: () => void) => { dispose(): void }
  } = {},
) {
  const posts = input.posts ?? []
  return new AgentRequirementsController({
    post: (message) => posts.push(message),
    client: () => input.api ?? null,
    connected: () => true,
    generation: () => 1,
    root: () => root,
    folders: () => [root, "/workspace"],
    project: () => root,
    sessions: () => input.sessions ?? new Map(),
    worktrees: input.worktrees,
    extension: (id) => input.extensions?.has(id),
    subscribe: input.subscribe,
    error: (error) => (error instanceof Error ? error.message : String(error)),
  })
}

describe("agent requirement helpers", () => {
  it("builds stable cache keys from normalized directories", () => {
    expect(requirementKey("demo", "/repo/./subdir")).toBe(requirementKey("demo", "/repo/subdir"))
    expect(requirementKey("other", "/repo/subdir")).not.toBe(requirementKey("demo", "/repo/subdir"))
  })

  it("scopes requests to active workspace, session, and worktree directories", () => {
    const sessions = new Map([["session-1", "/repo/.kilo/worktrees/one"]])
    const base = {
      workspaceDirectory: root,
      workspaceDirectories: ["/workspace"],
      projectDirectory: root,
      sessionDirectories: sessions,
      worktreeDirectories: () => ["/repo/.kilo/worktrees/two"],
    }

    expect(requirementDirectory({ ...base, requested: "/repo" })).toBe(root)
    expect(requirementDirectory({ ...base, requested: "/repo/.kilo/worktrees/one", sessionID: "session-1" })).toBe(
      "/repo/.kilo/worktrees/one",
    )
    expect(requirementDirectory({ ...base, requested: "/repo/.kilo/worktrees/two" })).toBe("/repo/.kilo/worktrees/two")
    expect(requirementDirectory({ ...base, requested: "/other" })).toBeUndefined()
  })

  it("adds VS Code extension statuses and blocks ready backend results when extensions are missing", () => {
    const checked = applyVSCodeExtensionRequirements(
      result({
        vscode_extensions: [
          { name: "Ready Extension", id: "publisher.ready" },
          { name: "Missing Extension", id: "publisher.missing" },
        ],
      }),
      (id) => id === "publisher.ready",
    )

    expect(checked.state).toBe("blocked")
    expect(checked.vscode_extensions).toEqual([
      { name: "Ready Extension", id: "publisher.ready", status: "ready" },
      { name: "Missing Extension", id: "publisher.missing", status: "missing" },
    ])
  })
})

describe("agent requirement webview state", () => {
  const blocked: HostAgentRequirementResult = {
    ...result({ state: "blocked", skills: [{ name: "skill", status: "missing" }] }),
    vscode_extensions: [],
  }

  it("preserves ready, blocked, and error results only for the same agent and directory", () => {
    expect(keepAgentRequirementsResult(blocked, "demo", root)).toBe(true)
    expect(keepAgentRequirementsResult({ ...blocked, state: "error" }, "demo", root)).toBe(true)
    expect(keepAgentRequirementsResult({ ...blocked, state: "ready" }, "demo", root)).toBe(true)
    expect(keepAgentRequirementsResult({ ...blocked, state: "disabled" }, "demo", root)).toBe(false)
    expect(keepAgentRequirementsResult(blocked, "other", root)).toBe(false)
    expect(keepAgentRequirementsResult(blocked, "demo", "/other")).toBe(false)
  })
})

describe("AgentRequirementsController", () => {
  it("caches fetched results until invalidated", async () => {
    const posts: unknown[] = []
    const backend = client(result())
    const requirements = controller({ api: backend.api, posts })

    await requirements.fetch({ agent: "demo", directory: root })
    await requirements.fetch({ agent: "demo", directory: root })
    requirements.clear()
    await requirements.fetch({ agent: "demo", directory: root })

    expect(backend.calls).toEqual([
      { agent: "demo", directory: root },
      { agent: "demo", directory: root },
    ])
    expect(
      posts.filter((message) => (message as { type?: string }).type === "agentRequirementsInvalidated"),
    ).toHaveLength(1)
  })

  it("posts scope mismatch errors for inactive directories", async () => {
    const posts: unknown[] = []
    const backend = client(result())
    const requirements = controller({ api: backend.api, posts })

    await requirements.fetch({ agent: "demo", directory: "/other" })

    expect(backend.calls).toEqual([])
    expect(posts.at(-1)).toMatchObject({
      type: "agentRequirementsLoaded",
      result: { state: "error", error: { code: "scope_mismatch" } },
    })
  })

  it("clears requirements when the extension subscription fires", async () => {
    const posts: unknown[] = []
    let listener: (() => void) | undefined
    let disposed = false
    const backend = client(result())
    const requirements = controller({
      api: backend.api,
      posts,
      subscribe: (fn) => {
        listener = fn
        return { dispose: () => void (disposed = true) }
      },
    })

    await requirements.fetch({ agent: "demo", directory: root })
    posts.length = 0
    listener?.()
    requirements.dispose()

    expect(posts).toEqual([{ type: "agentRequirementsInvalidated" }])
    expect(disposed).toBe(true)
  })

  it("asserts and reports blocked requirements before host sends", async () => {
    const posts: unknown[] = []
    const backend = client(
      result({
        vscode_extensions: [{ name: "Missing Extension", id: "publisher.missing" }],
      }),
    )
    const requirements = controller({ api: backend.api, posts })

    await expect(requirements.assertAgentRequirements("demo", root)).rejects.toThrow(
      "VS Code extension Missing Extension",
    )
    expect(posts.at(-1)).toMatchObject({
      type: "agentRequirementsLoaded",
      result: { state: "blocked", vscode_extensions: [{ status: "missing" }] },
    })
  })
})
