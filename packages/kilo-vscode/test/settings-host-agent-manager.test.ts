// The Settings panel edits Agent Manager projects through the provider's shared handler. These tests pin the message
// contract between the panel host and that handler: which project is selected when the requested one is gone, the
// branch reply shape, and that both writes refresh the project snapshot.
import { describe, expect, it } from "bun:test"
import type { ExtensionContext } from "vscode"
import type { SettingsHandler, SettingsProject } from "../src/agent-manager/project/settings"
import type { ToHost, ToWebview } from "../src/protocol"
import { settingsHost } from "../src/settings-host"

const project = (id: string, extra: Partial<SettingsProject> = {}): SettingsProject => ({
  id,
  root: `/repo/${id}`,
  label: id,
  pinned: id === "p1",
  missing: false,
  ...extra,
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(handler?: SettingsHandler) {
  const posts: ToWebview[] = []
  const calls: string[] = []
  const fake: SettingsHandler = handler ?? {
    projects: async (projectId) => {
      calls.push(`projects:${projectId ?? ""}`)
      return [project("p1", { defaultBaseBranch: "main", setupScriptPath: "/repo/p1/setup.sh" }), project("p2")]
    },
    projectDirectory: () => undefined,
    defaultBranch: async () => "main",
    branches: async (projectId) => {
      calls.push(`branches:${projectId}`)
      return {
        projectId,
        branches: [{ name: "main", isLocal: true, isRemote: false, isDefault: true }],
        defaultBranch: "main",
        configuredBaseBranch: "release",
        setupScriptPath: "/repo/p1/setup.sh",
      }
    },
    setDefaultBaseBranch: async (projectId, branch) => {
      calls.push(`set:${projectId}:${branch ?? ""}`)
    },
    configureSetupScript: async (projectId) => {
      calls.push(`script:${projectId}`)
    },
  }
  const host = settingsHost({
    context: {
      extensionPath: "/test-extension",
      globalStorageUri: { fsPath: "/test-storage" },
    } as unknown as ExtensionContext,
    server: {} as never,
    directory: "/repo",
    post: (message) => posts.push(message),
    agentManager: () => fake,
  })
  const send = (message: ToHost) => host.handle(message)
  return { host, posts, calls, send }
}

describe("Settings panel Agent Manager rows", () => {
  it("selects the first project when the requested one is gone", async () => {
    const { posts, send } = setup()
    expect(send({ type: "agentManagerSettings", projectId: "missing", requestId: "1" })).toBe(true)
    await flush()
    expect(posts).toContainEqual({
      type: "agentManagerSettingsLoaded",
      requestId: "1",
      projectId: "p1",
      projects: [
        project("p1", { defaultBaseBranch: "main", setupScriptPath: "/repo/p1/setup.sh" }),
        project("p2"),
      ],
    })
  })

  it("keeps the requested project when it exists", async () => {
    const { posts, send } = setup()
    send({ type: "agentManagerSettings", projectId: "p2", requestId: "2" })
    await flush()
    expect(posts).toContainEqual({
      type: "agentManagerSettingsLoaded",
      requestId: "2",
      projectId: "p2",
      projects: [project("p1", { defaultBaseBranch: "main", setupScriptPath: "/repo/p1/setup.sh" }), project("p2")],
    })
  })

  it("answers a branch request with the branch rows", async () => {
    const { posts, calls, send } = setup()
    send({ type: "agentManagerSettingsBranches", projectId: "p1", requestId: "3" })
    await flush()
    expect(calls).toContain("branches:p1")
    expect(posts).toContainEqual({
      type: "agentManagerSettingsBranchesLoaded",
      requestId: "3",
      projectId: "p1",
      branches: [{ name: "main", isLocal: true, isRemote: false, isDefault: true }],
      defaultBranch: "main",
      configuredBaseBranch: "release",
      setupScriptPath: "/repo/p1/setup.sh",
    })
  })

  it("writes the default base branch and refreshes the snapshot", async () => {
    const { posts, calls, send } = setup()
    send({ type: "agentManagerSetDefaultBaseBranch", projectId: "p2", branch: "release", requestId: "4" })
    await flush()
    expect(calls).toEqual(["set:p2:release", "projects:p2"])
    expect(posts.some((message) => message.type === "agentManagerSettingsLoaded" && message.requestId === "4")).toBe(
      true,
    )
  })

  it("opens the setup script and refreshes the snapshot", async () => {
    const { posts, calls, send } = setup()
    send({ type: "agentManagerConfigureSetupScript", projectId: "p1", requestId: "5" })
    await flush()
    expect(calls).toEqual(["script:p1", "projects:p1"])
    expect(posts.some((message) => message.type === "agentManagerSettingsLoaded" && message.requestId === "5")).toBe(
      true,
    )
  })

  it("consumes the messages even without a provider handler", () => {
    const host = settingsHost({
      context: {
        extensionPath: "/test-extension",
        globalStorageUri: { fsPath: "/test-storage" },
      } as unknown as ExtensionContext,
      server: {} as never,
      directory: "/repo",
      post: () => {
        throw new Error("no reply without a handler")
      },
    })
    expect(host.handle({ type: "agentManagerSettings", requestId: "6" })).toBe(true)
  })
})
