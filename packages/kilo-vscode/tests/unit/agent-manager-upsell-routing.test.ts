import { describe, expect, it } from "bun:test"
import type { ProjectContexts } from "../../src/agent-manager/project/contexts"
import { openUpsellTab, type UpsellDeps } from "../../src/agent-manager/upsell"
import { handleSidebarWorktreeMessage } from "../../src/kilo-provider/sidebar-worktree"

function host(active = "project-b") {
  const calls: string[] = []
  const messages: unknown[] = []
  const errors: string[] = []
  const projects = [{ id: "project-a" }, { id: "project-b" }]
  const state = { active: projects.find((project) => project.id === active) }
  const contexts = {
    byDirectory: (directory: string) => (directory === "/chat/project-a" ? projects.at(0) : undefined),
    active: () => state.active,
    activate: (id: string) => {
      calls.push(`context:${id}`)
      state.active = projects.find((project) => project.id === id)
      return state.active
    },
  } as unknown as ProjectContexts
  const deps: UpsellDeps = {
    directories: () => new Map(),
    activate: (project) => void calls.push(`rewire:${project.id}`),
    projects: () => void calls.push("projects"),
    open: () => void calls.push("open"),
    state: async () => void calls.push("state"),
    ready: async () => {
      calls.push("ready")
      return true
    },
    post: (message) => {
      calls.push("post")
      messages.push(message)
    },
    error: (message) => void errors.push(message),
  }
  return { contexts, deps, calls, messages, errors }
}

describe("Agent Manager upsell routing", () => {
  it("activates and publishes the chat's project before opening a project-qualified tab", async () => {
    const fake = host()

    expect(await openUpsellTab("/chat/project-a", fake.contexts, fake.deps)).toBe(true)

    expect(fake.calls).toEqual(["context:project-a", "rewire:project-a", "projects", "open", "state", "ready", "post"])
    expect(fake.messages).toEqual([{ type: "agentManager.openUpsellTab", projectId: "project-a" }])
    expect(fake.errors).toEqual([])
  })

  it("does not reset the already active project", async () => {
    const fake = host("project-a")

    expect(await openUpsellTab("/chat/project-a", fake.contexts, fake.deps)).toBe(true)

    expect(fake.calls).toEqual(["open", "state", "ready", "post"])
    expect(fake.messages).toEqual([{ type: "agentManager.openUpsellTab", projectId: "project-a" }])
  })

  it.each(["/unknown", undefined])(
    "opens only the panel and reports an unregistered directory: %s",
    async (directory) => {
      const fake = host()

      expect(await openUpsellTab(directory, fake.contexts, fake.deps)).toBe(false)

      expect(fake.calls).toEqual(["open"])
      expect(fake.contexts.active()?.id).toBe("project-b")
      expect(fake.messages).toEqual([])
      expect(fake.errors).toEqual([expect.stringContaining("Add the project in Agent Manager")])
    },
  )

  it("does not post when the panel closes before ready", async () => {
    const fake = host()
    fake.deps.ready = async () => false

    expect(await openUpsellTab("/chat/project-a", fake.contexts, fake.deps)).toBe(false)

    expect(fake.messages).toEqual([])
  })

  it.each(["state", "ready"] as const)("does not steal focus after a project switch during %s", async (phase) => {
    const fake = host()
    const entered = Promise.withResolvers<void>()
    const resumed = Promise.withResolvers<void>()
    fake.deps[phase] = async () => {
      entered.resolve()
      await resumed.promise
      return true
    }

    const pending = openUpsellTab("/chat/project-a", fake.contexts, fake.deps)
    await entered.promise
    fake.contexts.activate("project-b")
    resumed.resolve()

    expect(await pending).toBe(false)
    expect(fake.contexts.active()?.id).toBe("project-b")
    expect(fake.messages).toEqual([])
  })

  it("routes the sidebar chat directory rather than opening the generic panel", async () => {
    const fake = host()
    const directories: Array<string | undefined> = []
    const handled = await handleSidebarWorktreeMessage(
      { type: "openAgentManagerUpsell" },
      {
        directory: "/chat/project-a",
        openAgentManagerUpsell: async (directory) => {
          directories.push(directory)
          return openUpsellTab(directory, fake.contexts, fake.deps)
        },
        post: () => {},
        openAgentManager: async () => {
          throw new Error("Must use project routing")
        },
        openAdvancedWorktree: async () => {},
        openChanges: async () => {},
        openProfile: async () => {},
      },
    )

    expect(handled).toBe(true)
    expect(directories).toEqual(["/chat/project-a"])
    expect(fake.messages).toEqual([{ type: "agentManager.openUpsellTab", projectId: "project-a" }])
  })
})
