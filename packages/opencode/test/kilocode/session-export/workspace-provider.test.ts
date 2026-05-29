import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir as osTmpdir } from "node:os"
import { join } from "node:path"
import { tmpdir } from "../../fixture/fixture"
import { createWorkspaceProvider } from "@/kilocode/session-export/workspace-provider"

describe("workspace provider", () => {
  test("captures the repository root when started from a nested git directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await mkdir(join(tmp.path, "src", "nested"), { recursive: true })
    await writeFile(join(tmp.path, "package.json"), '{"name":"repo"}\n')
    await writeFile(join(tmp.path, "src", "nested", "index.ts"), "export const nested = true\n")
    await $`git add package.json src/nested/index.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: join(tmp.path, "src", "nested") })
    const baseline = await provider.baseline()

    expect(baseline.capture.mode).toBe("git-tracked-and-untracked")
    expect(baseline.files.map((file) => file.path)).toEqual(["package.json", "src/nested/index.ts"])
    expect(baseline.files.find((file) => file.path === "package.json")?.content).toBe('{"name":"repo"}\n')
  })

  test("does not capture filesystem files outside a git repository", async () => {
    await using tmp = await tmpdir()
    await writeFile(join(tmp.path, "loose.txt"), "do not sync me\n")

    const provider = createWorkspaceProvider({ root: tmp.path })
    const baseline = await provider.baseline()

    expect(baseline.capture).toEqual({
      mode: "none",
      fileCount: 0,
      totalBytes: 0,
      omittedCountsByReason: {},
      truncated: false,
    })
    expect(baseline.files).toEqual([])
  })

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

  test("baseline includes capture completeness metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(join(tmp.path, "src.ts"), "export const value = 1\n")
    await writeFile(join(tmp.path, ".env"), "SECRET=1\n")
    await $`git add src.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: tmp.path })
    const baseline = await provider.baseline()

    expect(baseline.capture).toEqual({
      mode: "git-tracked-and-untracked",
      fileCount: 2,
      totalBytes: 32,
      omittedCountsByReason: { high_risk_path: 1 },
      truncated: false,
    })
  })

  test("truncates workspace content past aggregate snapshot budget", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(join(tmp.path, "a.ts"), "aaaa\n")
    await writeFile(join(tmp.path, "b.ts"), "bbbb\n")
    await $`git add a.ts b.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: tmp.path, maxSnapshotBytes: 5 })
    const baseline = await provider.baseline()

    expect(baseline.capture.truncated).toBe(true)
    expect(baseline.capture.omittedCountsByReason.large).toBe(1)
    expect(baseline.files.map((file) => [file.path, file.content, file.omitted?.reason])).toEqual([
      ["a.ts", "aaaa\n", undefined],
      ["b.ts", undefined, "large"],
    ])
  })

  test("baseline capture metadata never embeds the absolute workspace root", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(join(tmp.path, "src.ts"), "export const value = 1\n")
    await $`git add src.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: tmp.path })
    const baseline = await provider.baseline()

    expect(JSON.stringify(baseline.capture)).not.toContain(tmp.path)
    expect(JSON.stringify(baseline.files)).not.toContain(tmp.path)
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

  test("does not persist ordinary source contents in snapshot state", async () => {
    await using tmp = await tmpdir({ git: true })
    const state = join(await mkdtemp(join(osTmpdir(), "session-export-provider-")), "state.json")
    await writeFile(join(tmp.path, "src.ts"), "export const secret = 'local-only'\n")
    await $`git add src.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: tmp.path, statePath: state })
    const baseline = await provider.baseline()

    expect(baseline.files[0].content).toContain("local-only")
    await expect(Bun.file(state).text()).resolves.not.toContain("local-only")
  })

  test("does not follow symlink contents outside the repository", async () => {
    await using tmp = await tmpdir({ git: true })
    const dir = await mkdtemp(join(osTmpdir(), "session-export-provider-"))
    const secret = join(dir, "secret.txt")
    await writeFile(secret, "outside-secret\n")
    await symlink(secret, join(tmp.path, "link.txt"))
    await $`git add link.txt`.cwd(tmp.path).quiet()
    await $`git commit -m link`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: tmp.path })
    const baseline = await provider.baseline()
    const link = baseline.files.find((file) => file.path === "link.txt")

    expect(link?.kind).toBe("symlink")
    expect(link?.content).toBeUndefined()
    expect(JSON.stringify(baseline)).not.toContain("outside-secret")
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

  test("evicts a session's previous snapshot when a new one is remembered", async () => {
    await using tmp = await tmpdir({ git: true })
    const state = join(await mkdtemp(join(osTmpdir(), "session-export-provider-")), "state.json")
    await writeFile(join(tmp.path, "src.ts"), "export const value = 1\n")
    await $`git add src.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: tmp.path, statePath: state })
    const first = await provider.baseline()
    provider.remember("s1", first.snapshotId)

    await writeFile(join(tmp.path, "src.ts"), "export const value = 2\n")
    const delta = await provider.diff(first.snapshotId)
    provider.remember("s1", delta.snapshotHash)

    const persisted = JSON.parse(await Bun.file(state).text()) as { snapshots: Record<string, unknown> }
    expect(Object.keys(persisted.snapshots)).toEqual([delta.snapshotHash])
  })

  test("prunes unreferenced snapshots when a session snapshot is remembered", async () => {
    await using tmp = await tmpdir({ git: true })
    const state = join(await mkdtemp(join(osTmpdir(), "session-export-provider-")), "state.json")
    await writeFile(join(tmp.path, "src.ts"), "export const value = 1\n")
    await $`git add src.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: tmp.path, statePath: state })
    const stale = await provider.baseline()

    await writeFile(join(tmp.path, "src.ts"), "export const value = 2\n")
    const current = await provider.baseline()
    provider.remember("s1", current.snapshotId)

    const persisted = JSON.parse(await Bun.file(state).text()) as { snapshots: Record<string, unknown> }
    expect(persisted.snapshots[stale.snapshotId]).toBeUndefined()
    expect(Object.keys(persisted.snapshots)).toEqual([current.snapshotId])
  })

  test("preserves captured snapshots until they are remembered", async () => {
    await using tmp = await tmpdir({ git: true })
    const state = join(await mkdtemp(join(osTmpdir(), "session-export-provider-")), "state.json")
    await writeFile(join(tmp.path, "src.ts"), "export const value = 1\n")
    await $`git add src.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: tmp.path, statePath: state })
    const first = await provider.baseline()
    provider.remember("s1", first.snapshotId)

    await writeFile(join(tmp.path, "src.ts"), "export const value = 2\n")
    const pending = await provider.baseline()
    provider.remember("s2", first.snapshotId)

    const persisted = JSON.parse(await Bun.file(state).text()) as { snapshots: Record<string, unknown> }
    expect(Object.keys(persisted.snapshots).sort()).toEqual([first.snapshotId, pending.snapshotId].sort())
  })

  test("preserves a snapshot still referenced by another session", async () => {
    await using tmp = await tmpdir({ git: true })
    const state = join(await mkdtemp(join(osTmpdir(), "session-export-provider-")), "state.json")
    await writeFile(join(tmp.path, "src.ts"), "export const value = 1\n")
    await $`git add src.ts`.cwd(tmp.path).quiet()
    await $`git commit -m files`.cwd(tmp.path).quiet()

    const provider = createWorkspaceProvider({ root: tmp.path, statePath: state })
    const shared = await provider.baseline()
    provider.remember("s1", shared.snapshotId)
    provider.remember("s2", shared.snapshotId)

    await writeFile(join(tmp.path, "src.ts"), "export const value = 2\n")
    const delta = await provider.diff(shared.snapshotId)
    provider.remember("s1", delta.snapshotHash)

    const persisted = JSON.parse(await Bun.file(state).text()) as { snapshots: Record<string, unknown> }
    expect(Object.keys(persisted.snapshots).sort()).toEqual([shared.snapshotId, delta.snapshotHash].sort())
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

  test("ignores corrupt persisted snapshot state", async () => {
    await using tmp = await tmpdir({ git: true })
    const state = join(await mkdtemp(join(osTmpdir(), "session-export-provider-")), "state.json")
    await writeFile(state, JSON.stringify({ sessions: { s1: "bad" }, snapshots: { bad: { path: "src.ts" } } }))

    const provider = createWorkspaceProvider({ root: tmp.path, statePath: state })

    expect(provider.current("s1")).toBeUndefined()
  })
})
