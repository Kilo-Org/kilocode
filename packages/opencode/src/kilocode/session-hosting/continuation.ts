import { Auth } from "@/auth"
import { Database } from "@opencode-ai/core/database/database"
import { CloudAuth } from "@/kilocode/cloud/auth"
import { resolveCloudAgentOrigin, resolveWebAppOrigin } from "@/kilocode/cloud/origin"
import { ProfileIdentity } from "@/kilocode/cloud/profile-identity"
import { CloudRepository } from "@/kilocode/cloud/repository"
import { PROVIDER } from "@/kilocode/session-hosting/kilo-cloud"
import {
  HostedFailure,
  ProviderContinueWorkspaceInput,
  type ContinueWorkspaceResult,
  type ContinuationAgent,
  type Provider,
  type ProviderContinueWorkspaceResult,
  type Repository,
} from "@/kilocode/session-hosting/types"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Git } from "@/git"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { Permission } from "@/permission"
import { InstanceStore } from "@/project/instance-store"
import { context as instanceContext } from "@/project/instance-context"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { ContinuationIntentTable } from "@opencode-ai/core/kilocode/continuation/sql"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionHostEvent } from "@opencode-ai/schema/kilocode/session-host-event"
import { fetchDefaultModel } from "@kilocode/kilo-gateway"
import { and, eq, lt } from "drizzle-orm"
import { Effect, Option, Redacted, Schema } from "effect"
import path from "path"

/**
 * Continue-in-Cloud preparation.
 *
 * The CLI owns every local guarantee: real Git checks, session selection and
 * idle checks, mode/model capture, acknowledged ingest sync, and the durable,
 * immutable Cloud request body. The Cloud call itself runs through the session
 * host provider. A retry with the same operation key reuses the stored body and
 * never recomputes branch, model, or variant.
 */
export namespace Continuation {
  export interface Input {
    readonly provider: Provider
    readonly operationKey: string
    readonly directory: string
    readonly sessionIDs: readonly string[]
    readonly activeSessionID: string
    readonly env?: CloudAuth.Environment
    readonly timeoutMs?: number
  }

  /** 30 days of product retention, plus a 1-hour in-flight bound and a 1-hour clock margin. */
  const RETENTION_MS = (30 * 24 + 2) * 60 * 60 * 1000
  const SWEEP_LIMIT = 100
  const SYNC_TIMEOUT_MS = 15_000

  const failure = (code: HostedFailure["code"], message: string, retryable: boolean) =>
    new HostedFailure({ code, message, retryable })

  const identityFailure = (error: ProfileIdentity.Failure) =>
    error.kind === "signed_out"
      ? failure("signed_out", error.message, false)
      : error.kind === "unavailable"
        ? failure("auth_unavailable", error.message, true)
        : failure("invalid_response", error.message, false)

  const gitText = (git: Git.Interface, args: string[], cwd: string) =>
    git.run(args, { cwd }).pipe(Effect.map((result) => ({ code: result.exitCode, text: result.text().trim() })))

  /**
   * Real Git validation. The operation succeeds only when HEAD is on a pushed
   * branch of a supported GitHub/GitLab remote that contains HEAD, and the
   * worktree has no uncommitted changes.
   */
  export const checkWorktree = (git: Git.Interface, directory: string): Effect.Effect<Repository, HostedFailure> =>
    Effect.gen(function* () {
      const head = yield* gitText(git, ["symbolic-ref", "--quiet", "--short", "HEAD"], directory)
      const local = head.code === 0 ? head.text : ""
      if (!local) {
        return yield* Effect.fail(failure("branch_detached", "HEAD is detached; check out a branch first", false))
      }

      const status = yield* gitText(git, ["status", "--porcelain"], directory)
      if (status.code !== 0) {
        return yield* Effect.fail(failure("worktree_dirty", "The worktree state could not be read", false))
      }
      if (status.text !== "") {
        return yield* Effect.fail(failure("worktree_dirty", "Commit or stash local changes before continuing", false))
      }

      const upstream = yield* gitText(
        git,
        ["for-each-ref", "--format=%(upstream:remotename)%09%(upstream:remoteref)", `refs/heads/${local}`],
        directory,
      )
      const [remote, ref] = upstream.text.split("\t")
      if (upstream.code !== 0 || !remote || !ref?.startsWith("refs/heads/")) {
        return yield* Effect.fail(failure("branch_no_upstream", "Push this branch with an upstream first", false))
      }
      const branch = ref.slice("refs/heads/".length)

      const remoteUrl = yield* gitText(git, ["remote", "get-url", remote], directory)
      if (remoteUrl.code !== 0 || !remoteUrl.text) {
        return yield* Effect.fail(failure("remote_unsupported", "The remote repository is not supported", false))
      }

      const ls = yield* gitText(git, ["ls-remote", remote, `refs/heads/${branch}`], directory)
      if (ls.code !== 0) {
        return yield* Effect.fail(failure("remote_unsupported", "The remote repository could not be read", false))
      }
      const remoteSha = ls.text.split(/\s+/)[0] ?? ""
      if (!/^[0-9a-f]{40}$/.test(remoteSha)) {
        return yield* Effect.fail(failure("branch_not_pushed", "Push this branch to the remote first", false))
      }

      const present = yield* gitText(git, ["cat-file", "-e", `${remoteSha}^{commit}`], directory)
      if (present.code !== 0) {
        const fetched = yield* gitText(git, ["fetch", "--no-tags", remote, remoteSha], directory)
        if (fetched.code !== 0) {
          return yield* Effect.fail(failure("branch_not_pushed", "The remote branch could not be fetched", false))
        }
      }

      const ancestor = yield* gitText(git, ["merge-base", "--is-ancestor", "HEAD", remoteSha], directory)
      if (ancestor.code !== 0) {
        return yield* Effect.fail(
          failure("branch_not_pushed", "The remote branch does not contain HEAD; push first", false),
        )
      }

      const parsed = yield* Effect.try({
        try: () => CloudRepository.remote({ repo: remoteUrl.text, branch }),
        catch: () => failure("remote_unsupported", "The remote repository is not supported", false),
      })
      if (parsed.type === "git") {
        return yield* Effect.fail(
          failure("remote_unsupported", "Only GitHub and GitLab repositories are supported", false),
        )
      }
      return parsed as Repository
    })

  interface Snapshot {
    readonly id: string
    readonly lastMessageID: string | undefined
    readonly agent: { mode: string; model?: { providerID: string; modelID: string; variant?: string } }
  }

  const snapshot = (
    session: Session.Interface,
    questions: Question.Interface,
    permissions: Permission.Interface,
    input: Input,
  ): Effect.Effect<Snapshot[], HostedFailure> =>
    Effect.gen(function* () {
      const busy = yield* SessionStatus.busyAll()
      const questionIDs = new Set((yield* questions.list()).map((request) => String(request.sessionID)))
      const permissionIDs = new Set((yield* permissions.list()).map((request) => String(request.sessionID)))
      const wanted = path.resolve(input.directory)

      return yield* Effect.forEach(
        input.sessionIDs,
        (id): Effect.Effect<Snapshot, HostedFailure> =>
          Effect.gen(function* () {
            const info = yield* session.get(SessionID.make(id)).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!info || info.parentID !== undefined || path.resolve(info.directory) !== wanted) {
              return yield* Effect.fail(
                failure("session_not_in_worktree", "A selected session is not in this worktree", false),
              )
            }
            const sid = SessionID.make(id)
            if (busy.has(sid) || questionIDs.has(id) || permissionIDs.has(id)) {
              return yield* Effect.fail(
                failure("session_busy", "A selected session is busy or waiting for input", false),
              )
            }
            const last = yield* session
              .findMessage(sid, () => true)
              .pipe(Effect.catch(() => Effect.succeed(Option.none<never>())))
            const user = yield* session
              .findMessage(sid, (message) => message.info.role === "user")
              .pipe(Effect.catch(() => Effect.succeed(Option.none<never>())))
            const lastMessageID = Option.isSome(last) ? String(last.value.info.id) : undefined
            const agent =
              Option.isSome(user) && user.value.info.role === "user"
                ? { mode: user.value.info.agent ?? info.agent ?? "code", model: user.value.info.model }
                : { mode: info.agent ?? "code" }
            return { id, lastMessageID, agent } satisfies Snapshot
          }),
      )
    })

  const publish = (
    events: EventV2.Interface,
    input: Input,
    stage: "checking" | "syncing" | "creating",
  ): Effect.Effect<void> =>
    events
      .publish(SessionHostEvent.Continuation, { operationKey: input.operationKey, directory: input.directory, stage })
      .pipe(Effect.catchCause(() => Effect.void))

  const finish = (result: ProviderContinueWorkspaceResult, webOrigin: string): ContinueWorkspaceResult => ({
    workspace: result.workspace,
    sessions: result.sessions,
    active: result.active,
    url: `${webOrigin}/cloud/sessions/${result.active.sessionID}`,
    replayed: result.replayed,
  })

  interface Stored {
    readonly accountID: string
    readonly operationKey: string
    readonly selectionJSON: string
    readonly cloudOrigin: string
    readonly provider: string
    readonly preparedJSON: string
    readonly now: number
  }

  type Commit = { ok: true; preparedJSON: string } | { ok: false; reason: "mismatch" | "account_switch" }

  /**
   * Durable intent storage. Read, insert, and retention always run inside one
   * `db.transaction`; the exact prepared body is written once and never replaced.
   */
  export function store(db: Database.Interface["db"]) {
    const read = (operationKey: string) =>
      db
        .select()
        .from(ContinuationIntentTable)
        .where(eq(ContinuationIntentTable.operation_key, operationKey))
        .all()
        .pipe(Effect.orDie)

    // Delete up to SWEEP_LIMIT other expired intents, never the current one.
    const sweep = (
      tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
      now: number,
      accountID: string,
      operationKey: string,
    ) =>
      Effect.gen(function* () {
        const expired = yield* tx
          .select({ account: ContinuationIntentTable.account_id, key: ContinuationIntentTable.operation_key })
          .from(ContinuationIntentTable)
          .where(lt(ContinuationIntentTable.expires_at, now))
          .limit(SWEEP_LIMIT)
          .all()
          .pipe(Effect.orDie)
        for (const row of expired) {
          if (row.account === accountID && row.key === operationKey) continue
          yield* tx
            .delete(ContinuationIntentTable)
            .where(
              and(
                eq(ContinuationIntentTable.account_id, row.account),
                eq(ContinuationIntentTable.operation_key, row.key),
              ),
            )
            .run()
            .pipe(Effect.orDie)
        }
      })

    // Expiry is a garbage-collection deadline, not permission to replace a
    // request under the same key. A retained retry renews its immutable body.
    const touch = (input: Omit<Stored, "preparedJSON">) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            const rows = yield* tx
              .select()
              .from(ContinuationIntentTable)
              .where(
                and(
                  eq(ContinuationIntentTable.account_id, input.accountID),
                  eq(ContinuationIntentTable.operation_key, input.operationKey),
                ),
              )
              .all()
              .pipe(Effect.orDie)
            const row = rows.at(0)
            if (!row) return { ok: false as const, reason: "mismatch" as const } satisfies Commit
            yield* tx
              .update(ContinuationIntentTable)
              .set({ expires_at: input.now + RETENTION_MS })
              .where(
                and(
                  eq(ContinuationIntentTable.account_id, input.accountID),
                  eq(ContinuationIntentTable.operation_key, input.operationKey),
                ),
              )
              .run()
              .pipe(Effect.orDie)
            yield* sweep(tx, input.now, input.accountID, input.operationKey)
            return { ok: true as const, preparedJSON: row.prepared_json } satisfies Commit
          }),
        )
        .pipe(Effect.orDie)

    // Fresh prepare: insert the body once. A concurrent winner becomes a retry.
    const insert = (input: Stored) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            const rows = yield* tx
              .select()
              .from(ContinuationIntentTable)
              .where(eq(ContinuationIntentTable.operation_key, input.operationKey))
              .all()
              .pipe(Effect.orDie)
            const own = rows.find((row) => row.account_id === input.accountID)
            if (own) {
              if (
                own.selection_json !== input.selectionJSON ||
                own.cloud_origin !== input.cloudOrigin ||
                own.provider !== input.provider
              ) {
                return { ok: false as const, reason: "mismatch" as const } satisfies Commit
              }
              yield* tx
                .update(ContinuationIntentTable)
                .set({ expires_at: input.now + RETENTION_MS })
                .where(
                  and(
                    eq(ContinuationIntentTable.account_id, input.accountID),
                    eq(ContinuationIntentTable.operation_key, input.operationKey),
                  ),
                )
                .run()
                .pipe(Effect.orDie)
              yield* sweep(tx, input.now, input.accountID, input.operationKey)
              return { ok: true as const, preparedJSON: own.prepared_json } satisfies Commit
            }
            if (rows.length > 0) return { ok: false as const, reason: "account_switch" as const } satisfies Commit
            yield* tx
              .insert(ContinuationIntentTable)
              .values({
                account_id: input.accountID,
                operation_key: input.operationKey,
                selection_json: input.selectionJSON,
                cloud_origin: input.cloudOrigin,
                provider: input.provider,
                prepared_json: input.preparedJSON,
                created_at: input.now,
                expires_at: input.now + RETENTION_MS,
              })
              .onConflictDoNothing()
              .run()
              .pipe(Effect.orDie)
            yield* sweep(tx, input.now, input.accountID, input.operationKey)
            return { ok: true as const, preparedJSON: input.preparedJSON } satisfies Commit
          }),
        )
        .pipe(Effect.orDie)

    return { read, touch, insert }
  }

  export const run = (
    input: Input,
  ): Effect.Effect<
    ContinueWorkspaceResult,
    HostedFailure,
    | Session.Service
    | Question.Service
    | Permission.Service
    | Git.Service
    | Database.Service
    | EventV2Bridge.Service
    | Auth.Service
    | InstanceStore.Service
  > =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const questions = yield* Question.Service
      const permissions = yield* Permission.Service
      const git = yield* Git.Service
      const database = yield* Database.Service
      const events = yield* EventV2Bridge.Service
      const instances = yield* InstanceStore.Service
      const env = input.env ?? process.env
      const timeoutMs = input.timeoutMs ?? SYNC_TIMEOUT_MS
      const intents = store(database.db)

      // The request body carries the worktree directory, but a directory alone
      // does not route instance-scoped state. Bind the InstanceRef explicitly so
      // Question, Permission, SessionStatus, and Session reads all resolve in the
      // requested worktree, never the process's launch instance.
      if (!path.isAbsolute(input.directory)) {
        return yield* Effect.fail(failure("invalid_request", "The worktree directory must be absolute", false))
      }
      const within = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        instances.provide({ directory: input.directory }, effect)
      const snap = () => within(snapshot(session, questions, permissions, input))

      const cloudOrigin = yield* Effect.try({
        try: () => resolveCloudAgentOrigin(env),
        catch: () => failure("rejected", "Kilo Cloud base URL is invalid", false),
      })
      const webOrigin = yield* Effect.try({
        try: () => resolveWebAppOrigin(env),
        catch: () => failure("rejected", "Kilo web app URL is invalid", false),
      })

      // One bearer for the whole operation: it reads the principal, resolves
      // defaults, and carries the dispatch. The principal is rechecked with that
      // same bearer immediately before every Cloud call, so preparation can never
      // dispatch under a different credential than it validated.
      const token = yield* CloudAuth.token(env).pipe(
        Effect.catchTag("CloudAuthResolutionError", (error) =>
          Effect.fail(
            error.kind === "missing"
              ? failure("signed_out", error.message, false)
              : failure("auth_unavailable", "Kilo credentials could not be read", true),
          ),
        ),
      )
      const principal = () => ProfileIdentity.read(env, token).pipe(Effect.mapError(identityFailure))
      const accountID = yield* principal()
      const recheck = () =>
        Effect.gen(function* () {
          const current = yield* principal()
          if (current !== accountID) {
            return yield* Effect.fail(
              failure("invalid_request", "The signed-in account changed during preparation", false),
            )
          }
        })

      const selectionJSON = JSON.stringify({
        directory: input.directory,
        sessionIDs: [...input.sessionIDs],
        activeSessionID: input.activeSessionID,
      })

      const rows = yield* intents.read(input.operationKey)
      const own = rows.find((row) => row.account_id === accountID)
      if (!own && rows.length > 0) {
        return yield* Effect.fail(
          failure("invalid_request", "This operation key belongs to a different account", false),
        )
      }

      if (own) {
        if (own.selection_json !== selectionJSON || own.cloud_origin !== cloudOrigin || own.provider !== PROVIDER) {
          return yield* Effect.fail(
            failure("invalid_request", "This operation key was used for a different request", false),
          )
        }
        const touched = yield* intents.touch({
          accountID,
          operationKey: input.operationKey,
          selectionJSON,
          cloudOrigin,
          provider: PROVIDER,
          now: Date.now(),
        })
        if (!touched.ok) {
          return yield* Effect.fail(
            failure("invalid_request", "This operation key was used for a different request", false),
          )
        }
        yield* publish(events, input, "creating")
        // Recheck the principal with the dispatch bearer before the reused body
        // leaves the machine.
        yield* recheck()
        const prepared = JSON.parse(touched.preparedJSON) as ProviderContinueWorkspaceInput
        const result = yield* input.provider.continueWorkspace(prepared, { token })
        return finish(result, webOrigin)
      }

      yield* publish(events, input, "checking")
      const repository = yield* checkWorktree(git, input.directory)
      const before = yield* snap()

      const orgs = new Map<string, string | undefined>()
      for (const entry of before) {
        if (orgs.has(entry.id)) continue
        orgs.set(entry.id, yield* Effect.promise(() => KiloSessions.organizationForSession(entry.id)))
      }
      const defaults = new Map<string, string>()
      for (const entry of before) {
        const model = entry.agent.model
        if (model?.providerID === "kilo") continue
        const org = orgs.get(entry.id)
        const key = org ?? ""
        if (defaults.has(key)) continue
        const resolved = yield* Effect.promise(() => fetchDefaultModel(Redacted.value(token), org))
        if (resolved) defaults.set(key, resolved)
      }

      const sessions = before.map((entry) => {
        const model = entry.agent.model
        if (model?.providerID === "kilo") {
          const agent: ContinuationAgent = {
            mode: entry.agent.mode,
            model: model.modelID,
            ...(model.variant === undefined ? {} : { variant: model.variant }),
          }
          return { sourceKiloSessionId: entry.id, agent }
        }
        const agent: ContinuationAgent = { mode: entry.agent.mode, model: defaults.get(orgs.get(entry.id) ?? "") ?? "" }
        return { sourceKiloSessionId: entry.id, agent }
      })

      const prepared: ProviderContinueWorkspaceInput = {
        operationKey: input.operationKey,
        clientProvenance: "agent-manager",
        repository,
        activeSourceKiloSessionId: input.activeSessionID,
        sessions,
      }
      // Validate the exact Cloud body before any durable insert (and before the
      // sync, so a bad mode or variant fails fast). An invalid mode or variant
      // must fail here, before a row can poison the stored intent.
      const validated = Schema.decodeUnknownOption(ProviderContinueWorkspaceInput)(prepared)
      if (Option.isNone(validated)) {
        return yield* Effect.fail(failure("invalid_request", "The continuation request is not valid", false))
      }
      const body = JSON.stringify(validated.value)

      yield* publish(events, input, "syncing")
      // The acknowledged sync crosses an Effect → Promise → AppRuntime boundary.
      // Once the request fiber is gone there is no InstanceRef to attach and a
      // `serve` process has no ambient instance, so the nested Session/Storage
      // reads die. Capture the InstanceContext that InstanceStore already
      // resolved for this worktree and re-establish it (the same legacy context
      // bridge `attach` reads) for the whole promise chain.
      const ctx = yield* instances.load({ directory: input.directory })
      const sync = yield* Effect.tryPromise({
        try: () =>
          instanceContext.provide(ctx, () => KiloSessions.syncForContinuation([...input.sessionIDs], { timeoutMs })),
        catch: () => failure("sync_failed", "Session sync failed", true),
      })
      if (!sync.ok) {
        return yield* Effect.fail(
          sync.reason === "failed"
            ? failure("sync_failed", "Sessions did not finish syncing in time", true)
            : failure("sync_unavailable", "Session sync is unavailable for one or more sessions", false),
        )
      }

      const after = yield* snap()
      for (const [index, entry] of before.entries()) {
        const next = after.at(index)
        if (!next || next.lastMessageID !== entry.lastMessageID) {
          return yield* Effect.fail(failure("session_changed", "A session changed during preparation; retry", true))
        }
      }

      const committed = yield* intents.insert({
        accountID,
        operationKey: input.operationKey,
        selectionJSON,
        cloudOrigin,
        provider: PROVIDER,
        preparedJSON: body,
        now: Date.now(),
      })
      if (!committed.ok) {
        return yield* Effect.fail(
          failure(
            "invalid_request",
            committed.reason === "account_switch"
              ? "This operation key belongs to a different account"
              : "This operation key was used for a different request",
            false,
          ),
        )
      }
      yield* publish(events, input, "creating")
      // The principal is rechecked with the dispatch bearer immediately before
      // the stored body is dispatched.
      yield* recheck()
      const result = yield* input.provider.continueWorkspace(
        JSON.parse(committed.preparedJSON) as ProviderContinueWorkspaceInput,
        { token },
      )
      return finish(result, webOrigin)
    })
}
