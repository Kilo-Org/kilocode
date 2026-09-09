import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as fs from "node:fs/promises"
import * as disk from "node:fs"
import * as path from "node:path"
import { tmpdir } from "node:os"
import * as gh from "../../src/agent-manager/gh"
import { exec } from "../../src/util/process"
import { PRSuggestionActions } from "../../src/agent-manager/pr/suggestion-actions"
import type { PRReviewContext } from "../../src/agent-manager/pr/review-context"
import type { PRReviewResult } from "../../src/shared/pr-comment-actions"

const execute = spyOn(gh, "execGhRead")
afterAll(() => execute.mockRestore())

describe("working-tree PR suggestions", () => {
  let directory: string
  let context: PRReviewContext
  let actions: PRSuggestionActions
  let dirty: string[]
  let source: {
    id: string
    path: string
    diffSide: string
    startDiffSide: string | null
    startLine: number | null
    line: number | null
    isOutdated: boolean
    pullRequest: { number: number; url: string; headRefOid: string }
    comments: { nodes: { id: string; body: string }[] }
  }
  const pending = new Map<string, ReturnType<typeof Promise.withResolvers<PRReviewResult>>>()
  const route = {
    projectId: "project",
    worktreeId: "tree",
    prNumber: 1,
    prUrl: "https://github.com/example/test/pull/1",
  }

  async function git(...args: string[]) {
    return (await exec("git", args, { cwd: directory })).stdout.trim()
  }

  async function send(fields: Record<string, unknown>) {
    const request = typeof fields.requestId === "string" ? fields.requestId : "request"
    const result = Promise.withResolvers<PRReviewResult>()
    pending.set(request, result)
    expect(actions.handle({ ...route, requestId: request, ...fields })).toBe(true)
    return result.promise
  }

  async function preview(fields: Record<string, unknown> = {}) {
    const result = await send({
      type: "agentManager.previewPRSuggestion",
      commentId: "reply",
      suggestion: 0,
      ...fields,
    })
    expect(result.type).toBe("agentManager.previewPRSuggestionResult")
    return result
  }

  async function token() {
    const result = await preview()
    expect(result.success).toBe(true)
    if (result.type !== "agentManager.previewPRSuggestionResult" || !result.preview) throw new Error(result.error)
    return result.preview.token
  }

  async function apply(value: string, fields: Record<string, unknown> = {}) {
    return send({ type: "agentManager.applyPRSuggestion", token: value, ...fields })
  }

  beforeEach(async () => {
    pending.clear()
    directory = await fs.mkdtemp(path.join(tmpdir(), "kilo-suggestion-"))
    await git("init", "-b", "feature")
    await fs.writeFile(path.join(directory, "file.txt"), "first\nold\nthird\nfourth\nfifth\nlast\n")
    await fs.writeFile(path.join(directory, "other.txt"), "unrelated\n")
    await git("add", ".")
    await git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture")
    context = {
      directory,
      branch: "feature",
      projectId: "project",
      worktreeId: "tree",
      pr: {
        number: 1,
        title: "Fixture",
        url: route.prUrl,
        state: "open",
        review: null,
        checks: { status: "none", total: 0, passed: 0, failed: 0, pending: 0, checks: [] },
        reviewers: [],
        additions: 0,
        deletions: 0,
        files: 0,
        comments: {
          total: 1,
          unresolved: 1,
          comments: [
            {
              id: "root",
              threadId: "thread",
              author: "reviewer",
              body: "cached stale text",
              file: "untrusted.txt",
              line: 900,
              resolved: false,
              outdated: false,
              replies: [{ id: "reply", author: "reviewer", body: "also stale" }],
            },
          ],
        },
      },
    }
    source = {
      id: "thread",
      path: "file.txt",
      diffSide: "RIGHT",
      startDiffSide: null,
      startLine: null,
      line: 2,
      isOutdated: false,
      pullRequest: { number: 1, url: route.prUrl, headRefOid: await git("rev-parse", "HEAD") },
      comments: {
        nodes: [
          { id: "root", body: "root" },
          { id: "reply", body: "```suggestion\nnew\n```" },
        ],
      },
    }
    execute.mockReset()
    execute.mockImplementation(async (args) => {
      expect(args).toContain("thread=thread")
      expect(args[0]).toBe("api")
      expect(args[1]).toBe("graphql")
      expect(args.join(" ")).not.toContain("mutation")
      return { stdout: JSON.stringify({ data: { node: source } }), stderr: "" }
    })
    dirty = []
    actions = new PRSuggestionActions({
      context(message) {
        for (const [key, value] of Object.entries(route)) if (message[key] !== value) throw new Error("Wrong route")
        return context
      },
      dirtyFiles: () => dirty,
      post: (message) => pending.get(message.requestId)?.resolve(message),
      refresh: () => {
        throw new Error("Suggestions must not mutate remote state")
      },
    })
  })

  afterEach(async () => {
    actions.dispose()
    await fs.rm(directory, { recursive: true, force: true })
  })

  it("previews actual local edits, then changes only the worktree and consumes the token", async () => {
    await fs.writeFile(path.join(directory, "file.txt"), "first\nold\nthird\nfourth\nfifth\nlocal last\n")
    await fs.writeFile(path.join(directory, "other.txt"), "staged unrelated\n")
    await git("add", "other.txt")
    const index = await fs.readFile(path.join(directory, ".git", "index"))
    const head = await git("rev-parse", "HEAD")
    const before = await fs.readFile(path.join(directory, "file.txt"), "utf8")
    const result = await preview({ path: "other.txt", code: "evil" })
    if (result.type !== "agentManager.previewPRSuggestionResult" || !result.preview) throw new Error(result.error)
    expect(result.preview.path).toBe("file.txt")
    expect(result.preview.patch).toContain("-old\n+new")
    expect(await fs.readFile(path.join(directory, "file.txt"), "utf8")).toBe(before)
    expect((await apply(result.preview.token)).success).toBe(true)
    expect(await fs.readFile(path.join(directory, "file.txt"), "utf8")).toBe(before.replace("old", "new"))
    expect(await fs.readFile(path.join(directory, ".git", "index"))).toEqual(index)
    expect(await git("rev-parse", "HEAD")).toBe(head)
    expect(await fs.readFile(path.join(directory, "other.txt"), "utf8")).toBe("staged unrelated\n")
    expect((await apply(result.preview.token)).success).toBe(false)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it.each(["write", "zero", "flush", "rename"])(
    "keeps the complete original and removes temporary files on %s failure",
    async (failure) => {
      const file = path.join(directory, "file.txt")
      await fs.appendFile(file, "unrelated local edit\n")
      await fs.writeFile(path.join(directory, "other.txt"), "staged unrelated\n")
      await git("add", "other.txt")
      const value = await token()
      const before = await fs.readFile(file)
      const stat = await fs.stat(file)
      const index = await fs.readFile(path.join(directory, ".git", "index"))
      const head = await git("rev-parse", "HEAD")
      const entries = await fs.readdir(directory)
      const write = disk.writeSync
      const calls = { writes: 0 }
      const writing = spyOn(disk, "writeSync")
      if (failure === "write" || failure === "zero")
        writing.mockImplementation((fd, buffer, offset, length, position) => {
          if (failure === "zero") return 0
          if (calls.writes++ === 0) return write(fd, buffer as Buffer, offset as number, 1, position as number)
          throw Object.assign(new Error("No space left"), { code: "ENOSPC" })
        })
      const flushing = spyOn(disk, "fsyncSync")
      if (failure === "flush")
        flushing.mockImplementation(() => {
          throw new Error("Flush failed")
        })
      const renaming = spyOn(disk, "renameSync")
      if (failure === "rename")
        renaming.mockImplementation(() => {
          throw new Error("Rename failed")
        })
      try {
        expect((await apply(value)).success).toBe(false)
        expect(await fs.readFile(file)).toEqual(before)
        expect((await fs.stat(file)).ino).toBe(stat.ino)
        expect((await fs.stat(file)).mode).toBe(stat.mode)
        expect(await fs.readFile(path.join(directory, ".git", "index"))).toEqual(index)
        expect(await git("rev-parse", "HEAD")).toBe(head)
        expect(await fs.readFile(path.join(directory, "other.txt"), "utf8")).toBe("staged unrelated\n")
        expect(await fs.readdir(directory)).toEqual(entries)
      } finally {
        writing.mockRestore()
        flushing.mockRestore()
        renaming.mockRestore()
      }
    },
  )

  it("completes short writes before atomically replacing the original inode", async () => {
    const file = path.join(directory, "file.txt")
    const value = await token()
    const before = await fs.readFile(file, "utf8")
    const stat = await fs.stat(file)
    const entries = await fs.readdir(directory)
    const write = disk.writeSync
    const writing = spyOn(disk, "writeSync").mockImplementation((fd, buffer, offset, length, position) => {
      expect(disk.readFileSync(file, "utf8")).toBe(before)
      return write(fd, buffer as Buffer, offset as number, Math.min(length as number, 3), position as number)
    })
    try {
      expect((await apply(value)).success).toBe(true)
      expect(writing.mock.calls.length).toBeGreaterThan(1)
      expect(await fs.readFile(file, "utf8")).toBe(before.replace("old", "new"))
      expect((await fs.stat(file)).ino).not.toBe(stat.ino)
      expect((await fs.stat(file)).mode).toBe(stat.mode)
      expect(await fs.readdir(directory)).toEqual(entries)
    } finally {
      writing.mockRestore()
    }
  })

  it("replaces the target atomically while old readers retain the original", async () => {
    const file = path.join(directory, "file.txt")
    const value = await token()
    const before = await fs.readFile(file, "utf8")
    const reader = await fs.open(file, "r")
    try {
      expect((await apply(value)).success).toBe(true)
      expect(await fs.readFile(file, "utf8")).toBe(before.replace("old", "new"))
      expect(await reader.readFile("utf8")).toBe(before)
    } finally {
      await reader.close()
    }
  })

  it.each(["source", "content", "unsaved"])("revalidates %s after preparing the replacement", async (change) => {
    const file = path.join(directory, "file.txt")
    const value = await token()
    const entries = await fs.readdir(directory)
    const flush = disk.fsyncSync
    const flushing = spyOn(disk, "fsyncSync").mockImplementation((fd) => {
      flush(fd)
      if (change === "source") source.comments.nodes[1]!.body = "```suggestion\nchanged remotely\n```"
      if (change === "content") disk.appendFileSync(file, "concurrent local edit\n")
      if (change === "unsaved") dirty = [file]
    })
    try {
      expect((await apply(value)).success).toBe(false)
      expect(await fs.readFile(file, "utf8")).toBe(
        "first\nold\nthird\nfourth\nfifth\nlast\n" + (change === "content" ? "concurrent local edit\n" : ""),
      )
      expect(await fs.readdir(directory)).toEqual(entries)
    } finally {
      flushing.mockRestore()
    }
  })

  it.each(["content", "HEAD", "source", "anchor", "branch", "route", "unsaved", "symlink", "replacement", "mode"])(
    "rejects stale %s at apply without writing",
    async (change) => {
      const value = await token()
      const file = path.join(directory, "file.txt")
      if (change === "content") await fs.appendFile(file, "later edit\n")
      if (change === "HEAD")
        await git(
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.invalid",
          "commit",
          "--allow-empty",
          "-m",
          "new head",
        )
      if (change === "source") source.comments.nodes[1]!.body = "```suggestion\nchanged\n```"
      if (change === "anchor") source.line = 3
      if (change === "branch") await git("switch", "-c", "other")
      if (change === "unsaved") dirty = [file]
      if (change === "mode") await fs.chmod(file, 0o755)
      if (change === "symlink") {
        await fs.unlink(file)
        await fs.symlink("other.txt", file)
      }
      if (change === "replacement") {
        await fs.rename(file, path.join(directory, "saved.txt"))
        await fs.copyFile(path.join(directory, "saved.txt"), file)
      }
      const before = await fs.readFile(file)
      const result = await apply(value, change === "route" ? { projectId: "other", requestId: "wrong" } : {})
      expect(result.success).toBe(false)
      expect(result.projectId).toBe(change === "route" ? "other" : route.projectId)
      expect(result.requestId).toBe(change === "route" ? "wrong" : "request")
      expect(await fs.readFile(file)).toEqual(before)
      expect((await apply(value)).success).toBe(false)
    },
  )

  it.each([
    "left",
    "outdated",
    "missing",
    "ambiguous",
    "offset",
    "nested",
    "changed",
    "shifted",
    "binary",
    "oversize",
    "escape",
    "git",
    "symlink",
    "parent",
    "unsaved",
    "head",
  ])("rejects unsafe %s previews", async (change) => {
    const file = path.join(directory, "file.txt")
    if (change === "left") source.diffSide = "LEFT"
    if (change === "outdated") source.isOutdated = true
    if (change === "missing") source.line = null
    if (change === "ambiguous") source.comments.nodes.push(source.comments.nodes[1]!)
    if (change === "offset") source.comments.nodes[1]!.body = "```suggestion:-1+1\nnew\n```"
    if (change === "nested") source.comments.nodes[1]!.body = "> ```suggestion\n> new\n> ```"
    if (change === "changed") await fs.writeFile(file, "first\nmodified\nthird\n")
    if (change === "shifted") await fs.writeFile(file, "inserted\nfirst\nold\nthird\n")
    if (change === "binary") await fs.writeFile(file, Buffer.from([65, 0, 66]))
    if (change === "oversize") await fs.writeFile(file, "a".repeat(1024 * 1024 + 1))
    if (change === "escape") source.path = "../escape"
    if (change === "git") source.path = ".git/config"
    if (change === "symlink") {
      await fs.unlink(file)
      await fs.symlink("other.txt", file)
    }
    if (change === "parent") {
      await fs.symlink(directory, path.join(directory, "alias"))
      source.path = "alias/file.txt"
    }
    if (change === "unsaved") {
      await fs.symlink(file, path.join(directory, "editor"))
      dirty = [path.join(directory, "editor")]
    }
    if (change === "head") source.pullRequest.headRefOid = "a".repeat(40)
    expect((await preview()).success).toBe(false)
  })

  it("selects the UI top-level index and rejects offset syntax without shifting indexes", async () => {
    source.comments.nodes[1]!.body =
      "> ```suggestion\n> ignored\n> ```\n\n```suggestion:-1+1\nunsupported\n```\n\n```suggestion\nsecond\n```"
    expect((await preview()).success).toBe(false)
    const result = await preview({ suggestion: 1 })
    if (result.type !== "agentManager.previewPRSuggestionResult" || !result.preview) throw new Error(result.error)
    expect(result.preview.patch).toContain("+second")
    expect((await apply(result.preview.token)).success).toBe(true)
  })

  it("treats Git path arguments literally and returns a bounded patch", async () => {
    const file = path.join(directory, "file*.txt")
    const content = Array.from({ length: 10_000 }, (_, index) => `line ${index}`).join("\n") + "\n"
    await fs.writeFile(file, content)
    await git("add", "--", "file*.txt")
    await git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "literal path")
    source.path = "file*.txt"
    source.line = 5000
    source.pullRequest.headRefOid = await git("rev-parse", "HEAD")
    const result = await preview()
    if (result.type !== "agentManager.previewPRSuggestionResult" || !result.preview) throw new Error(result.error)
    expect(result.preview.patch.length).toBeLessThan(500)
    expect(result.preview.patch).toContain("-line 4999\n+new")
    expect((await apply(result.preview.token)).success).toBe(true)
    expect(await fs.readFile(file, "utf8")).toBe(content.replace("line 4999\n", "new\n"))
    expect(await fs.readFile(path.join(directory, "file.txt"), "utf8")).toContain("\nold\n")
  })

  it("applies multiline ranges and empty suggestions as deletions", async () => {
    source.startLine = 2
    source.startDiffSide = "RIGHT"
    source.line = 3
    source.comments.nodes[1]!.body = "```suggestion\n```"
    expect((await apply(await token())).success).toBe(true)
    expect(await fs.readFile(path.join(directory, "file.txt"), "utf8")).toBe("first\nfourth\nfifth\nlast\n")
  })

  it("keeps the missing EOF newline when deleting the final line", async () => {
    const file = path.join(directory, "file.txt")
    await fs.writeFile(file, "first\nold")
    await git("add", "file.txt")
    await git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "no newline")
    source.pullRequest.headRefOid = await git("rev-parse", "HEAD")
    source.comments.nodes[1]!.body = "```suggestion\n```"
    expect((await apply(await token())).success).toBe(true)
    expect(await fs.readFile(file, "utf8")).toBe("first")
  })

  it("binds a token to its original route even when another route becomes valid", async () => {
    const value = await token()
    route.projectId = "other"
    try {
      const result = await apply(value)
      expect(result.success).toBe(false)
      expect(result.error).toContain("another route")
      expect(result.projectId).toBe("other")
    } finally {
      route.projectId = "project"
    }
    expect(await fs.readFile(path.join(directory, "file.txt"), "utf8")).toContain("\nold\n")
  })

  it("rejects omitted start metadata rather than inferring an anchor", async () => {
    execute.mockResolvedValue({
      stdout: JSON.stringify({ data: { node: { ...source, startLine: undefined } } }),
      stderr: "",
    })
    expect((await preview()).success).toBe(false)
  })

  it("serializes competing applies and rejects a concurrently submitted replay", async () => {
    const first = await token()
    const second = await token()
    const results = await Promise.all([
      apply(first, { requestId: "first" }),
      apply(second, { requestId: "second" }),
      apply(first, { requestId: "replay" }),
    ])
    expect(results.map((result) => [result.requestId, result.success])).toEqual([
      ["first", true],
      ["second", false],
      ["replay", false],
    ])
    expect(await fs.readFile(path.join(directory, "file.txt"), "utf8")).toBe("first\nnew\nthird\nfourth\nfifth\nlast\n")
  })

  it("rejects remote HEAD changes and missing comments at apply", async () => {
    const value = await token()
    const head = source.pullRequest.headRefOid
    source.pullRequest.headRefOid = "a".repeat(40)
    expect((await apply(value)).success).toBe(false)
    source.pullRequest.headRefOid = head
    const another = await token()
    source.comments.nodes = []
    expect((await apply(another)).success).toBe(false)
    expect(await fs.readFile(path.join(directory, "file.txt"), "utf8")).toContain("\nold\n")
  })

  it("rejects hard-linked files and GraphQL errors", async () => {
    await fs.link(path.join(directory, "file.txt"), path.join(directory, "linked"))
    expect((await preview()).success).toBe(false)
    await fs.unlink(path.join(directory, "linked"))
    execute.mockResolvedValue({
      stdout: JSON.stringify({ data: { node: source }, errors: [{ message: "denied" }] }),
      stderr: "",
    })
    expect((await preview()).success).toBe(false)
  })

  it.each(["\n", "\r\n"])("preserves %j EOL, missing EOF newline and executable mode", async (eol) => {
    const file = path.join(directory, "file.txt")
    await fs.writeFile(file, `first${eol}old`)
    await fs.chmod(file, 0o755)
    await git("add", "file.txt")
    await git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "endings")
    source.pullRequest.headRefOid = await git("rev-parse", "HEAD")
    const index = await fs.readFile(path.join(directory, ".git", "index"))
    const mode = (await fs.stat(file)).mode
    expect((await apply(await token())).success).toBe(true)
    expect(await fs.readFile(file, "utf8")).toBe(`first${eol}new`)
    expect((await fs.stat(file)).mode).toBe(mode)
    expect(await fs.readFile(path.join(directory, ".git", "index"))).toEqual(index)
  })

  it("expires and disposes previews without writes", async () => {
    const value = await token()
    const now = Date.now()
    const clock = spyOn(Date, "now").mockReturnValue(now + 120_001)
    expect((await apply(value)).success).toBe(false)
    clock.mockRestore()
    const another = await token()
    actions.dispose()
    expect((await apply(another)).success).toBe(false)
    expect(await fs.readFile(path.join(directory, "file.txt"), "utf8")).toContain("\nold\n")
  })

  it("does not handle unrelated messages or use unknown cached comments", async () => {
    expect(actions.handle({ type: "agentManager.replyComment" })).toBe(false)
    expect((await preview({ commentId: "unknown" })).success).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })
})
