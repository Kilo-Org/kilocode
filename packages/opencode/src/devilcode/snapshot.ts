import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { Global } from "../global"
import { Instance } from "../project/instance"

const log = Log.create({ service: "snapshot" })

/** Worktree-scoped snapshot git dir (isolated per worktree). */
export function gitdir() {
  const project = Instance.project
  const workhash = Bun.hash(Instance.worktree).toString(36)
  return path.join(Global.Path.data, "snapshot", project.id, workhash)
}

/** Original project-scoped snapshot git dir (pre-isolation layout). */
function legacydir() {
  const project = Instance.project
  return path.join(Global.Path.data, "snapshot", project.id)
}

/** Initialize a bare snapshot git repo if it doesn't exist yet. */
export async function ensureGit(git: string) {
  if (!(await fs.mkdir(git, { recursive: true }))) return
  await $`git init`
    .env({
      ...process.env,
      GIT_DIR: git,
      GIT_WORK_TREE: Instance.worktree,
    })
    .quiet()
    .nothrow()
  await $`git --git-dir ${git} config core.autocrlf false`.quiet().nothrow()
  await $`git --git-dir ${git} config core.longpaths true`.quiet().nothrow()
  await $`git --git-dir ${git} config core.symlinks true`.quiet().nothrow()
  await $`git --git-dir ${git} config core.fsmonitor false`.quiet().nothrow()
  log.info("initialized")
}

/** Point the worktree repo's alternates at the legacy object store. */
export async function syncAlternates(git: string) {
  const legacy = legacydir()
  if (legacy === git) return
  const objects = path.join(legacy, "objects")
  const exists = await fs
    .stat(objects)
    .then(() => true)
    .catch(() => false)
  const target = path.join(git, "objects", "info", "alternates")
  await fs.mkdir(path.join(git, "objects", "info"), { recursive: true })
  await Filesystem.write(target, exists ? objects + "\n" : "")
}

/** Return a ready-to-use snapshot git dir (init + alternates). */
export async function prepare() {
  const git = gitdir()
  await ensureGit(git)
  await syncAlternates(git)
  return git
}
