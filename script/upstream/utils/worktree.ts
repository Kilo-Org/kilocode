#!/usr/bin/env bun

import { $ } from "bun"
import { randomUUID } from "node:crypto"
import { mkdir, realpath, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface RefInput {
  tag: string
  upstream: string
  base: string
  merge: string
  snapshot?: string
}

export interface RefInfo {
  opencode: string
  main: string
  auto: string
  branch: string
  snapshot: string
}

async function exists(path: string) {
  return stat(path)
    .then((s) => s.isDirectory())
    .catch(() => false)
}

async function root() {
  return (await $`git rev-parse --show-toplevel`.text()).trim()
}

function slug(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-")
}

async function assertWorktree(path: string) {
  const ok = await exists(path)
  if (!ok) return false

  const result = await $`git -C ${path} rev-parse --show-toplevel`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`${path} exists but is not a git worktree`)
  }

  const top = result.stdout.toString().trim()
  if ((await realpath(top)) !== (await realpath(path))) {
    throw new Error(`${path} exists inside a git worktree but is not the worktree root`)
  }

  return true
}

async function assertClean(path: string) {
  const status = await $`git -C ${path} status --porcelain`.text()
  if (status.trim()) {
    throw new Error(`${path} has local changes; clean it before refreshing opencode merge references`)
  }
}

async function checkout(path: string, ref: string) {
  const found = await assertWorktree(path)
  if (found) {
    await assertClean(path)
    await $`git -C ${path} checkout --detach ${ref}`.quiet()
    return
  }

  await $`git worktree add --detach ${path} ${ref}`.quiet()
}

async function detach(path: string) {
  const found = await assertWorktree(path)
  if (!found) return

  await assertClean(path)
  await $`git -C ${path} checkout --detach`.quiet()
}

async function snapshot(input: RefInput) {
  if (input.snapshot) return input.snapshot

  const idx = join(tmpdir(), `kilo-opencode-merge-${randomUUID()}.index`)
  try {
    await $`env GIT_INDEX_FILE=${idx} git read-tree ${input.base}`.quiet()
    await $`env GIT_INDEX_FILE=${idx} git add -A`.quiet()
    const tree = (await $`env GIT_INDEX_FILE=${idx} git write-tree`.text()).trim()
    const msg = `chore: snapshot automated opencode merge for ${input.tag}`
    const commit = await $`git commit-tree ${tree} -p ${input.base} -p ${input.merge} -m ${msg}`.text()
    return commit.trim()
  } finally {
    await rm(idx, { force: true })
  }
}

export async function prepare(input: RefInput): Promise<RefInfo> {
  const repo = await root()
  const dir = join(repo, ".worktrees", "opencode-merge")
  const opencode = join(dir, "opencode")
  const main = join(dir, "kilo-main")
  const auto = join(dir, "auto-merge")
  const branch = `opencode-merge/auto-${slug(input.tag)}`

  await mkdir(dir, { recursive: true })
  await $`git worktree prune`.quiet()

  const snap = await snapshot(input)
  await detach(auto)
  await $`git branch -f ${branch} ${snap}`.quiet()

  await checkout(opencode, input.upstream)
  await checkout(main, input.base)
  await checkout(auto, branch)

  return {
    opencode,
    main,
    auto,
    branch,
    snapshot: snap,
  }
}
