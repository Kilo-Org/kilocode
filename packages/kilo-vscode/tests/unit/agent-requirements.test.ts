import { describe, expect, test } from "bun:test"
import type { AgentRequirementResult } from "@kilocode/sdk/v2/client"
import {
  applyVSCodeExtensionRequirements,
  createAgentRequirementsInstaller,
  installRequirements,
  requirementDirectory,
  requirementKey,
} from "../../src/kilo-provider/agent-requirements"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import type { MarketplaceItem } from "../../src/services/marketplace/types"

const result: AgentRequirementResult = {
  agent: "code",
  directory: "/repo/worktree-a",
  enabled: true,
  state: "blocked",
  skills: [
    { name: "first", marketplace: "first", status: "missing" },
    { name: "second", marketplace: "second", status: "missing" },
    { name: "third", marketplace: "third", status: "missing" },
  ],
  vscode_extensions: [],
  mcps: [],
}

function skill(id: string): Extract<MarketplaceItem, { type: "skill" }> {
  return {
    type: "skill",
    id,
    name: id,
    displayName: id,
    description: id,
    category: "testing",
    displayCategory: "Testing",
    githubUrl: id,
    content: id,
  }
}

describe("agent requirement orchestration", () => {
  test("keys cached status by directory and agent", () => {
    expect(requirementKey("code", "/repo/a")).not.toBe(requirementKey("code", "/repo/b"))
    expect(requirementKey("code", "/repo/a")).not.toBe(requirementKey("plan", "/repo/a"))
  })

  test("accepts only active session and worktree scopes", () => {
    const sessions = new Map([["session-a", "/repo/worktree-a"]])
    expect(
      requirementDirectory({
        requested: "/repo/worktree-a",
        session: "session-a",
        root: "/repo",
        sessions,
        worktrees: [],
      }),
    ).toBe("/repo/worktree-a")
    expect(
      requirementDirectory({
        requested: "/repo/worktree-b",
        session: "session-a",
        root: "/repo",
        sessions,
        worktrees: ["/repo/worktree-b"],
      }),
    ).toBeUndefined()
    expect(
      requirementDirectory({
        requested: "/repo/worktree-b",
        root: "/repo",
        sessions,
        worktrees: ["/repo/worktree-b"],
      }),
    ).toBe("/repo/worktree-b")
  })

  test("blocks when a required VS Code extension is missing", () => {
    const checked = applyVSCodeExtensionRequirements({
      result: {
        ...result,
        state: "ready",
        skills: result.skills.map((item) => ({ ...item, status: "ready" as const })),
        vscode_extensions: [{ name: "Jupyter", id: "ms-toolsai.jupyter" }],
      },
      installed: () => false,
    })

    expect(checked.state).toBe("blocked")
    expect(checked.vscode_extensions).toEqual([{ name: "Jupyter", id: "ms-toolsai.jupyter", status: "missing" }])
  })

  test("keeps ready state when required VS Code extensions are installed", () => {
    const checked = applyVSCodeExtensionRequirements({
      result: {
        ...result,
        state: "ready",
        skills: [],
        vscode_extensions: [{ name: "Jupyter", id: "ms-toolsai.jupyter" }],
      },
      installed: () => true,
    })

    expect(checked.state).toBe("ready")
    expect(checked.vscode_extensions).toEqual([{ name: "Jupyter", id: "ms-toolsai.jupyter", status: "ready" }])
  })

  test("invalidates shared directories once and notifies every provider", async () => {
    const service = new KiloConnectionService({} as never)
    const disposed: string[] = []
    const client = {
      instance: {
        dispose: async (input: { directory: string }) => {
          disposed.push(input.directory)
          return { data: true }
        },
      },
    }
    ;(service as unknown as { client: typeof client }).client = client
    service.registerDirectoryProvider(() => ["/repo", "/repo/worktree-a"])
    service.registerDirectoryProvider(() => ["/repo", "/repo/worktree-b"])

    const notified: string[] = []
    service.onAgentRequirementsInvalidated(() => notified.push("sidebar"))
    service.onAgentRequirementsInvalidated(async () => {
      notified.push("agent-manager")
    })

    await service.invalidateAgentRequirements()

    expect(disposed.sort()).toEqual(["/repo", "/repo/worktree-a", "/repo/worktree-b"])
    expect(notified.sort()).toEqual(["agent-manager", "sidebar"])
  })

  test("installs through shared services and invalidates discovery", async () => {
    const installed: string[] = []
    const disposed: string[] = []
    const updates: string[][] = []
    let invalidated = 0
    const installer = createAgentRequirementsInstaller({
      connection: {
        getClientAsync: async () => ({
          global: { config: { update: async () => ({ data: {} }) } },
          instance: {
            dispose: async (input: { directory: string }) => {
              disposed.push(input.directory)
              return { data: true }
            },
          },
        }),
        invalidateAgentRequirements: async () => {
          invalidated += 1
        },
      } as never,
      marketplace: {
        fetchData: async () => ({
          marketplaceItems: [skill("first")],
          marketplaceInstalledMetadata: { project: {}, global: {} },
        }),
        install: async (item: MarketplaceItem) => {
          installed.push(item.id)
          return { success: true, slug: item.id }
        },
      } as never,
    })

    await installer({
      result: { ...result, skills: [result.skills[0]!] },
      directory: result.directory,
      progress: (items) => updates.push(items.map((item) => `${item.marketplace}:${item.status}`)),
    })

    expect(installed).toEqual(["first"])
    expect(disposed).toEqual([result.directory])
    expect(invalidated).toBe(1)
    expect(updates.at(-1)).toEqual(["first:succeeded"])
  })

  test("continues a batch after installation and lookup failures", async () => {
    const attempted: string[] = []
    const updates: string[][] = []
    const installs = await installRequirements({
      result,
      items: [skill("first"), skill("second")],
      progress: (items) => updates.push(items.map((item) => `${item.marketplace}:${item.status}`)),
      install: async (item) => {
        attempted.push(item.id)
        return item.id === "first"
          ? { success: true, slug: item.id }
          : { success: false, slug: item.id, error: "download failed" }
      },
    })

    expect(attempted).toEqual(["first", "second"])
    expect(installs).toEqual([
      { marketplace: "first", status: "succeeded" },
      { marketplace: "second", status: "failed", code: "installation_failed", error: "download failed" },
      { marketplace: "third", status: "failed", code: "skill_not_found" },
    ])
    expect(updates.at(-1)).toEqual(["first:succeeded", "second:failed", "third:failed"])
  })

  test("rejects wrong Marketplace item types and skips discovery errors", async () => {
    const attempted: string[] = []
    const installs = await installRequirements({
      result: {
        ...result,
        skills: [
          { name: "first", marketplace: "first", status: "missing" },
          { name: "scan", marketplace: "scan", status: "error", message: "scan failed" },
        ],
      },
      items: [
        {
          type: "mcp",
          id: "first",
          name: "first",
          description: "first",
          category: "testing",
          url: "https://example.com/first",
          content: "first",
        },
      ],
      progress: () => undefined,
      install: async (item) => {
        attempted.push(item.id)
        return { success: true, slug: item.id }
      },
    })

    expect(attempted).toEqual([])
    expect(installs).toEqual([{ marketplace: "first", status: "failed", code: "item_not_skill" }])
  })
})
