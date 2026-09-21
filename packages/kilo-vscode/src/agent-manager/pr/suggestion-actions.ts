import { createHash, randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { createTwoFilesPatch, diffArrays } from "diff"
import { Marked } from "marked"
import { exec } from "../../util/process"
import type { PRReviewResult, PRTarget } from "../../shared/pr-comment-actions"
import { execGhRead } from "../gh"
import type { PRReviewContext, PRReviewHost } from "./review-context"

const limit = 1024 * 1024
const lifetime = 120_000
const marked = new Marked()
const query = `query($thread: ID!) {
  node(id: $thread) { ... on PullRequestReviewThread {
    id path diffSide startDiffSide startLine line isOutdated
    pullRequest { number url headRefOid }
    comments(first: 100) { nodes { id body } }
  } }
}`

function hash(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function route(message: Record<string, unknown>): PRTarget & { requestId: string } {
  require(typeof message.worktreeId === "string" && typeof message.requestId === "string", "Invalid request route")
  require(message.projectId === undefined || typeof message.projectId === "string", "Invalid project")
  require(Number.isSafeInteger(message.prNumber) && typeof message.prUrl === "string", "Invalid pull request")
  return {
    projectId: message.projectId as string | undefined,
    worktreeId: message.worktreeId,
    requestId: message.requestId,
    prNumber: message.prNumber as number,
    prUrl: message.prUrl,
  }
}

function identity(target: PRTarget) {
  return JSON.stringify([target.projectId, target.worktreeId, target.prNumber, target.prUrl])
}

async function git(directory: string, args: string[]) {
  return (
    await exec("git", ["--literal-pathspecs", "-C", directory, ...args], { maxBuffer: limit + 4096, timeout: 10_000 })
  ).stdout
}

function text(buffer: Buffer) {
  require(buffer.length <= limit && !buffer.includes(0), "Binary or oversized file is not supported")
  const value = buffer.toString("utf8")
  require(Buffer.from(value).equals(buffer), "File must contain valid UTF-8")
  require(!value.replace(/\r\n/g, "").includes("\r"), "Unsupported line endings")
  require(!value.includes("\r\n") || !value.replace(/\r\n/g, "").includes("\n"), "Mixed line endings are not supported")
  return value
}

function target(directory: string, file: string) {
  const parts = file.split("/")
  require(file.length > 0 &&
    !/[\\\x00-\x1f\x7f:]/.test(file) &&
    !path.isAbsolute(file) &&
    parts.every(
      (part) => part !== "" && !/[. ]$/.test(part) && !/^(?:\.git|git~[1-9])$/i.test(part),
    ), "Unsafe suggestion path")
  let current = directory
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part)
    const stat = fs.lstatSync(current)
    require(!stat.isSymbolicLink(), "Symbolic links are not supported")
    require(index === parts.length - 1 || stat.isDirectory(), "Invalid parent directory")
  }
  require(fs.realpathSync(current) === current, "Suggestion path is not canonical")
  return current
}

function clean(host: PRReviewHost, file: string) {
  for (const dirty of host.dirtyFiles()) {
    const canonical = fs.existsSync(dirty) ? fs.realpathSync(dirty) : path.resolve(dirty)
    require(canonical !== file, "Save the affected editor before applying a suggestion")
  }
}

function opened<T>(file: string, run: (fd: number, stat: fs.Stats, value: string) => T, flags = fs.constants.O_RDONLY) {
  const fd = fs.openSync(file, flags | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(fd)
    require(stat.isFile() &&
      stat.nlink === 1 &&
      stat.size <= limit, "Target must be a small regular file without hard links")
    const value = text(fs.readFileSync(fd))
    return run(fd, stat, value)
  } finally {
    fs.closeSync(fd)
  }
}

function lines(value: string) {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function anchor(node: { startLine: unknown; line: unknown; startDiffSide: unknown }) {
  require(node.startLine === null || typeof node.startLine === "number", "Missing suggestion start metadata")
  const start = node.startLine === null ? node.line : node.startLine
  const end = node.line
  require(typeof start === "number" && typeof end === "number", "Missing suggestion range")
  require(Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start > 0 &&
    end >= start, "Invalid suggestion range")
  require(node.startLine === null
    ? node.startDiffSide === null
    : node.startDiffSide === "RIGHT", "Ambiguous suggestion side")
  return { start, end }
}

type Snapshot = Awaited<ReturnType<PRSuggestionActions["snapshot"]>>
type Preview = {
  route: string
  comment: string
  suggestion: number
  expires: number
  snapshot: Snapshot
}

export class PRSuggestionActions {
  private tokens = new Map<string, Preview>()
  private queue = Promise.resolve()
  private disposed = false

  constructor(private readonly host: PRReviewHost) {}

  dispose() {
    this.disposed = true
    this.tokens.clear()
  }

  handle(message: Record<string, unknown>): boolean {
    if (message.type !== "agentManager.previewPRSuggestion" && message.type !== "agentManager.applyPRSuggestion")
      return false
    const apply = message.type === "agentManager.applyPRSuggestion"
    const saved = typeof message.token === "string" ? this.tokens.get(message.token) : undefined
    if (apply && typeof message.token === "string") this.tokens.delete(message.token)
    this.queue = this.queue.then(async () => {
      const type = apply ? "agentManager.applyPRSuggestionResult" : "agentManager.previewPRSuggestionResult"
      try {
        const request = route(message)
        require(!this.disposed, "Suggestion actions have been disposed")
        const context = this.host.context(message)
        if (apply) {
          require(saved && saved.expires > Date.now(), "Suggestion preview expired or was already used")
          require(saved.route === identity(request), "Suggestion preview belongs to another route")
          await this.apply(saved, message, context)
          this.host.post({ type, ...request, success: true })
          return
        }
        require(typeof message.commentId === "string" &&
          Number.isSafeInteger(message.suggestion) &&
          (message.suggestion as number) >= 0, "Invalid suggestion")
        const snapshot = await this.snapshot(context, message.commentId, message.suggestion as number)
        this.host.context(message)
        require(!this.disposed, "Suggestion actions have been disposed")
        for (const [key, value] of this.tokens) if (value.expires <= Date.now()) this.tokens.delete(key)
        require(this.tokens.size < 32, "Too many pending suggestion previews")
        const token = randomUUID()
        this.tokens.set(token, {
          route: identity(request),
          comment: message.commentId,
          suggestion: message.suggestion as number,
          expires: Date.now() + lifetime,
          snapshot,
        })
        this.host.post({
          type: "agentManager.previewPRSuggestionResult",
          ...request,
          success: true,
          preview: { token, path: snapshot.path, patch: snapshot.patch },
        })
      } catch (error) {
        this.host.post({
          type,
          projectId: message.projectId,
          worktreeId: message.worktreeId,
          prNumber: message.prNumber,
          prUrl: message.prUrl,
          requestId: message.requestId,
          success: false,
          error: error instanceof Error ? error.message : "Suggestion failed",
        } as PRReviewResult)
      }
    })
    return true
  }

  private async apply(saved: Preview, message: Record<string, unknown>, context: PRReviewContext) {
    const snapshot = saved.snapshot
    const file = target(snapshot.directory, snapshot.path)
    clean(this.host, file)
    const parent = path.dirname(file)
    const directory = fs.lstatSync(parent)
    const check = () => {
      const stat = fs.lstatSync(parent)
      require(stat.dev === directory.dev &&
        stat.ino === directory.ino &&
        fs.realpathSync(parent) === parent, "Suggestion parent directory changed")
    }
    const temp = path.join(parent, `.kilo-suggestion-${randomUUID()}.tmp`)
    const fd = fs.openSync(
      temp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    )
    let installed = false
    try {
      const prepared = (() => {
        try {
          check()
          const buffer = Buffer.from(snapshot.after)
          let offset = 0
          while (offset < buffer.length) {
            const written = fs.writeSync(fd, buffer, offset, buffer.length - offset, offset)
            require(written > 0, "Could not complete suggestion file")
            offset += written
          }
          fs.fchmodSync(fd, snapshot.mode & 0o7777)
          fs.fsyncSync(fd)
          return fs.fstatSync(fd)
        } finally {
          fs.closeSync(fd)
        }
      })()
      // Prepare first, then repeat every remote and local guard before replacing the original.
      const current = await this.snapshot(context, saved.comment, saved.suggestion)
      require(JSON.stringify(current) ===
        JSON.stringify(snapshot), "Suggestion changed since preview; preview it again")
      require((await git(current.directory, ["rev-parse", "HEAD"])).trim() === current.head &&
        (await git(current.directory, ["symbolic-ref", "--short", "HEAD"])).trim() ===
          current.branch, "Local HEAD or branch changed")
      const latest = this.host.context(message)
      require(fs.realpathSync(latest.directory) === current.directory &&
        latest.branch === current.branch, "Worktree route changed")
      require(!this.disposed && saved.expires > Date.now(), "Suggestion preview expired or was disposed")
      opened(
        target(snapshot.directory, path.relative(snapshot.directory, temp).split(path.sep).join("/")),
        (_fd, stat, value) => {
          require(stat.dev === prepared.dev &&
            stat.ino === prepared.ino &&
            stat.mode === prepared.mode &&
            value === snapshot.after, "Prepared suggestion file changed")
        },
      )
      opened(
        file,
        (_fd, stat, value) => {
          require(hash(value) === current.content &&
            stat.dev === current.dev &&
            stat.ino === current.ino &&
            stat.mode === current.mode, "File changed since preview")
          const latest = fs.lstatSync(target(current.directory, current.path))
          require(latest.dev === stat.dev && latest.ino === stat.ino, "File was replaced")
        },
        fs.constants.O_RDWR,
      )
      check()
      clean(this.host, file)
      // Same-directory rename exposes only a complete file and notifies normal editor file watchers.
      fs.renameSync(temp, file)
      installed = true
    } finally {
      if (!installed) {
        check()
        fs.rmSync(temp, { force: true })
      }
    }
  }

  private async source(context: PRReviewContext, comment: string, index: number) {
    const roots =
      context.pr.comments?.comments.filter(
        (root) => root.id === comment || root.replies?.some((reply) => reply.id === comment),
      ) ?? []
    require(roots.length === 1 && roots[0]?.threadId, "Suggestion comment is not in the current review")
    const thread = roots[0].threadId
    const response = await execGhRead(["api", "graphql", "-f", `query=${query}`, "-f", `thread=${thread}`], {
      cwd: context.directory,
      maxBuffer: 2 * limit,
      timeout: 30_000,
    })
    const result = JSON.parse(response.stdout)
    require(!result.errors?.length, "Could not verify the suggestion on GitHub")
    const node = result.data?.node
    require(node?.id === thread &&
      node.isOutdated === false &&
      node.diffSide === "RIGHT", "Suggestion requires a current right-side thread")
    require(node.pullRequest?.number === context.pr.number &&
      node.pullRequest.url === context.pr.url &&
      /^[a-f0-9]{40,64}$/.test(node.pullRequest.headRefOid), "Pull request identity could not be verified")
    const { start, end } = anchor(node)
    require(typeof node.path === "string" && Array.isArray(node.comments?.nodes), "Missing suggestion metadata")
    const comments = node.comments.nodes.filter((item: { id?: string }) => item?.id === comment)
    require(comments.length === 1 &&
      typeof comments[0].body === "string" &&
      Buffer.byteLength(comments[0].body) <= limit, "Suggestion comment could not be verified")
    const body: string = comments[0].body
    const blocks = marked
      .lexer(body)
      .filter((token) => token.type === "code" && /^suggestion(?::[-+]?\d+[-+]\d+)?$/.test(token.lang ?? ""))
    const block = blocks.at(index)
    require(block?.type === "code" &&
      block.lang === "suggestion" &&
      /^ {0,3}(?:`{3,}|~{3,})suggestion\s*\r?\n/.test(block.raw), "Only plain suggestion fences are supported")
    return { node, start, end, thread, body, block }
  }

  private async snapshot(context: PRReviewContext, comment: string, index: number) {
    const { node, start, end, thread, body, block } = await this.source(context, comment, index)
    const directory = fs.realpathSync(context.directory)
    require(fs.realpathSync((await git(directory, ["rev-parse", "--show-toplevel"])).trim()) ===
      directory, "Worktree root changed")
    const head = (await git(directory, ["rev-parse", "HEAD"])).trim()
    const branch = (await git(directory, ["symbolic-ref", "--short", "HEAD"])).trim()
    require(branch === context.branch &&
      head === node.pullRequest.headRefOid, "Local branch and HEAD must match the current pull request")
    const file = target(directory, node.path)
    clean(this.host, file)
    const entry = await git(directory, ["ls-tree", "-z", head, "--", node.path])
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([^\0]+)\0$/.exec(entry)
    require(match && match[3] === node.path, "Suggestion target is not a regular HEAD file")
    const original = text(Buffer.from(await git(directory, ["cat-file", "blob", match[2]!]), "utf8"))
    require(!original.includes("\ufffd"), "HEAD file encoding could not be verified")
    const expected = lines(original)
    require(end <= expected.length, "Suggestion range is outside the HEAD file")
    return opened(file, (_fd, stat, before) => {
      const local = lines(before)
      require(local.slice(start - 1, end).join("") ===
        expected.slice(start - 1, end).join(""), "Local suggestion range differs from HEAD")
      let position = 0
      let shift = 0
      const changes = diffArrays(expected, local, { timeout: 500, maxEditLength: 10_000 })
      require(changes, "Local changes are too large to verify safely")
      for (const change of changes) {
        if (change.added) {
          require(position < start - 1 || position >= end, "Local edits overlap the suggestion")
          if (position < start - 1) shift += change.count
          continue
        }
        if (change.removed) {
          require(position + change.count <= start - 1 || position >= end, "Local edits overlap the suggestion")
          if (position < start - 1) shift -= change.count
        }
        position += change.count
        if (position >= start) require(shift === 0, "Local edits shifted the suggestion range")
      }
      const eol = before.includes("\r\n") ? "\r\n" : "\n"
      const ending = local.at(end - 1)?.endsWith("\n") ? eol : ""
      const replacement = block.text.replace(/\r\n/g, "\n").replace(/\n/g, eol)
      const joined =
        local.slice(0, start - 1).join("") + (replacement ? replacement + ending : "") + local.slice(end).join("")
      const after = before.endsWith("\n") || !joined.endsWith("\n") ? joined : joined.slice(0, -eol.length)
      text(Buffer.from(after))
      const patch = createTwoFilesPatch(node.path, node.path, before, after, "", "", {
        context: 3,
        timeout: 500,
        maxEditLength: 10_000,
      })
      require(patch !== undefined, "Suggestion diff is too large to preview safely")
      require(Buffer.byteLength(patch) <= 64 * 1024, "Suggestion preview is too large")
      return {
        directory,
        branch,
        head,
        path: node.path as string,
        source: hash(
          JSON.stringify([
            thread,
            comment,
            body,
            node.path,
            start,
            end,
            node.diffSide,
            node.startDiffSide,
            node.pullRequest.headRefOid,
          ]),
        ),
        content: hash(before),
        dev: stat.dev,
        ino: stat.ino,
        mode: stat.mode,
        after,
        patch,
      }
    })
  }
}
