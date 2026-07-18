import { describe, expect, test } from "bun:test"
import {
  handleAddProject,
  handleAddProjectToWorkspace,
  handleRemoveProject,
  handleToggleProjectCollapsed,
} from "../../src/agent-manager/project-messages"
import { ProjectRouting } from "../../src/agent-manager/project-routing"
import { projectIdFor } from "../../src/agent-manager/project-id"
import type { ProjectContextDeps } from "../../src/agent-manager/project-context"
import { makeMemento } from "./_helpers/memento"

function factoryDeps(): ProjectContextDeps {
  return { buildWorktreeManager: () => ({ placeholder: true }) }
}

interface CapturedDeps {
  routing: ProjectRouting
  posted: unknown[]
  errors: string[]
  logs: unknown[][]
  picked: Array<{ title?: string; openLabel?: string } | undefined>
  addedFolders: string[]
  statePushes: number
  persisted: unknown[]
}

async function makeDeps(
  canonical: (input: string) => Promise<string> = async (i) => `/canonical${i.replace(/.*code/, "")}`,
): Promise<CapturedDeps> {
  const memento = makeMemento()
  const routing = new ProjectRouting(
    memento,
    () => factoryDeps(),
    () => {},
    canonical,
  )
  await routing.load()
  const captured: CapturedDeps = {
    routing,
    posted: [],
    errors: [],
    logs: [],
    picked: [],
    addedFolders: [],
    statePushes: 0,
    persisted: [],
  }
  return captured
}

function buildDeps(captured: CapturedDeps) {
  return {
    routing: captured.routing,
    postToWebview: (msg: unknown) => captured.posted.push(msg),
    showError: (msg: string) => captured.errors.push(msg),
    log: (...args: unknown[]) => captured.logs.push(args),
    pickFolder: async (opts?: { title?: string; openLabel?: string }) => {
      captured.picked.push(opts)
      return undefined
    },
    addFolderToWorkspace: (path: string) => captured.addedFolders.push(path),
    pushState: () => captured.statePushes++,
  }
}

describe("project-messages handlers", () => {
  test("handleAddProject is a no-op when the user cancels the picker", async () => {
    const captured = await makeDeps()
    const deps = buildDeps(captured)
    await handleAddProject(deps)
    expect(captured.picked).toHaveLength(1)
    expect(captured.errors).toEqual([])
    expect(captured.statePushes).toBe(0)
    expect(captured.posted).toEqual([])
  })

  test("handleAddProject registers the picked folder and pushes state", async () => {
    const captured = await makeDeps()
    const deps = {
      ...buildDeps(captured),
      pickFolder: async () => "/Users/me/code/newproject",
    }
    await handleAddProject(deps)
    expect(captured.errors).toEqual([])
    expect(captured.statePushes).toBe(1)
    expect(captured.routing.snapshot().projects).toHaveLength(1)
  })

  test("handleAddProject posts an info toast on dedup", async () => {
    const existing = {
      id: projectIdFor("/canonical/cloud"),
      root: "/canonical/cloud",
      order: 0,
      collapsed: false,
      trusted: false,
    }
    const memento = makeMemento()
    memento.seed({
      "kilo.agentManager.projectRegistry.v1": JSON.stringify({ version: 1, projects: [existing] }),
    })
    const routing = new ProjectRouting(
      memento,
      () => factoryDeps(),
      () => {},
      async () => "/canonical/cloud",
    )
    await routing.load()
    const captured: CapturedDeps = {
      routing,
      posted: [],
      errors: [],
      logs: [],
      picked: [],
      addedFolders: [],
      statePushes: 0,
      persisted: [],
    }
    const deps = {
      ...buildDeps(captured),
      pickFolder: async () => "/Users/me/code/cloud",
    }
    await handleAddProject(deps)
    expect(captured.posted[0]).toMatchObject({ type: "agentManager.projectToast", level: "info" })
    expect(captured.statePushes).toBe(1)
  })

  test("handleAddProject surfaces an error message for an unsupported scheme", async () => {
    const captured = await makeDeps()
    const deps = {
      ...buildDeps(captured),
      pickFolder: async () => ({ scheme: "vscode-vfs", path: "/virtual" }),
    }
    await handleAddProject(deps)
    expect(captured.errors).toHaveLength(1)
    expect(captured.errors[0]).toContain("vscode-vfs")
    expect(captured.statePushes).toBe(0)
  })

  test("handleRemoveProject removes the project and pushes state", async () => {
    const captured = await makeDeps()
    // Add a project first so removal has work to do.
    await captured.routing.addProject("/Users/me/code/cloud")
    const project = captured.routing.snapshot().projects[0]
    expect(project).toBeDefined()

    const deps = buildDeps(captured)
    await handleRemoveProject(project!.id, deps)
    expect(captured.routing.snapshot().projects).toHaveLength(0)
    expect(captured.statePushes).toBe(1)
  })

  test("handleRemoveProject is a no-op when the project id does not resolve", async () => {
    const captured = await makeDeps()
    const deps = buildDeps(captured)
    await handleRemoveProject("missing-id", deps)
    expect(captured.statePushes).toBe(0)
  })

  test("handleToggleProjectCollapsed flips the flag and pushes state", async () => {
    const captured = await makeDeps()
    await captured.routing.addProject("/Users/me/code/cloud")
    const project = captured.routing.snapshot().projects[0]!

    const deps = buildDeps(captured)
    await handleToggleProjectCollapsed(project.id, true, deps)
    expect(captured.routing.getProject(project.id)?.collapsed).toBe(true)
    expect(captured.statePushes).toBe(1)
  })

  test("handleAddProjectToWorkspace forwards the canonical root to the host", async () => {
    const captured = await makeDeps()
    await captured.routing.addProject("/Users/me/code/cloud")
    const project = captured.routing.snapshot().projects[0]!

    const deps = buildDeps(captured)
    handleAddProjectToWorkspace(project.id, deps)
    expect(captured.addedFolders).toEqual([project.root])
  })

  test("handleAddProjectToWorkspace is a no-op for an unknown project", async () => {
    const captured = await makeDeps()
    const deps = buildDeps(captured)
    handleAddProjectToWorkspace("missing-id", deps)
    expect(captured.addedFolders).toEqual([])
  })
})
