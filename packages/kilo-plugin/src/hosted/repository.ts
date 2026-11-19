import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

/** Only the configured project remote selects a repository. Never carry userinfo, Git options or query parameters. */
export function repository(raw: string) {
  if (!raw || raw.length > 2048 || /[\s\\\p{Cc}]/u.test(raw)) return
  const ssh = /^git@([\w.-]+):([^?#]+)$/.exec(raw)
  const input = ssh ? `ssh://git@${ssh[1]}/${ssh[2]}` : raw
  if (!URL.canParse(input)) return
  const url = new URL(input)
  if (!["https:", "ssh:"].includes(url.protocol) || url.port || !/^[\w-]+(?:\.[\w-]+)+$/.test(url.hostname)) return
  const repo = url.pathname
    .replace(/^\//, "")
    .replace(/\/?$/, "")
    .replace(/\.git$/, "")
  if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(repo)) return
  if (url.hostname === "github.com" && repo.split("/").length !== 2) return
  return `https://${url.hostname}/${repo}`
}

export function projectRepository(directory: string) {
  let file: string | undefined
  let cached: { stamp: string; remote?: string } | undefined
  return async (signal: AbortSignal) => {
    const options = { cwd: directory, signal, timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true }
    // Worktrees keep the origin in their common Git config. Avoid spawning git for every streamed update.
    file ??= await exec("git", ["rev-parse", "--git-path", "config"], options).then(
      (r) => resolve(directory, r.stdout.trim()),
      () => undefined,
    )
    const info = file ? await stat(file, { bigint: true }).catch(() => undefined) : undefined
    if (!info) {
      file = undefined
      cached = undefined
      return
    }
    const stamp = `${info.ino}:${info.ctimeNs}:${info.size}`
    if (cached?.stamp === stamp) return cached.remote
    const raw = await exec("git", ["config", "--local", "--no-includes", "--get", "remote.origin.url"], options).then(
      (r) => r.stdout.trim(),
      () => "",
    )
    const ssh = /^(?:git@|ssh:\/\/git@)([a-zA-Z0-9][\w.-]*)(?=[:/])/.exec(raw)
    // SSH aliases can select an identity for github.com. Resolve the user's real HostName, not a guessed suffix.
    const host =
      ssh &&
      (await exec("ssh", ["-G", "--", ssh[1]!], options).then(
        (r) => /^hostname ([\w.-]+)$/im.exec(r.stdout)?.[1],
        () => undefined,
      ))
    const remote = repository(host && ssh ? raw.replace(ssh[0], ssh[0].replace(ssh[1]!, host)) : raw)
    signal.throwIfAborted()
    cached = { stamp, ...(remote ? { remote } : {}) }
    return remote
  }
}

export function repositoryPayload(remote: string, branch?: string) {
  const url = new URL(remote)
  return url.hostname === "github.com"
    ? { type: "github", repo: url.pathname.slice(1), branch }
    : { type: url.hostname === "gitlab.com" ? "gitlab" : "git", url: remote, branch }
}
