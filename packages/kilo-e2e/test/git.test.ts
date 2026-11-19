import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { createProject } from "../src/git"
import { sandbox } from "./helpers"

describe("deterministic git fixture", () => {
  test("produces the same commit and content across runs", async () => {
    const commits = await sandbox(async (one) =>
      sandbox(async (two) => {
        const first = await createProject(join(one, "project"))
        const again = await createProject(join(one, "again"))
        const second = await createProject(join(two, "project"))
        expect(first.commit).toMatch(/^[0-9a-f]{40}$/)
        expect(first.branch).toBe("main")
        expect(again.commit).toBe(first.commit)
        expect(second.commit).toBe(first.commit)
        expect(await readFile(join(first.path, "README.md"), "utf8")).toBe(
          await readFile(join(second.path, "README.md"), "utf8"),
        )
        return [first.commit, second.commit]
      }),
    )
    expect(commits[0]).toBe(commits[1])
  })
})
