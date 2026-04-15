import { test, expect, describe } from "bun:test"
import { $ } from "bun"
import { tmpdir } from "../fixture/fixture"
import path from "path"

/**
 * Tests for the worktree diff logic used by GET /experimental/worktree/diff.
 * Reproduces the exact git commands from the endpoint to verify they work
 * for tracked, staged, and untracked files.
 */
describe("worktree diff git commands", () => {
  async function setupRepo() {
    const tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create an initial file and commit it so we have a base
        await Bun.write(path.join(dir, "existing.txt"), "hello\n")
        await $`git add .`.cwd(dir).quiet()
        await $`git commit -m "add existing.txt"`.cwd(dir).quiet()
      },
    })
    return tmp
  }

  test("git diff sees committed changes but NOT untracked files", async () => {
    await using tmp = await setupRepo()
    const dir = tmp.path

    // Get the current HEAD as our "ancestor" (simulating merge-base)
    const headResult = await $`git rev-parse HEAD`.cwd(dir).quiet()
    const ancestor = headResult.stdout.toString().trim()

    // Create an untracked file (agent writes a file but doesn't stage it)
    await Bun.write(path.join(dir, "life.py"), 'print("hello world")\n')

    // Verify the file exists
    const exists = await Bun.file(path.join(dir, "life.py")).exists()
    expect(exists).toBe(true)

    // git diff --name-status does NOT see untracked files
    const nameStatus = await $`git -c core.quotepath=false diff --name-status --no-renames ${ancestor}`
      .cwd(dir)
      .quiet()
      .nothrow()
    const nameStatusOutput = nameStatus.stdout.toString().trim()
    console.log("git diff --name-status output:", JSON.stringify(nameStatusOutput))
    expect(nameStatusOutput).toBe("") // empty — life.py is untracked

    // git ls-files --others DOES see untracked files
    const untracked = await $`git ls-files --others --exclude-standard`.cwd(dir).quiet().nothrow()
    const untrackedOutput = untracked.stdout.toString().trim()
    console.log("git ls-files --others output:", JSON.stringify(untrackedOutput))
    expect(untrackedOutput).toContain("life.py")
  })

  test("git diff sees staged (added) files", async () => {
    await using tmp = await setupRepo()
    const dir = tmp.path

    const headResult = await $`git rev-parse HEAD`.cwd(dir).quiet()
    const ancestor = headResult.stdout.toString().trim()

    // Create and stage a new file
    await Bun.write(path.join(dir, "staged.py"), 'print("staged")\n')
    await $`git add staged.py`.cwd(dir).quiet()

    const nameStatus = await $`git -c core.quotepath=false diff --name-status --no-renames ${ancestor}`
      .cwd(dir)
      .quiet()
      .nothrow()
    const nameStatusOutput = nameStatus.stdout.toString().trim()
    console.log("git diff --name-status (staged):", JSON.stringify(nameStatusOutput))
    // git diff <ancestor> (no --cached) compares ancestor to working tree,
    // which includes staged changes
    expect(nameStatusOutput).toContain("staged.py")
  })

  test("git diff sees modifications to tracked files", async () => {
    await using tmp = await setupRepo()
    const dir = tmp.path

    const headResult = await $`git rev-parse HEAD`.cwd(dir).quiet()
    const ancestor = headResult.stdout.toString().trim()

    // Modify existing tracked file without staging
    await Bun.write(path.join(dir, "existing.txt"), "hello\nmodified\n")

    const nameStatus = await $`git -c core.quotepath=false diff --name-status --no-renames ${ancestor}`
      .cwd(dir)
      .quiet()
      .nothrow()
    const nameStatusOutput = nameStatus.stdout.toString().trim()
    console.log("git diff --name-status (modified):", JSON.stringify(nameStatusOutput))
    expect(nameStatusOutput).toContain("existing.txt")
  })

  test("full diff pipeline: tracked + untracked combined", async () => {
    await using tmp = await setupRepo()
    const dir = tmp.path

    const headResult = await $`git rev-parse HEAD`.cwd(dir).quiet()
    const ancestor = headResult.stdout.toString().trim()

    // Modify existing file (tracked change)
    await Bun.write(path.join(dir, "existing.txt"), "hello\nmodified\n")
    // Create untracked file
    await Bun.write(path.join(dir, "new-file.py"), 'print("new")\n')

    // Step 1: git diff for tracked changes
    const nameStatus = await $`git -c core.quotepath=false diff --name-status --no-renames ${ancestor}`
      .cwd(dir)
      .quiet()
      .nothrow()
    const tracked = new Set<string>()
    const trackedFiles: string[] = []
    for (const line of nameStatus.stdout.toString().trim().split("\n")) {
      if (!line) continue
      const parts = line.split("\t")
      const file = parts.slice(1).join("\t")
      if (file) {
        tracked.add(file)
        trackedFiles.push(file)
      }
    }

    // Step 2: git ls-files for untracked
    const untrackedResult = await $`git ls-files --others --exclude-standard`.cwd(dir).quiet().nothrow()
    const untrackedFiles: string[] = []
    for (const file of untrackedResult.stdout.toString().trim().split("\n")) {
      if (!file || tracked.has(file)) continue
      untrackedFiles.push(file)
    }

    console.log("tracked files:", trackedFiles)
    console.log("untracked files:", untrackedFiles)

    expect(trackedFiles).toContain("existing.txt")
    expect(trackedFiles).not.toContain("new-file.py")
    expect(untrackedFiles).toContain("new-file.py")
    expect(untrackedFiles).not.toContain("existing.txt")

    // Combined = both
    const allFiles = [...trackedFiles, ...untrackedFiles]
    expect(allFiles).toContain("existing.txt")
    expect(allFiles).toContain("new-file.py")
  })

  test("worktree scenario: branch with no new commits, only untracked files", async () => {
    // This is the exact scenario from the screenshot:
    // - Worktree created from main
    // - Agent writes life.py (never committed/staged)
    // - merge-base HEAD main = HEAD (no divergence)
    // - git diff shows nothing, git ls-files --others shows life.py
    await using tmp = await setupRepo()
    const dir = tmp.path

    // Simulate: worktree is on same commit as base (no new commits)
    // merge-base HEAD HEAD = HEAD
    const mergeBase = await $`git merge-base HEAD HEAD`.cwd(dir).quiet()
    const ancestor = mergeBase.stdout.toString().trim()
    console.log("ancestor (same as HEAD):", ancestor)

    // Agent writes a file
    await Bun.write(
      path.join(dir, "life.py"),
      `
import random
import time
import os

def create_board(rows, cols):
    return [[random.choice([0, 1]) for _ in range(cols)] for _ in range(rows)]

print("Game of Life")
`,
    )

    // git diff: nothing (HEAD == ancestor, no tracked changes)
    const nameStatus = await $`git -c core.quotepath=false diff --name-status --no-renames ${ancestor}`
      .cwd(dir)
      .quiet()
      .nothrow()
    const nameStatusRaw = nameStatus.stdout.toString().trim()
    console.log("nameStatus raw:", JSON.stringify(nameStatusRaw))

    // git ls-files --others: should find life.py
    const untrackedResult = await $`git ls-files --others --exclude-standard`.cwd(dir).quiet().nothrow()
    const untrackedRaw = untrackedResult.stdout.toString().trim()
    console.log("untracked raw:", JSON.stringify(untrackedRaw))

    expect(untrackedRaw).toContain("life.py")

    // Now simulate the full endpoint logic
    const seen = new Set<string>()
    const diffs: { file: string; status: string }[] = []

    // Process tracked changes
    for (const line of nameStatusRaw.split("\n")) {
      if (!line) continue
      const parts = line.split("\t")
      const file = parts.slice(1).join("\t")
      if (file) {
        seen.add(file)
        diffs.push({ file, status: "modified" })
      }
    }

    // Process untracked files
    if (untrackedResult.exitCode === 0) {
      for (const file of untrackedRaw.split("\n")) {
        if (!file || seen.has(file)) continue
        const f = Bun.file(path.join(dir, file))
        if (!(await f.exists())) continue
        diffs.push({ file, status: "added" })
      }
    }

    console.log("final diffs:", diffs)
    expect(diffs.length).toBe(1)
    expect(diffs[0]!.file).toBe("life.py")
    expect(diffs[0]!.status).toBe("added")
  })
})
