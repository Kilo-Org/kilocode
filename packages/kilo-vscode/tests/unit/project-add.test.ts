import { describe, expect, test } from "bun:test"
import {
  addProjectToRegistry,
  parseFolderInput,
  setProjectCollapsed,
  validateScheme,
  ProjectAddInvalidInputError,
  ProjectUnsupportedSchemeError,
} from "../../src/agent-manager/project-add"
import { type Project, type ProjectRegistry } from "../../src/agent-manager/project-registry"
import { projectIdFor } from "../../src/agent-manager/project-id"

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: projectIdFor("/Users/me/code/kilocode"),
    root: "/Users/me/code/kilocode",
    order: 0,
    collapsed: false,
    trusted: false,
    ...overrides,
  }
}

function emptyRegistry(): ProjectRegistry {
  return { version: 1, projects: [] }
}

describe("parseFolderInput", () => {
  test("parses a plain filesystem path as a file scheme", () => {
    expect(parseFolderInput("/Users/me/code/cloud")).toEqual({
      scheme: "file",
      authority: null,
      path: "/Users/me/code/cloud",
    })
  })

  test("parses a windows-style path as a file scheme", () => {
    expect(parseFolderInput("C:\\code\\cloud")).toEqual({
      scheme: "file",
      authority: null,
      path: "C:\\code\\cloud",
    })
  })

  test("parses a file URI with fsPath", () => {
    const uri = { scheme: "file", fsPath: "/Users/me/code/cloud" }
    expect(parseFolderInput(uri)).toEqual({
      scheme: "file",
      authority: null,
      path: "/Users/me/code/cloud",
    })
  })

  test("parses a remote URI with authority and path", () => {
    const uri = {
      scheme: "vscode-remote",
      authority: "ssh-remote+host",
      path: "/home/me/repo",
    }
    expect(parseFolderInput(uri)).toEqual({
      scheme: "vscode-remote",
      authority: "ssh-remote+host",
      path: "/home/me/repo",
    })
  })

  test("rejects an empty string", () => {
    expect(() => parseFolderInput("   ")).toThrow(ProjectAddInvalidInputError)
  })

  test("rejects a URI without fsPath or path", () => {
    expect(() => parseFolderInput({ scheme: "file" })).toThrow(ProjectAddInvalidInputError)
  })

  test("rejects a non-string non-object input", () => {
    expect(() => parseFolderInput(42 as unknown)).toThrow(ProjectAddInvalidInputError)
  })
})

describe("validateScheme", () => {
  test("accepts the file scheme with a path", () => {
    const folder = parseFolderInput("/Users/me/code/cloud")
    expect(validateScheme(folder)).toEqual({ folder, candidate: "/Users/me/code/cloud" })
  })

  test("rejects the vscode-vfs scheme", () => {
    const folder = parseFolderInput({ scheme: "vscode-vfs", path: "/virtual" })
    expect(() => validateScheme(folder)).toThrow(ProjectUnsupportedSchemeError)
  })

  test("rejects the git scheme", () => {
    const folder = parseFolderInput({ scheme: "git", path: "/somewhere" })
    expect(() => validateScheme(folder)).toThrow(ProjectUnsupportedSchemeError)
  })

  test("accepts vscode-remote schemes (canonical-root helper surfaces unreachable authority later)", () => {
    const folder = parseFolderInput({ scheme: "vscode-remote", authority: "ssh-remote+host", path: "/home/me/repo" })
    const validated = validateScheme(folder)
    expect(validated.candidate).toBe("/home/me/repo")
  })

  test("rejects a file scheme without a path", () => {
    // parseFolderInput already throws for a `{ scheme: "file" }` object without
    // a path; verify the upstream guard fires.
    expect(() => parseFolderInput({ scheme: "file" })).toThrow(ProjectAddInvalidInputError)
  })
})

describe("addProjectToRegistry", () => {
  test("registers a fresh canonical root with deterministic id, label, and order", async () => {
    const commits: ProjectRegistry[] = []
    const result = await addProjectToRegistry("/Users/me/code/cloud", {
      registry: emptyRegistry(),
      canonicalRoot: async (input) => `/canonical${input.replace("/Users/me/code", "")}`,
      commit: async (next) => {
        commits.push(next)
      },
      now: () => new Date("2026-07-18T12:00:00Z"),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.deduplicated).toBe(false)
    expect(result.project.id).toBe(projectIdFor("/canonical/cloud"))
    expect(result.project.root).toBe("/canonical/cloud")
    expect(result.project.label).toBe("cloud")
    expect(result.project.order).toBe(0)
    expect(result.project.trusted).toBe(false)
    expect(result.project.collapsed).toBe(false)
    expect(commits).toHaveLength(1)
  })

  test("dedups against an existing entry with the same canonical root", async () => {
    const existing = makeProject({
      id: projectIdFor("/canonical/cloud"),
      root: "/canonical/cloud",
      order: 5,
    })
    const commits: ProjectRegistry[] = []
    const result = await addProjectToRegistry("/Users/me/code/cloud", {
      registry: { version: 1, projects: [existing] },
      canonicalRoot: async () => "/canonical/cloud",
      commit: async (next) => {
        commits.push(next)
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.deduplicated).toBe(true)
    expect(result.project.id).toBe(existing.id)
    expect(commits).toHaveLength(0)
  })

  test("rejects a folder with an unsupported scheme", async () => {
    const result = await addProjectToRegistry({ scheme: "vscode-vfs", path: "/virtual" }, { registry: emptyRegistry() })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe("unsupported_scheme")
  })

  test("rejects a folder that is not inside a Git repository", async () => {
    const result = await addProjectToRegistry("/Users/me/code/notgit", {
      registry: emptyRegistry(),
      canonicalRoot: async () => {
        throw new (await import("../../src/agent-manager/project-canonical-root")).NotAGitRepositoryError(
          "/Users/me/code/notgit",
        )
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe("not_a_git_repo")
  })

  test("rejects when canonical root cannot be resolved (ENOENT)", async () => {
    const result = await addProjectToRegistry("/Users/me/code/noent", {
      registry: emptyRegistry(),
      canonicalRoot: async () => {
        const { CanonicalRootUnavailableError } = await import("../../src/agent-manager/project-canonical-root")
        throw new CanonicalRootUnavailableError("/Users/me/code/noent", { code: "ENOENT" })
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe("canonical_root_unavailable")
  })

  test("appends the next project at order = max(order) + 1", async () => {
    const existing = [makeProject({ id: "a", root: "/a", order: 0 }), makeProject({ id: "b", root: "/b", order: 7 })]
    const result = await addProjectToRegistry("/Users/me/code/cloud", {
      registry: { version: 1, projects: existing },
      canonicalRoot: async () => "/canonical/cloud",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.order).toBe(8)
  })

  test("uses the registry's active project id when one is not already set", async () => {
    const commits: ProjectRegistry[] = []
    const result = await addProjectToRegistry("/Users/me/code/cloud", {
      registry: emptyRegistry(),
      canonicalRoot: async () => "/canonical/cloud",
      commit: async (next) => {
        commits.push(next)
      },
    })
    expect(result.ok).toBe(true)
    expect(commits[0]?.activeProjectId).toBe(result.ok ? result.project.id : undefined)
  })

  test("preserves a pre-existing active project id", async () => {
    const existing = makeProject({ id: "existing-active", root: "/existing", order: 0 })
    const commits: ProjectRegistry[] = []
    const result = await addProjectToRegistry("/Users/me/code/cloud", {
      registry: { version: 1, projects: [existing], activeProjectId: "existing-active" },
      canonicalRoot: async () => "/canonical/cloud",
      commit: async (next) => {
        commits.push(next)
      },
    })
    expect(result.ok).toBe(true)
    expect(commits[0]?.activeProjectId).toBe("existing-active")
  })
})

describe("setProjectCollapsed", () => {
  test("flips the collapsed flag on the matching project", () => {
    const a = makeProject({ id: "a", root: "/a", collapsed: false })
    const next = setProjectCollapsed({ version: 1, projects: [a] }, "a", true)
    expect(next.projects[0]?.collapsed).toBe(true)
  })

  test("leaves other projects untouched", () => {
    const a = makeProject({ id: "a", root: "/a", collapsed: false })
    const b = makeProject({ id: "b", root: "/b", collapsed: true })
    const next = setProjectCollapsed({ version: 1, projects: [a, b] }, "a", true)
    expect(next.projects[1]?.collapsed).toBe(true)
  })
})
