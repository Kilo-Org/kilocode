import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { resolveProjectDirectory } from "../../src/project-directory"
import { selectRoot, selectedRoot, watchRoot } from "../../src/workspace-root"

const workspace = vscode.workspace as unknown as { workspaceFolders?: unknown }
const original = workspace.workspaceFolders

const context = () => {
  const store = new Map<string, unknown>()
  return {
    workspaceState: {
      get: (key: string) => store.get(key),
      update: async (key: string, value: unknown) => void store.set(key, value),
    },
  } as unknown as vscode.ExtensionContext
}

const use = (...paths: string[]) => {
  workspace.workspaceFolders = paths.map((fsPath) => ({ uri: { fsPath } }))
}

afterEach(() => {
  workspace.workspaceFolders = original
})

describe("project directory resolution", () => {
  it("preserves an explicit null project override", () => {
    expect(resolveProjectDirectory(null, () => "/repo-a")).toBeUndefined()
  })
})

describe("selected workspace root", () => {
  it("defaults to the first folder until one is picked", () => {
    use("/repo-a", "/repo-b")
    expect(selectedRoot(context())).toBe("/repo-a")
  })

  it("keeps the picked folder and tells every listener", async () => {
    use("/repo-a", "/repo-b")
    const ctx = context()
    const seen: string[] = []
    const watch = watchRoot(() => seen.push(selectedRoot(ctx) ?? ""))

    await selectRoot(ctx, "/repo-b")
    watch.dispose()
    await selectRoot(ctx, "/repo-a")

    expect(selectedRoot(ctx)).toBe("/repo-a")
    expect(seen).toEqual(["/repo-b"])
  })

  it("falls back to the first folder when the picked one was removed", async () => {
    use("/repo-a", "/repo-b")
    const ctx = context()
    await selectRoot(ctx, "/repo-b")
    use("/repo-a")
    expect(selectedRoot(ctx)).toBe("/repo-a")
  })

  it("is undefined without workspace folders", () => {
    use()
    expect(selectedRoot(context())).toBeUndefined()
  })
})
