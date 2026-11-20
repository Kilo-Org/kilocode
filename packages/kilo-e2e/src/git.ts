import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

export type Project = {
  path: string
  branch: string
  commit: string
}

export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GitError"
  }
}

const BRANCH = "main"
const README = `# Kilo E2E fixture

Deterministic project fixture used by the Kilo IDE-neutral end-to-end harness.
`

const AGENTS = `# Fixture instructions

This repository is generated deterministically for end-to-end scenarios.
`

const DATE = "2000-01-01T00:00:00Z"

const IDENTITY = {
  GIT_AUTHOR_NAME: "Kilo E2E",
  GIT_AUTHOR_EMAIL: "e2e@kilo.invalid",
  GIT_COMMITTER_NAME: "Kilo E2E",
  GIT_COMMITTER_EMAIL: "e2e@kilo.invalid",
  GIT_AUTHOR_DATE: DATE,
  GIT_COMMITTER_DATE: DATE,
}

async function git(args: string[], cwd: string) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: { ...process.env, ...IDENTITY },
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) throw new GitError(`git ${args.join(" ")} failed: ${stderr.trim().slice(0, 500)}`)
  return stdout
}

export async function createProject(dir: string): Promise<Project> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(join(dir, "README.md"), README)
  await writeFile(join(dir, "AGENTS.md"), AGENTS)
  await git(["init", "-q", "-b", BRANCH, dir], dir)
  await git(["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "add", "-A"], dir)
  await git(
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Kilo E2E",
      "-c",
      "user.email=e2e@kilo.invalid",
      "commit",
      "-q",
      "-m",
      "chore: deterministic e2e fixture",
    ],
    dir,
  )
  const commit = (await git(["rev-parse", "HEAD"], dir)).trim()
  return { path: dir, branch: BRANCH, commit }
}
