import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { withinWorkspace } from "../../../../src/indexing/shared/within-workspace"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function layout() {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-within-workspace-"))
  roots.push(root)
  await mkdir(path.join(root, "workspace", "src"), { recursive: true })
  await mkdir(path.join(root, "outside"), { recursive: true })
  await Bun.write(path.join(root, "workspace", "src", "a.ts"), "export const a = 1\n")
  await Bun.write(path.join(root, "outside", "secret.ts"), "export const secret = 1\n")
  return root
}

describe("withinWorkspace", () => {
  test("accepts a regular file and a symlink that stays inside", async () => {
    const root = await layout()
    const workspace = path.join(root, "workspace")
    await symlink(path.join(workspace, "src", "a.ts"), path.join(workspace, "src", "alias.ts"))
    expect(await withinWorkspace(workspace, path.join(workspace, "src", "a.ts"))).toBe(true)
    expect(await withinWorkspace(workspace, path.join(workspace, "src", "alias.ts"))).toBe(true)
  })

  test("rejects a symlink that resolves outside the workspace", async () => {
    const root = await layout()
    const workspace = path.join(root, "workspace")
    await symlink(path.join(root, "outside", "secret.ts"), path.join(workspace, "src", "escape.ts"))
    expect(await withinWorkspace(workspace, path.join(workspace, "src", "escape.ts"))).toBe(false)
  })

  test("rejects a regular file reached through a symlinked parent directory", async () => {
    const root = await layout()
    const workspace = path.join(root, "workspace")
    await symlink(path.join(root, "outside"), path.join(workspace, "link"), "junction")
    expect(await withinWorkspace(workspace, path.join(workspace, "link", "secret.ts"))).toBe(false)
  })

  test("rejects an absolute symlink and a missing file", async () => {
    const root = await layout()
    const workspace = path.join(root, "workspace")
    await symlink(path.join(root, "outside", "secret.ts"), path.join(workspace, "absolute.ts"))
    expect(await withinWorkspace(workspace, path.join(workspace, "absolute.ts"))).toBe(false)
    expect(await withinWorkspace(workspace, path.join(workspace, "missing.ts"))).toBe(false)
  })
})
