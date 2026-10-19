#!/usr/bin/env bun
/**
 * Upstream release discovery for the Kilo v2 line.
 *
 * Upstream cuts each `v2.x.y` release as a version-bump commit next to `dev`, tags it, and does not
 * merge it back. The sync target is the release commit: the parent of the tag, which is on `dev`.
 */

import { $ } from "bun"
import { defaultConfig, type MergeConfig } from "./config"
import { isAncestor } from "./git"

export interface Release {
  /** Version without the `v` prefix, for example `2.0.27` */
  version: string
  /** Tag name, for example `v2.0.27` */
  tag: string
  /** Commit the tag points at (the version-bump commit) */
  tagCommit: string
  /** Release commit on the upstream branch: the sync target */
  commit: string
  /** Release time (committer date of the tag commit), ISO 8601 */
  date: string
}

export interface Lag {
  /** Releases on the upstream branch that the base does not have */
  releases: number
  /** Days between the newest release in the base and the newest upstream release */
  days: number
}

export interface SyncStatus {
  releases: Release[]
  merged: Release | undefined
  pending: Release[]
  next: Release | undefined
  lag: Lag
}

/** Parse a tag like `v2.0.27` into `2.0.27`. Pre-release tags are ignored. */
export function parseVersion(tag: string): string | null {
  return tag.match(/^v?(\d+\.\d+\.\d+)$/)?.[1] ?? null
}

/** Compare two `x.y.z` versions: -1 when a < b, 0 when equal, 1 when a > b */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((x) => parseInt(x, 10) || 0)
  const right = b.split(".").map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

export function upstreamRef(config: MergeConfig = defaultConfig) {
  return `${config.upstreamRemote}/${config.upstreamBranch}`
}

/**
 * List upstream releases of this line from local tags, newest first.
 * Run `git fetch upstream --tags` first. A tag counts only when its release commit is on the
 * upstream branch, so Kilo tags or tags of other lines with the same pattern are ignored.
 */
export async function getReleases(config: MergeConfig = defaultConfig): Promise<Release[]> {
  const branch = upstreamRef(config)
  const format = "--format=%(refname:short)%00%(objectname)%00%(*objectname)"
  const refs = await $`git for-each-ref refs/tags ${format}`.quiet().text()
  const tags = refs.split("\n").flatMap((line) => {
    const [tag = "", object = "", peeled = ""] = line.split("\0")
    const version = parseVersion(tag)
    if (!version || !config.tagPattern.test(tag)) return []
    return [{ tag, version, tagCommit: peeled || object }]
  })
  if (tags.length === 0) return []

  const unique = [...new Set(tags.map((t) => t.tagCommit))]
  const log = await $`git log --no-walk --format=%H%x00%P%x00%cI ${unique}`.quiet().text()
  const commits = new Map(
    log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash = "", parents = "", date = ""] = line.split("\0")
        return [hash, { parent: parents.split(" ")[0], date }] as const
      }),
  )

  const found = await Promise.all(
    tags.map(async (item) => {
      const info = commits.get(item.tagCommit)
      if (!info) return undefined
      if (await isAncestor(item.tagCommit, branch)) return { ...item, commit: item.tagCommit, date: info.date }
      if (info.parent && (await isAncestor(info.parent, branch))) return { ...item, commit: info.parent, date: info.date }
      return undefined
    }),
  )

  return found
    .filter((release): release is Release => release !== undefined)
    .sort((a, b) => compareVersions(b.version, a.version))
}

/** Find a release by `v2.0.27` or `2.0.27` */
export function findRelease(releases: Release[], input: string): Release | undefined {
  return releases.find((r) => r.tag === input || r.version === input)
}

/** Which releases the base has, which come next, and how far it lags */
export async function getSyncStatus(base: string, config: MergeConfig = defaultConfig): Promise<SyncStatus> {
  const releases = await getReleases(config)
  const flags = await Promise.all(releases.map((r) => isAncestor(r.commit, base)))
  const merged = releases.find((_, i) => flags[i])
  const pending = releases.filter((r, i) => !flags[i] && (!merged || compareVersions(r.version, merged.version) > 0))
  const newest = releases[0]
  const days =
    merged && newest && pending.length > 0
      ? Math.round(((Date.parse(newest.date) - Date.parse(merged.date)) / 86_400_000) * 10) / 10
      : 0
  return {
    releases,
    merged,
    pending,
    // Sync release by release: the next target is the oldest release the base does not have.
    next: pending.at(-1),
    lag: { releases: pending.length, days },
  }
}

/** Version of the Kilo v2 line (root package.json; v2 follows upstream numbering) */
export async function getCurrentKiloVersion(): Promise<string> {
  const path = new URL("../../../package.json", import.meta.url).pathname
  const pkg = await Bun.file(path).json()
  return pkg.version
}
