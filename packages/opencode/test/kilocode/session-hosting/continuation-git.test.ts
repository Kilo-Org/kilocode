import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Git } from "../../../src/git"
import { Continuation } from "../../../src/kilocode/session-hosting/continuation"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"

const layer = LayerNode.compile(LayerNode.group([Git.node]))

// Git validation uses real local repositories. Only the supported remote URL
// is substituted; these tests do not prove GitHub network access.
const urls = new Map<string, string>()

function transport(git: Git.Interface, directory: string): Git.Interface {
  return {
    ...git,
    run: (args, opts) =>
      git.run(args, opts).pipe(
        Effect.map((result) => {
          const url = urls.get(directory)
          if (url && args.join(" ") === "remote get-url origin") return { ...result, text: () => url }
          return result
        }),
      ),
  }
}

function check(directory: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git.Service
      return yield* Continuation.checkWorktree(transport(git, directory), directory)
    }).pipe(Effect.provide(layer), Effect.flip),
  )
}

function checkExit(directory: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git.Service
      return yield* Continuation.checkWorktree(transport(git, directory), directory)
    }).pipe(Effect.provide(layer), Effect.exit),
  )
}

async function repo() {
  const work = await tmpdir({ git: true })
  const remote = await tmpdir()
  const bare = `${remote.path}/repo.git`
  await $`git init --bare ${bare}`.cwd(work.path).quiet()
  await $`git remote add origin ${bare}`.cwd(work.path).quiet()
  const branch = (await $`git rev-parse --abbrev-ref HEAD`.cwd(work.path).text()).trim()
  await $`git push -u origin ${branch}`.cwd(work.path).quiet()
  return { work, remote, branch, bare }
}

// A local bare repository supplies actual Git objects for the supported-URL cases.
async function supported() {
  const work = await tmpdir({ git: true })
  const branch = (await $`git rev-parse --abbrev-ref HEAD`.cwd(work.path).text()).trim()
  const bare = path.join(work.path, "acme", "widget")
  await fs.mkdir(path.dirname(bare), { recursive: true })
  await $`git init --bare ${bare}`.quiet()
  // Keep the in-worktree bare repository out of `status --porcelain`.
  await Bun.write(path.join(work.path, ".git", "info", "exclude"), "acme/\n")
  await $`git remote add origin acme/widget`.cwd(work.path).quiet()
  await $`git push -u origin ${branch}`.cwd(work.path).quiet()
  urls.set(work.path, "https://github.com/acme/widget.git")
  return { work, branch, bare }
}

test("rejects a dirty worktree", async () => {
  const { work, remote } = await repo()
  await Bun.write(`${work.path}/untracked.txt`, "dirty")
  const error = await check(work.path)
  expect(error).toMatchObject({ code: "worktree_dirty", retryable: false })
  await work[Symbol.asyncDispose]()
  await remote[Symbol.asyncDispose]()
})

test("rejects a detached HEAD", async () => {
  const { work, remote } = await repo()
  await $`git checkout --detach`.cwd(work.path).quiet()
  const error = await check(work.path)
  expect(error).toMatchObject({ code: "branch_detached", retryable: false })
  await work[Symbol.asyncDispose]()
  await remote[Symbol.asyncDispose]()
})

test("rejects a branch with no upstream", async () => {
  const { work, remote, branch } = await repo()
  await $`git branch --unset-upstream ${branch}`.cwd(work.path).quiet()
  const error = await check(work.path)
  expect(error).toMatchObject({ code: "branch_no_upstream", retryable: false })
  await work[Symbol.asyncDispose]()
  await remote[Symbol.asyncDispose]()
})

test("rejects a branch whose local commits are not pushed", async () => {
  const { work, remote } = await repo()
  await Bun.write(`${work.path}/change.txt`, "one")
  await $`git add -A`.cwd(work.path).quiet()
  await $`git -c user.name=test -c user.email=test@example.com commit -m local`.cwd(work.path).quiet()
  const error = await check(work.path)
  expect(error).toMatchObject({ code: "branch_not_pushed", retryable: false })
  await work[Symbol.asyncDispose]()
  await remote[Symbol.asyncDispose]()
})

test("rejects a remote that is not GitHub or GitLab", async () => {
  const { work, remote } = await repo()
  const error = await check(work.path)
  expect(error).toMatchObject({ code: "remote_unsupported", retryable: false })
  await work[Symbol.asyncDispose]()
  await remote[Symbol.asyncDispose]()
})

test("accepts a pushed branch on a supported GitHub remote", async () => {
  const { work, branch } = await supported()
  const exit = await checkExit(work.path)
  expect(Exit.isSuccess(exit)).toBe(true)
  if (Exit.isSuccess(exit)) {
    expect(exit.value).toEqual({ type: "github", repo: "acme/widget", branch })
  }
  await work[Symbol.asyncDispose]()
})

test("fetches the remote object when local tracking is stale", async () => {
  const { work, branch, bare } = await supported()
  const other = await tmpdir()
  const clone = `${other.path}/clone`

  // A second repository advances the remote branch. The work repo's tracking ref
  // is stale and it does not have the new commit object.
  await $`git init -b ${branch} ${clone}`.quiet()
  await $`git remote add origin ${bare}`.cwd(clone).quiet()
  await $`git fetch origin ${branch}`.cwd(clone).quiet()
  await $`git reset --hard origin/${branch}`.cwd(clone).quiet()
  await Bun.write(`${clone}/remote.txt`, "remote")
  await $`git add -A`.cwd(clone).quiet()
  await $`git -c user.name=test -c user.email=test@example.com commit -m remote`.cwd(clone).quiet()
  await $`git push origin ${branch}`.cwd(clone).quiet()
  const head = (await $`git rev-parse HEAD`.cwd(clone).text()).trim()

  const present = await $`git cat-file -e ${head}^{commit}`.cwd(work.path).quiet().nothrow()
  expect(present.exitCode).not.toBe(0)

  // checkWorktree reads the live remote SHA and fetches the missing object.
  const exit = await checkExit(work.path)
  expect(Exit.isSuccess(exit)).toBe(true)

  await work[Symbol.asyncDispose]()
  await other[Symbol.asyncDispose]()
})

test("rejects a remote branch that no longer contains HEAD", async () => {
  const { work, branch, bare } = await supported()
  const other = await tmpdir()
  const clone = `${other.path}/clone`

  // A second repository force-pushes an unrelated root, so the remote branch no
  // longer contains HEAD even though it is reachable.
  await $`git init ${clone}`.quiet()
  await $`git remote add origin ${bare}`.cwd(clone).quiet()
  await $`git checkout --orphan ${branch}`.cwd(clone).quiet()
  await $`git -c user.name=test -c user.email=test@example.com commit -m fresh --allow-empty`.cwd(clone).quiet()
  await $`git push --force origin HEAD:${branch}`.cwd(clone).quiet()

  const error = await check(work.path)
  expect(error).toMatchObject({ code: "branch_not_pushed", retryable: false })

  await work[Symbol.asyncDispose]()
  await other[Symbol.asyncDispose]()
})

test("uses the configured upstream branch when the local name differs", async () => {
  const { work } = await supported()
  await using _cleanup = work
  await $`git push -u origin HEAD:refs/heads/review/nested`.cwd(work.path).quiet()
  const exit = await checkExit(work.path)
  expect(Exit.isSuccess(exit)).toBe(true)
  if (Exit.isSuccess(exit)) {
    expect(exit.value).toEqual({ type: "github", repo: "acme/widget", branch: "review/nested" })
  }
})

test("rejects a relative local remote that resembles GitHub shorthand", async () => {
  const { work } = await supported()
  await using cleanup = work
  urls.delete(work.path)
  expect(await check(work.path)).toMatchObject({ code: "remote_unsupported", retryable: false })
})
