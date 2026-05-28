#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Configures repo-local git settings for all contributors.
 *
 * `merge.conflictStyle=zdiff3` makes conflict markers include the common
 * ancestor (|||||||) alongside ours/theirs. That base section is what
 * mergiraf's syntax-aware resolution feeds on during upstream opencode
 * merges (see script/upstream/merge.ts) and it makes manual resolution
 * dramatically easier than the default 2-way `merge` markers.
 *
 * Runs from `postinstall`. Safe to re-run — `git config` is idempotent.
 * Guarded so tarball / docker installs without a `.git` don't fail.
 */

import { $ } from "bun"

const inside = await $`git rev-parse --is-inside-work-tree`.nothrow().quiet()
if (inside.exitCode !== 0) process.exit(0)

await $`git config --local merge.conflictStyle zdiff3`.quiet()
