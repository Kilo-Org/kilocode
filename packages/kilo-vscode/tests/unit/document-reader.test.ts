import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { isInsideWorktree, plansDir, readDocument } from "../../src/documents/document-reader"

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kilo-document-"))
}

function withDataHome<T>(run: () => T): T {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-data-"))
  const previous = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = home
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previous
  }
}

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

  it("rejects binary files", () => {
    const root = workspace()
    fs.writeFileSync(path.join(root, "data.bin"), Buffer.from([1, 0, 2]))

    expect(readDocument(root, "data.bin")).toEqual({ error: "Binary files cannot be previewed." })
  })

  // Non-git projects store plans in the canonical plans dir, outside the
  // worktree. The preview must still work there — see #14588.
  it("reads plan files from the canonical plans dir outside the worktree", () => {
    withDataHome(() => {
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

  it("keeps rejecting files outside both the worktree and the plans dir", () => {
    withDataHome(() => {
      const root = workspace()
      const outside = path.join(root, "..", "outside.md")
      fs.writeFileSync(outside, "secret")

      expect(readDocument(root, outside)).toEqual({ error: "Document is outside the worktree." })
    })
  })
})

describe("plansDir", () => {
  it("honors XDG_DATA_HOME", () => {
    withDataHome(() => {
      expect(plansDir()).toEqual(path.join(process.env.XDG_DATA_HOME!, "kilo", "plans"))
    })
  })

  it("falls back to ~/.local/share", () => {
    const previous = process.env.XDG_DATA_HOME
    delete process.env.XDG_DATA_HOME
    try {
      expect(plansDir()).toEqual(path.join(os.homedir(), ".local", "share", "kilo", "plans"))
    } finally {
      if (previous !== undefined) process.env.XDG_DATA_HOME = previous
    }
  })
})

describe("isInsideWorktree", () => {
  // Windows and default macOS filesystems are case-insensitive, and
  // fs.realpathSync preserves the case of its input, so a file link read from a
  // webview can differ in case from the session directory. See #14182.
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
