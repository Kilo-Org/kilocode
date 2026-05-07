#!/usr/bin/env bun
/**
 * Shared helpers for resetting a single file to the last merged upstream
 * version and for classifying how far a file has drifted from upstream.
 *
 * Used by both reset-to-upstream.ts (single-file CLI) and
 * find-reset-candidates.ts (bulk finder).
 */

import { rm } from "node:fs/promises"
import path from "node:path"
import { approxDiff, binary, clean, join } from "./markers"
import { translate, upstreamData } from "./upstream"

export type ResetAction = "identical" | "deleted" | "written" | "skipped"

export interface ResetResult {
  action: ResetAction
  reason?: string
}

export interface ResetOptions {
  /** Repo root absolute path. */
  root: string
  /** Repo-relative file path. */
  file: string
  /** Upstream commit SHA to read from. */
  commit: string
  /** Do not write; report the action that would be taken. */
  dryRun?: boolean
}

/**
 * Reset a file to the transformed last merged upstream version. Binary files
 * are restored as raw bytes without text transforms. Files that do not exist
 * upstream are deleted from the working tree.
 */
export async function resetFile(opts: ResetOptions): Promise<ResetResult> {
  const abs = path.join(opts.root, opts.file)
  const data = await upstreamData(opts.commit, opts.file)

  if (data === null) {
    if (opts.dryRun) return { action: "deleted", reason: "dry-run" }
    await rm(abs, { force: true })
    return { action: "deleted" }
  }

  if (binary(data)) {
    const current = await Bun.file(abs)
      .arrayBuffer()
      .then((buffer) => new Uint8Array(buffer))
      .catch(() => null)
    if (current && same(current, data)) return { action: "identical" }

    if (opts.dryRun) return { action: "written", reason: "dry-run" }
    await Bun.write(abs, data)
    return { action: "written" }
  }

  const base = new TextDecoder().decode(data)
  const next = await translate(opts.file, base)
  const current = await Bun.file(abs)
    .text()
    .catch(() => null)
  if (current === next) return { action: "identical" }

  if (opts.dryRun) return { action: "written", reason: "dry-run" }
  await Bun.write(abs, next)
  return { action: "written" }
}

export type Bucket =
  | "identical"
  | "markers-only"
  | "cosmetic-only"
  | "small-diff"
  | "large-diff"
  | "upstream-missing"
  | "binary-diff"
  | "binary-identical"
  | "local-missing"
  | "too-large"

export interface ClassifyResult {
  bucket: Bucket
  /** Non-marker, non-whitespace diff line count for text diffs. */
  lines?: number
}

export interface ClassifyOptions {
  root: string
  file: string
  commit: string
  /** Threshold for small-diff vs large-diff (inclusive upper bound for small). */
  reviewLimit: number
}

/**
 * Classify how a file compares to the transformed last merged upstream version.
 * Does not touch the working tree.
 */
export async function classifyDrift(opts: ClassifyOptions): Promise<ClassifyResult> {
  const abs = path.join(opts.root, opts.file)
  const data = await upstreamData(opts.commit, opts.file)
  if (data === null) return { bucket: "upstream-missing" }

  if (binary(data)) {
    const current = await Bun.file(abs)
      .arrayBuffer()
      .then((buffer) => new Uint8Array(buffer))
      .catch(() => null)
    if (current === null) return { bucket: "local-missing" }
    return same(current, data) ? { bucket: "binary-identical" } : { bucket: "binary-diff" }
  }

  const upstreamText = new TextDecoder().decode(data)
  const translated = await translate(opts.file, upstreamText)
  const local = await Bun.file(abs)
    .text()
    .catch(() => null)
  if (local === null) return { bucket: "local-missing" }
  if (local === translated) return { bucket: "identical" }

  const cleanedLocal = join(clean(opts.file, local).text)
  const cleanedUpstream = join(clean(opts.file, translated).text)
  if (cleanedLocal === cleanedUpstream) return { bucket: "markers-only" }

  const count = approxDiff(cleanedUpstream, cleanedLocal, { ignoreWhitespace: true })
  if (count === 0) return { bucket: "cosmetic-only" }
  if (count <= opts.reviewLimit) return { bucket: "small-diff", lines: count }
  return { bucket: "large-diff", lines: count }
}

function same(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}
