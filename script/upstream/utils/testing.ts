/**
 * Temporary git repositories for the sync tooling tests.
 *
 * The fixture looks like the v2 setup: an `upstream` line with release commits on `dev` and
 * version-bump tag commits next to it, and a Kilo branch `v2` that starts at a release commit.
 */

import { $ } from "bun"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

export interface Repo {
  dir: string
  git(...args: string[]): Promise<string>
  write(file: string, text: string): Promise<void>
  remove(file: string): Promise<void>
  commit(message: string, date?: string): Promise<string>
  /** Commit on the current branch, then tag a version-bump commit next to it, like an upstream release */
  release(tag: string, date: string): Promise<string>
  [Symbol.asyncDispose](): Promise<void>
}

export async function repo(): Promise<Repo> {
  const dir = await mkdtemp(path.join(tmpdir(), "kilo-upstream-test-"))
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }
  const git = async (...args: string[]) => (await $`git ${args}`.cwd(dir).env(env).quiet().text()).trim()
  await git("init", "-q", "-b", "dev")
  await git("config", "user.name", "Test")
  await git("config", "user.email", "test@example.com")
  await git("config", "commit.gpgsign", "false")
  await git("config", "tag.gpgsign", "false")

  const commit = async (message: string, date = "2026-10-01T00:00:00Z") => {
    await git("add", "-A")
    await $`git commit -q --allow-empty -m ${message}`
      .cwd(dir)
      .env({ ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
      .quiet()
    return git("rev-parse", "HEAD")
  }

  const write = async (file: string, text: string) => {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true })
    await Bun.write(path.join(dir, file), text)
  }

  return {
    dir,
    git,
    write,
    remove: (file) => rm(path.join(dir, file), { force: true }),
    commit,
    async release(tag, date) {
      const branch = await git("branch", "--show-current")
      const head = await commit(`feat: work for ${tag}`, date)
      await git("switch", "-q", "--detach")
      await commit(`release: ${tag}`, date)
      await git("tag", tag)
      await git("switch", "-q", branch)
      return head
    },
    [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }),
  }
}

/** Make `upstream/dev` point at the local `dev` branch, as after `git fetch upstream` */
export async function linkUpstream(r: Repo) {
  await r.git("remote", "add", "upstream", r.dir)
  await r.git("update-ref", "refs/remotes/upstream/dev", "dev")
}
