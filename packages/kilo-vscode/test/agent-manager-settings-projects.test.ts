import { describe, expect, it } from "bun:test"
import type { ProjectContext } from "../src/agent-manager/project/context"
import { createSettingsHandler } from "../src/agent-manager/project/settings"

describe("Agent Manager settings project rows", () => {
  it("returns the cached snapshot while the first project init is still running", async () => {
    const context = {
      id: "p1",
      root: "/repo",
      missing: () => false,
      lifecycle: "ready",
      generation: 1,
      ensureReady: () => new Promise(() => {}),
      peekState: () => ({ getDefaultBaseBranch: () => "main" }),
      peekSetup: () => ({ resolveScript: () => ({ path: "/repo/script/setup" }) }),
      setupService: () => ({ resolveScript: () => undefined }),
    } as unknown as ProjectContext
    const contexts = {
      snapshots: () => [{ id: "p1", root: "/repo", label: "repo", pinned: false, missing: false }],
      resolve: () => context,
      get: () => context,
    }
    const handler = createSettingsHandler({
      contexts: contexts as unknown as Parameters<typeof createSettingsHandler>[0]["contexts"],
      open: async () => {},
      push: () => {},
      log: () => {},
    })
    await expect(handler.projects("p1")).resolves.toEqual([
      {
        id: "p1",
        root: "/repo",
        label: "repo",
        pinned: false,
        missing: false,
        defaultBaseBranch: "main",
        setupScriptPath: "/repo/script/setup",
      },
    ])
  })
})
