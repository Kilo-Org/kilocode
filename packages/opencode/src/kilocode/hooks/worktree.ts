import path from "path"
import { lstat } from "node:fs/promises"
import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import type { SessionID } from "@/session/schema"

// Kilo-only worktree events: WorktreeSetup (after a managed worktree is created and its setup
// script ran) and WorktreeTeardown (before a managed worktree is removed), plus the dispatch
// endpoint the extension calls for client-side setup.

export type Origin = "create" | "promote" | "import" | "multi_version" | "tool" | "continue" | "cli"
export type Script = "none" | "succeeded" | "failed"
export type Result = { blocked: boolean; reason?: string }

/** WorktreeSetup for a managed worktree. A block means setup failed. */
export function setup(_input: {
  worktree: string
  /** Repository root (the instance worktree); never taken from a client. */
  root: string
  branch?: string
  parentBranch?: string
  origin: Origin
  script: Script
  sessionID?: SessionID
}): Effect.Effect<Result> {
  return Effect.succeed({ blocked: false })
}

/** WorktreeTeardown before a managed worktree is removed. Observe only: it cannot block. */
export function teardown(_input: { worktree: string; root: string }): Effect.Effect<void> {
  return Effect.void
}

/**
 * Runs a client-side event (`POST /kilocode/hooks/dispatch`) for a worktree `managed` already
 * validated. Concurrent dispatches for one worktree share the in-flight result.
 */
export function dispatch(_input: {
  event: "WorktreeSetup"
  worktree: string
  root: string
  branch?: string
  parentBranch?: string
  origin: Exclude<Origin, "cli">
  script: Script
  sessionID?: SessionID
}): Effect.Effect<Result> {
  return Effect.succeed({ blocked: false })
}

/**
 * The resolved path of a managed worktree (`<root>/.kilo/worktrees/<one component>`), or undefined
 * when `worktree` is not absolute, escapes that directory, is nested deeper, or passes through a
 * symbolic link (which could reach a directory outside the project).
 */
export const managed = Effect.fn("KiloHookWorktree.managed")(function* (
  instance: { worktree: string },
  worktree: string,
) {
  // Lexical checks first: `contains` rejects `..` and absolute escapes; one component rejects nested paths.
  const parent = path.resolve(instance.worktree, ".kilo", "worktrees")
  const target = path.resolve(worktree)
  const child = path.relative(parent, target).split(path.sep).filter(Boolean)
  if (!path.isAbsolute(worktree) || !FSUtil.contains(parent, target) || child.length !== 1) return undefined
  const links = yield* Effect.forEach([path.dirname(parent), parent, target], (item) =>
    Effect.promise(() =>
      lstat(item).then(
        (info) => info.isSymbolicLink(),
        () => false,
      ),
    ),
  )
  if (links.some(Boolean)) return undefined
  return target
})

export * as KiloHookWorktree from "./worktree"
