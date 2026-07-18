import { describe, expect, test } from "bun:test"
import { PROJECT_REGISTRY_STORAGE_KEY } from "../../src/agent-manager/project-registry-store"
import { projectIdFor } from "../../src/agent-manager/project-id"
import { type Project } from "../../src/agent-manager/project-registry"
import { ProjectUnknownError } from "../../src/agent-manager/project-router"
import { ProjectRouting } from "../../src/agent-manager/project-routing"
import type { ProjectContextDeps } from "../../src/agent-manager/project-context"
import { makeMemento } from "./_helpers/memento"

describe("ProjectRouting dual-path dispatch", () => {
  test("with projectId matching a registered project, root is the project's canonical root", async () => {
    const cloudId = projectIdFor("/Users/me/code/cloud")
    const project: Project = {
      id: cloudId,
      root: "/Users/me/code/cloud",
      order: 0,
      collapsed: false,
      trusted: false,
    }
    const memento = makeMemento()
    memento.seed({
      [PROJECT_REGISTRY_STORAGE_KEY]: JSON.stringify({ version: 1, projects: [project] }),
    })
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    expect(routing.resolveRoot(cloudId, "/Users/me/code/kilocode").root).toBe("/Users/me/code/cloud")
  })

  test("without projectId, root is the legacy workspaceFolders[0] root", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    expect(routing.resolveRoot(undefined, "/Users/me/code/kilocode").root).toBe("/Users/me/code/kilocode")
  })

  test("empty-string projectId is treated as absent (legacy path)", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    expect(routing.resolveRoot("", "/Users/me/code/kilocode").root).toBe("/Users/me/code/kilocode")
  })

  test("unknown projectId throws even when a legacy root exists", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    expect(() => routing.resolveRoot("ghost-id", "/Users/me/code/kilocode")).toThrow(ProjectUnknownError)
  })

  test("neither projectId nor legacy root throws (no process.cwd() fallback)", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    expect(() => routing.resolveRoot(undefined, undefined)).toThrow(ProjectUnknownError)
  })

  test("unknown projectId reference surfaces the offending id on the error", async () => {
    const memento = makeMemento()
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    try {
      routing.resolveRoot("abc-not-registered", undefined)
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectUnknownError)
      expect((err as ProjectUnknownError).projectId).toBe("abc-not-registered")
      return
    }
    throw new Error("expected throw")
  })

  test("webview-supplied arbitrary root is ignored: project route overrides any filesystem path the caller could send", async () => {
    const registered = projectIdFor("/Users/me/code/registered-repo")
    const project: Project = {
      id: registered,
      root: "/Users/me/code/registered-repo",
      order: 0,
      collapsed: false,
      trusted: false,
    }
    const memento = makeMemento()
    memento.seed({
      [PROJECT_REGISTRY_STORAGE_KEY]: JSON.stringify({ version: 1, projects: [project] }),
    })
    const routing = new ProjectRouting(memento, () => makeFactoryDeps())
    await routing.load()

    const resolution = routing.resolveRoot(registered, "/Users/me/code/totally-different-from-registry")
    expect(resolution).toEqual({ kind: "project", projectId: registered, root: "/Users/me/code/registered-repo" })
  })
})

function makeFactoryDeps(): ProjectContextDeps {
  return {
    buildWorktreeManager: () => ({ placeholder: true }),
  }
}
