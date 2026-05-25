import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir as osTmpdir } from "node:os"
import { join } from "node:path"
import { tmpdir } from "../../fixture/fixture"
import { createWorkspaceProvider } from "@/kilocode/session-export/workspace-provider"

describe("workspace provider", () => {
  test("captures initial filesystem state and ignores gitignored files", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(join(tmp.path, ".gitignore"), "ignored.txt\n")
    await writeFile(join(tmp.path, "src.ts"), "export const value = 1\n")
    await writeFile(join(tmp.path, "ignored.txt"), "nope\n")
    await $`git add .gitignore src.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: tmp.path })
    const baseline = await provider.baseline()

    expect(baseline.snapshotId).toBeTruthy()
    expect(baseline.files.map((file) => file.path)).toEqual([".gitignore", "src.ts"])
    expect(baseline.files.find((file) => file.path === "src.ts")?.content).toBe("export const value = 1\n")
  })

  test("omits high-risk file contents before persistence", async () => {
    await using tmp = await tmpdir({ git: true })
    const state = join(await mkdtemp(join(osTmpdir(), "session-export-provider-")), "state.json")
    await writeFile(join(tmp.path, ".env"), "SECRET=AKIAIOSFODNN7EXAMPLE\n")

    const provider = createWorkspaceProvider({ root: tmp.path, statePath: state })
    const baseline = await provider.baseline()

    expect(baseline.files[0]).toEqual({
      path: ".env",
      kind: "file",
      size: 28,
      omitted: { reason: "high_risk_path" },
    })
    await expect(Bun.file(state).text()).resolves.not.toContain("AKIAIOSFODNN7EXAMPLE")
  })

  test("captures diffs from the previous snapshot", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(join(tmp.path, "src.ts"), "export const value = 1\n")
    await $`git add src.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: tmp.path })
    const baseline = await provider.baseline()

    await writeFile(join(tmp.path, "src.ts"), "export const value = 2\n")
    await writeFile(join(tmp.path, "new.ts"), "export const next = true\n")

    const delta = await provider.diff(baseline.snapshotId)

    expect(delta.snapshotHash).not.toBe(baseline.snapshotId)
    expect(delta.diff.map((item) => [item.path, item.status])).toEqual([
      ["new.ts", "added"],
      ["src.ts", "modified"],
    ])
    expect(delta.diff.every((item) => item.patch?.includes("export const"))).toBe(true)
  })

  test("persists session snapshot state across provider instances", async () => {
    await using tmp = await tmpdir({ git: true })
    const state = join(await mkdtemp(join(osTmpdir(), "session-export-provider-")), "state.json")
    await writeFile(join(tmp.path, "src.ts"), "export const value = 1\n")
    await $`git add src.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const first = createWorkspaceProvider({ root: tmp.path, statePath: state })
    const baseline = await first.baseline()
    first.remember("s1", baseline.snapshotId)

    await writeFile(join(tmp.path, "src.ts"), "export const value = 2\n")

    const second = createWorkspaceProvider({ root: tmp.path, statePath: state })
    expect(second.current("s1")).toBe(baseline.snapshotId)
    const delta = await second.diff(second.current("s1")!)
    expect(delta.diff[0].path).toBe("src.ts")
    expect(delta.diff[0].patch).toContain("value = 2")
  })
})
