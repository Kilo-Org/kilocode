import { realpath } from "node:fs/promises"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import type { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { KiloHooks } from "./hooks"
import { KiloHookPayload } from "./payload"

// Kilo-only git events: CommitMessage (IDE commit message generation) and BranchName (Agent
// Manager branch names).

type Services = { config: Config.Interface; database: Database.Interface }

function resolve(event: KiloHooks.Event, services: Services, sessionID?: SessionID) {
  return KiloHooks.resolve(sessionID, event).pipe(
    Effect.provideService(Config.Service, services.config),
    Effect.provideService(Database.Service, services.database),
  )
}

/** The last non-empty string `key` in the hooks' `hookSpecificOutput`, in config order. */
function rewrite(specific: readonly Record<string, unknown>[], key: string) {
  return specific
    .map((item) => item[key])
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .at(-1)
}

/**
 * Where a CommitMessage hook runs: the client's repository path when it resolves inside the
 * project, else the instance directory. A client-supplied path never picks a directory outside it.
 */
export const directory = Effect.fn("KiloHookGit.directory")(function* (target: string) {
  const instance = yield* InstanceState.context
  const root = instance.worktree === "/" ? instance.directory : instance.worktree
  const real = (file: string) => Effect.promise(() => realpath(file).catch(() => undefined))
  const base = (yield* real(root)) ?? root
  const resolved = yield* real(target)
  if (resolved && FSUtil.contains(base, resolved)) return resolved
  return instance.directory
})

/**
 * CommitMessage after a commit message was generated. Returns the message, rewritten by
 * `hookSpecificOutput.commitMessage` (the last hook in config order wins); a block fails with
 * `KiloHooks.Blocked`.
 */
export const commit = Effect.fn("KiloHookGit.commit")(function* (
  input: {
    /** Repository path the client sent; hooks run there only when it is inside the instance worktree. */
    path: string
    message: string
    selected?: readonly string[]
    previous?: string
    language?: string
  } & Services,
) {
  const hooks = yield* resolve("CommitMessage", input)
  if (!KiloHooks.select(hooks, "CommitMessage", []).length) return input.message
  const cwd = yield* directory(input.path)
  const verdict = yield* KiloHooks.fire({
    event: "CommitMessage",
    hooks,
    payloads: [
      {
        ...KiloHookPayload.base("CommitMessage", { cwd }),
        commit_message: input.message,
        selected_files: input.selected ?? [],
        ...(input.previous === undefined ? {} : { previous_message: input.previous }),
        ...(input.language === undefined ? {} : { language: input.language }),
        kilo_path: input.path,
      },
    ],
    cwd,
  })
  if (verdict.block !== undefined)
    return yield* Effect.fail(new KiloHooks.Blocked(`A CommitMessage hook rejected the message: ${verdict.block}`))
  return rewrite(verdict.specific, "commitMessage") ?? input.message
})

/**
 * BranchName after an Agent Manager branch name was generated. Returns the name, rewritten by
 * `hookSpecificOutput.branchName`, or null when a hook blocked it (the worktree keeps its name).
 */
export const branch = Effect.fn("KiloHookGit.branch")(function* (
  input: {
    sessionID: SessionID
    branch: string
    prompt: string
    sessions: Pick<Session.Interface, "get">
  } & Services,
) {
  const hooks = yield* resolve("BranchName", input, input.sessionID)
  if (!KiloHooks.select(hooks, "BranchName", []).length) return input.branch
  const cwd = yield* InstanceState.directory
  const root = yield* KiloHookPayload.root(input.sessionID, input.sessions)
  const verdict = yield* KiloHooks.fire({
    event: "BranchName",
    hooks,
    payloads: [
      {
        ...KiloHookPayload.base("BranchName", { sessionID: input.sessionID, root, cwd }),
        branch_name: input.branch,
        prompt: input.prompt,
      },
    ],
    cwd,
    sessionID: input.sessionID,
  })
  if (verdict.block !== undefined) return null
  return rewrite(verdict.specific, "branchName") ?? input.branch
})

export * as KiloHookGit from "./git"
