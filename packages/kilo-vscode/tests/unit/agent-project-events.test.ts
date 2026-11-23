import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { ProjectScope } from "../../src/agent-manager/project/scope"
import { ProjectContext } from "../../src/agent-manager/project/context"
import type { PanelHandle } from "../../src/agent-manager/host"
import { backgroundCreated } from "../../webview-ui/agent-manager/project/local-tabs"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"

const { AgentManagerProvider } = await import("../../src/agent-manager/AgentManagerProvider")

describe("Agent Manager project event ownership", () => {
  it("keeps repo info with its source when activation changes during Git reads", async () => {
    const wait = Promise.withResolvers<string>()
    const posted: unknown[] = []
    let active = { id: "a" }
    const provider = Object.assign(Object.create(AgentManagerProvider.prototype), {
      projectScope: new ProjectScope(),
      contexts: { active: () => active },
      getWorktreeManager: () => ({ currentBranch: () => wait.promise, defaultBranch: async () => "a-main" }),
      postToWebview: (message: unknown) => posted.push(message),
      log: () => undefined,
    })
    const pending = provider.sendRepoInfo()
    active = { id: "b" }
    wait.resolve("a-feature")
    await pending
    expect(posted).toEqual([
      { type: "agentManager.repoInfo", projectId: "a", branch: "a-feature", defaultBranch: "a-main" },
    ])
  })

  it("qualifies external session registration with its async source rather than the visible project", async () => {
    const scope = new ProjectScope()
    const ctx = new ProjectContext("b", "/repo/b", false, { log: () => undefined })
    let qualifier: (() => string | undefined) | undefined
    const provider = Object.assign(Object.create(AgentManagerProvider.prototype), {
      projectScope: scope,
      contexts: { active: () => ({ id: "a" }) },
      host: {
        capture: () => undefined,
        openPanel: (opts: { sessionProject: () => string | undefined }) => {
          qualifier = opts.sessionProject
          return {} as PanelHandle
        },
      },
      attachPanel: () => undefined,
      log: () => undefined,
    })
    provider.openPanel(true)
    expect(qualifier?.()).toBe("a")
    await scope.run(ctx, async () => {
      await Promise.resolve()
      expect(qualifier?.()).toBe("b")
    })
    expect(qualifier?.()).toBe("a")
  })

  it("retains background local creations, replaces drafts, and excludes worktree sessions", () =>
    createRoot((dispose) => {
      const foreground = createProjectStore("a", { tabs: ["ses-a"] })
      const background = createProjectStore("b", { tabs: ["pending-b"] })
      const created = {
        type: "sessionCreated" as const,
        projectId: "b",
        draftID: "pending-b",
        session: { id: "ses-b", parentID: null, createdAt: "", updatedAt: "" },
      }
      expect(backgroundCreated(background, created)).toBe(true)
      expect(background.tabs.ids()).toEqual(["ses-b"])
      expect(backgroundCreated(background, created)).toBe(false)
      background.setManagedSessions([{ id: "ses-wt", worktreeId: "wt-b", createdAt: "" }])
      expect(
        backgroundCreated(background, {
          ...created,
          draftID: undefined,
          session: { ...created.session, id: "ses-wt" },
        }),
      ).toBe(false)
      expect(background.tabs.ids()).toEqual(["ses-b"])
      expect(foreground.tabs.ids()).toEqual(["ses-a"])
      dispose()
    }))
})
