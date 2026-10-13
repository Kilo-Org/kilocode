#!/usr/bin/env bun
/**
 * Version detection utilities for upstream merge automation
 */

import { $ } from "bun"
import { getUpstreamTags, getCommitMessage, getTagsForCommit } from "./git"

export interface VersionInfo {
  version: string
  tag: string
  commit: string
}

/**
 * Parse version from a tag string (e.g., "v1.1.49" -> "1.1.49")
 * Only matches stable versions (not dev/preview tags like v0.0.0-202507310417)
 */
export function parseVersion(tag: string, includePrerelease = false): string | null {
  // Match stable versions like v1.1.49 or 1.1.49
  const stableMatch = tag.match(/^v?(\d+\.\d+\.\d+)$/)
  if (stableMatch) return stableMatch[1] ?? null

  // Optionally match prerelease versions
  if (includePrerelease) {
    const prereleaseMatch = tag.match(/^v?(\d+\.\d+\.\d+-.+)$/)
    if (prereleaseMatch) return prereleaseMatch[1] ?? null
  }

  return null
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((x) => parseInt(x, 10) || 0)
  const partsB = b.split(".").map((x) => parseInt(x, 10) || 0)

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0
    const numB = partsB[i] || 0
    if (numA < numB) return -1
    if (numA > numB) return 1
  }

  return 0
}

/**
 * Get the latest upstream version from tags
 */
export async function getLatestUpstreamVersion(): Promise<VersionInfo | null> {
  const versions = await getAvailableUpstreamVersions()

  if (versions.length === 0) return null

  return versions[0] ?? null
}

/**
 * Get version info for a specific commit
 */
export async function getVersionForCommit(commit: string): Promise<VersionInfo | null> {
  const tags = await getTagsForCommit(commit)

  for (const tag of tags) {
    const version = parseVersion(tag)
    if (version) {
      return { version, tag, commit }
    }
  }

  // Try to extract from commit message
  const message = await getCommitMessage(commit)
  const match = message.match(/v?(\d+\.\d+\.\d+)/)
  if (match && match[1]) {
    return {
      version: match[1],
      tag: `v${match[1]}`,
      commit,
    }
  }

  return null
}

/**
 * Get available upstream versions (sorted newest first)
 */
export async function getAvailableUpstreamVersions(): Promise<VersionInfo[]> {
  // Get tags with their commits directly from ls-remote
  const result = await $`git ls-remote --tags upstream`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to list upstream tags: ${result.stderr.toString()}`)
  }

  const output = result.stdout.toString()
  const versions: VersionInfo[] = []

  for (const line of output.trim().split("\n")) {
    // Match lines like: abc123... refs/tags/v1.1.49
    // Skip annotated tag references (those ending with ^{})
    const match = line.match(/^([a-f0-9]+)\s+refs\/tags\/([^\^]+)$/)
    if (!match) continue

    const commit = match[1]
    const tag = match[2]
    if (!commit || !tag) continue

    const version = parseVersion(tag)
    if (version) {
      versions.push({ version, tag, commit })
    }
  }

  // Sort by version descending
  versions.sort((a, b) => compareVersions(b.version, a.version))

  return versions
}

/**
 * Get current Kilo version from package.json
 */
export async function getCurrentKiloVersion(): Promise<string> {
  // Resolve path relative to repo root (script is in script/upstream/)
  const path = new URL("../../../packages/opencode/package.json", import.meta.url).pathname
  const pkg = await Bun.file(path).json()
  return pkg.version
}
