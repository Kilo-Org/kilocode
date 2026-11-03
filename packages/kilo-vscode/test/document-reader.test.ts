import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { isInsideWorktree, plansDir, readDocument, resolveDocumentPath } from "../src/documents/document-reader"

function workspace() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kilo-document-")))
}

function withHome<T>(run: () => T): T {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kilo-home-")))
  const previous = process.env.OPENCODE_TEST_HOME
  process.env.OPENCODE_TEST_HOME = home
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_TEST_HOME
    else process.env.OPENCODE_TEST_HOME = previous
  }
}

const symlinks = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-symlink-"))
  try {
    const target = path.join(dir, "target.md")
    fs.writeFileSync(target, "target")
    fs.symlinkSync(target, path.join(dir, "link.md"))
    return true
  } catch {
    return false
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})()

describe("readDocument", () => {
  it("reads text files inside the worktree", () => {
    const root = workspace()
    fs.writeFileSync(path.join(root, "plan.md"), "# Plan\n")

    expect(readDocument(root, "plan.md")).toEqual({ file: "plan.md", kind: "text", content: "# Plan\n" })
  })

  it("rejects paths outside the worktree", () => {
    const root = workspace()
    const outside = path.join(root, "..", "outside.md")
    fs.writeFileSync(outside, "secret")

    expect(readDocument(root, "../outside.md")).toEqual({ error: "Document is outside the worktree." })
  })

  it.skipIf(!symlinks)("rejects a symlink inside the worktree that points outside", () => {
    const root = workspace()
    const outside = path.join(root, "..", "outside.md")
    fs.writeFileSync(outside, "secret")
    fs.symlinkSync(outside, path.join(root, "link.md"))

    expect(readDocument(root, "link.md")).toEqual({ error: "Document is outside the worktree." })
  })

  it.skipIf(!symlinks)("previews a plan file through a symlink inside the worktree", () => {
    withHome(() => {
      const root = workspace()
      const dir = plansDir()
      fs.mkdirSync(dir, { recursive: true })
      const plan = path.join(dir, "42-linked.md")
      fs.writeFileSync(plan, "# Linked plan\n")
      fs.symlinkSync(plan, path.join(root, "plan.md"))

      expect(readDocument(root, "plan.md")).toEqual({
        file: fs.realpathSync(plan),
        kind: "text",
        content: "# Linked plan\n",
      })
    })
  })

  it("rejects binary files", () => {
    const root = workspace()
    fs.writeFileSync(path.join(root, "data.bin"), Buffer.from([1, 0, 2]))

    expect(readDocument(root, "data.bin")).toEqual({ error: "Binary files cannot be previewed." })
  })

  it("reads plan files from the plan directory outside the worktree", () => {
    withHome(() => {
      const root = workspace()
      const dir = plansDir()
      fs.mkdirSync(dir, { recursive: true })
      const plan = path.join(dir, "42-non-git.md")
      fs.writeFileSync(plan, "# Global plan\n")

      expect(readDocument(root, plan)).toEqual({
        file: fs.realpathSync(plan),
        kind: "text",
        content: "# Global plan\n",
      })
    })
  })

  it("keeps rejecting files outside both the worktree and the plan directory", () => {
    withHome(() => {
      const root = workspace()
      const outside = path.join(root, "..", "outside.md")
      fs.writeFileSync(outside, "secret")

      expect(readDocument(root, outside)).toEqual({ error: "Document is outside the worktree." })
    })
  })
})

describe("resolveDocumentPath", () => {
  it("resolves an absolute file inside the worktree without reading its contents", () => {
    const root = workspace()
    const file = path.join(root, "plan.md")
    fs.writeFileSync(file, "# Plan\n")

    expect(resolveDocumentPath(root, file)).toEqual({ file: "plan.md", resolved: fs.realpathSync(file), size: 7 })
  })

  it("resolves a binary file that the preview refuses", () => {
    const root = workspace()
    const file = path.join(root, "data.bin")
    fs.writeFileSync(file, Buffer.from([1, 0, 2]))

    expect(resolveDocumentPath(root, file)).toEqual({ file: "data.bin", resolved: fs.realpathSync(file), size: 3 })
  })

  it("rejects an absolute file outside the worktree", () => {
    const root = workspace()
    const outside = path.join(root, "..", "outside.md")
    fs.writeFileSync(outside, "secret")

    expect(resolveDocumentPath(root, outside)).toEqual({ error: "Document is outside the worktree." })
  })
})

describe("plansDir", () => {
  it("uses the server's plan directory in the home", () => {
    expect(plansDir("/tmp/home")).toEqual(path.join("/tmp/home", ".opencode", "plan"))
  })
})

describe("isInsideWorktree", () => {
  it("accepts Windows drive-letter case differences", () => {
    expect(isInsideWorktree("D:\\demo-project", "d:\\demo-project\\README.md", "win32")).toBe(true)
    expect(isInsideWorktree("d:\\demo-project", "D:\\demo-project\\README.md", "win32")).toBe(true)
  })

  it("accepts Windows path case differences", () => {
    expect(isInsideWorktree("C:\\Repo\\Work", "c:\\repo\\work\\src\\file.ts", "win32")).toBe(true)
  })

  it("accepts the worktree root itself on Windows", () => {
    expect(isInsideWorktree("D:\\demo-project", "d:\\demo-project", "win32")).toBe(true)
  })

  it("rejects Windows siblings that only share a name prefix", () => {
    expect(isInsideWorktree("D:\\demo-project", "d:\\demo-project-other\\README.md", "win32")).toBe(false)
  })

  it("rejects Windows paths outside the worktree", () => {
    expect(isInsideWorktree("D:\\demo-project", "D:\\other\\README.md", "win32")).toBe(false)
  })

  it("accepts macOS path case differences", () => {
    expect(isInsideWorktree("/Users/dev/Repo", "/users/dev/repo/src/file.ts", "darwin")).toBe(true)
  })

  it("keeps the exact comparison on Linux", () => {
    expect(isInsideWorktree("/work", "/work/file.md", "linux")).toBe(true)
    expect(isInsideWorktree("/work", "/Work/file.md", "linux")).toBe(false)
  })
})
