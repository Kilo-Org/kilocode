import * as fs from "fs/promises"
import * as path from "path"
import { spawn } from "../../util/process"

const LIMIT = 400_000
const SMALL = 80_000
const TIMEOUT = 15_000

type Result = {
  out: string
  err: string
  code: number | null
  signal: NodeJS.Signals | null
  truncated: boolean
  error?: string
}

export async function getGitChangesContext(
  dir: string,
  base?: string,
): Promise<{ content: string; truncated: boolean }> {
  const probe = await run(["rev-parse", "--is-inside-work-tree"], dir, SMALL)
  if (probe.error) return done(dir, `Unable to read git changes: ${probe.error}`)
  if (probe.code !== 0 || probe.out.trim() !== "true") return done(dir, "Not a git repository.")

  const head = await run(["rev-parse", "--verify", "HEAD"], dir, SMALL)
  if (head.error) return done(dir, `Unable to read git changes: ${head.error}`)
  if (base && head.code === 0) return await against(dir, base)
  return await local(dir, head.code === 0)
}

async function local(dir: string, born: boolean): Promise<{ content: string; truncated: boolean }> {
  const [status, diff, untracked] = await Promise.all([
    run(["status", "--short"], dir, SMALL),
    changes(dir, born),
    run(["ls-files", "--others", "--exclude-standard", "-z"], dir, SMALL),
  ])
  const fail = status.error ?? diff.error ?? untracked.error
  if (fail) return done(dir, `Unable to read git changes: ${fail}`)
  if (status.code !== 0 && !status.truncated) return done(dir, `Unable to read git status:\n${output(status)}`.trim())
  if (diff.code !== 0 && !diff.truncated) return done(dir, `Unable to read git diff:\n${output(diff)}`.trim())
  if (untracked.code !== 0 && !untracked.truncated)
    return done(dir, `Unable to read untracked files:\n${output(untracked)}`.trim())

  const extra = await untrackedDiff(dir, untracked.out)
  const body = [diff.out.trim(), extra.content.trim()].filter(Boolean).join("\n\n")
  const changed = status.out.trim() || body.trim()
  if (!changed) return done(dir, "No changes in working directory.")

  const truncated = status.truncated || diff.truncated || untracked.truncated || extra.truncated
  const note = truncated ? "\n\nOutput truncated." : ""
  return cap(
    `Working directory: ${dir}\n\nStatus:\n${status.out.trim() || "(empty)"}\n\nDiff:\n${body || "(empty)"}${note}`,
    truncated,
  )
}

async function against(dir: string, base: string): Promise<{ content: string; truncated: boolean }> {
  const ancestor = await run(["merge-base", "HEAD", base], dir, SMALL)
  if (ancestor.error) return done(dir, `Unable to resolve git base ${base}: ${ancestor.error}`)
  if (ancestor.code !== 0) return done(dir, `Unable to resolve git base ${base}:\n${output(ancestor)}`.trim())

  const ref = ancestor.out.trim()
  const [status, diff, untracked] = await Promise.all([
    run(["diff", "--name-status", "--no-renames", ref], dir, SMALL),
    run(["diff", ref], dir, LIMIT),
    run(["ls-files", "--others", "--exclude-standard", "-z"], dir, SMALL),
  ])
  const fail = status.error ?? diff.error ?? untracked.error
  if (fail) return done(dir, `Unable to read git changes: ${fail}`)
  if (status.code !== 0 && !status.truncated)
    return done(dir, `Unable to read changed files:\n${output(status)}`.trim())
  if (diff.code !== 0 && !diff.truncated) return done(dir, `Unable to read git diff:\n${output(diff)}`.trim())
  if (untracked.code !== 0 && !untracked.truncated)
    return done(dir, `Unable to read untracked files:\n${output(untracked)}`.trim())

  const extra = await untrackedDiff(dir, untracked.out)
  const files = [status.out.trim(), listed(untracked.out)].filter(Boolean).join("\n")
  const body = [diff.out.trim(), extra.content.trim()].filter(Boolean).join("\n\n")
  const changed = files.trim() || body.trim()
  if (!changed) return done(dir, `Base: ${base}\n\nNo changes in worktree diff.`)

  const truncated = status.truncated || diff.truncated || untracked.truncated || extra.truncated
  const note = truncated ? "\n\nOutput truncated." : ""
  return cap(
    `Working directory: ${dir}\nBase: ${base}\nMerge base: ${ref}\n\nFiles:\n${files || "(empty)"}\n\nDiff:\n${body || "(empty)"}${note}`,
    truncated,
  )
}

function listed(raw: string): string {
  return raw
    .split("\0")
    .filter(Boolean)
    .map((file) => `A\t${file}`)
    .join("\n")
}

async function changes(dir: string, born: boolean): Promise<Result> {
  if (born) return run(["diff", "HEAD"], dir, LIMIT)

  const [cached, work] = await Promise.all([run(["diff", "--cached"], dir, LIMIT), run(["diff"], dir, LIMIT)])
  return {
    out: [cached.out.trim(), work.out.trim()].filter(Boolean).join("\n\n"),
    err: [cached.err.trim(), work.err.trim()].filter(Boolean).join("\n"),
    code: cached.code !== 0 ? cached.code : work.code,
    signal: cached.signal ?? work.signal,
    truncated: cached.truncated || work.truncated,
    error: cached.error ?? work.error,
  }
}

async function untrackedDiff(dir: string, raw: string): Promise<{ content: string; truncated: boolean }> {
  const files = raw.split("\0").filter(Boolean)
  const parts: string[] = []
  let used = 0
  let truncated = false

  for (const file of files) {
    const full = path.join(dir, file)
    const stat = await fs.stat(full).catch(() => undefined)
    if (!stat?.isFile()) continue
    if (stat.size > LIMIT) {
      truncated = true
      parts.push(patch(file, `<${stat.size} byte file omitted>`))
      continue
    }

    const buf = await fs.readFile(full).catch(() => undefined)
    const next = !buf
      ? patch(file, `<unreadable file: ${file}>`)
      : binary(buf)
        ? patch(file, `<binary file omitted: ${file}>`)
        : patch(file, buf.toString("utf8"))
    const size = Buffer.byteLength(next, "utf8") + (parts.length ? 2 : 0)
    if (used + size > LIMIT) {
      truncated = true
      break
    }
    parts.push(next)
    used += size
  }

  return cap(parts.join("\n\n"), truncated)
}

function binary(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 8192))
  return head.includes(0)
}

function patch(file: string, text: string) {
  const header = `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}`
  if (!text) return header
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n")
  const body = lines.map((line) => `+${line}`).join("\n")
  return `${header}\n@@ -0,0 +1,${lines.length} @@\n${body}`
}

function cap(content: string, truncated = false) {
  if (Buffer.byteLength(content, "utf8") <= LIMIT) return { content, truncated }
  const text = Buffer.from(content, "utf8").subarray(0, LIMIT).toString("utf8")
  return { content: text, truncated: true }
}

function done(dir: string, text: string) {
  return { content: `Working directory: ${dir}\n\n${text}`, truncated: false }
}

function output(result: Result) {
  return `${result.err.trim()}${result.err.trim() && result.out.trim() ? "\n" : ""}${result.out.trim()}`
}

function run(args: string[], cwd: string, limit: number): Promise<Result> {
  return new Promise((resolve) => {
    const state = { out: "", err: "", done: false, truncated: false }
    const child = spawn("git", args, { cwd })
    const timer = setTimeout(() => {
      state.truncated = true
      child.kill()
    }, TIMEOUT)

    const finish = (result: Pick<Result, "code" | "signal" | "error">) => {
      if (state.done) return
      state.done = true
      clearTimeout(timer)
      resolve({ out: state.out, err: state.err, truncated: state.truncated, ...result })
    }

    const collect = (key: "out" | "err", chunk: Buffer) => {
      if (state.truncated) return
      const used = Buffer.byteLength(state[key], "utf8")
      const free = limit - used
      if (free <= 0) {
        state.truncated = true
        child.kill()
        return
      }
      if (chunk.byteLength > free) {
        state[key] += chunk.subarray(0, free).toString("utf8")
        state.truncated = true
        child.kill()
        return
      }
      state[key] += chunk.toString("utf8")
    }

    child.stdout?.on("data", (chunk: Buffer) => collect("out", chunk))
    child.stderr?.on("data", (chunk: Buffer) => collect("err", chunk))
    child.on("error", (err) => finish({ code: null, signal: null, error: err.message }))
    child.on("close", (code, signal) => finish({ code, signal }))
  })
}
