import { createHash, randomBytes, randomUUID } from "node:crypto"
import { constants, type Stats } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { NamedError } from "@opencode-ai/core/util/error"
import { and, eq } from "drizzle-orm"
import { Effect, Redacted, Schema } from "effect"
import z from "zod"
import { RemoteProtocol } from "../../kilo-sessions/remote-protocol"
import type { Tool } from "../../tool/tool"

export namespace BrowserOwner {
  const retention = 7 * 24 * 60 * 60 * 1000
  const skew = 5 * 60 * 1000
  const parent = z
    .string()
    .max(128)
    .regex(/^ses_[A-Za-z0-9_-]+$/)
  const digest = z.string().regex(/^[a-f0-9]{64}$/)
  const binding = { version: z.literal(1), parentSessionId: parent }
  const Credential = z.strictObject({ ...binding, parentProof: digest })
  const Approval = z.strictObject({ ...binding, providerId: RemoteProtocol.BrowserProviderId })
  const Intent = z.strictObject({
    ...binding,
    invocationId: RemoteProtocol.BrowserInvocationId,
    providerId: RemoteProtocol.BrowserProviderId,
    browserTaskId: RemoteProtocol.BrowserTaskId.optional(),
    payloadFingerprint: digest,
  })
  const Job = RemoteProtocol.BrowserJobHandle.extend(binding)
  const Run = z.strictObject({
    providerId: RemoteProtocol.BrowserProviderId,
    browserTaskId: RemoteProtocol.BrowserTaskId.optional(),
    goal: z
      .string()
      .min(1)
      .max(RemoteProtocol.BROWSER_GOAL_MAX_BYTES)
      .refine((value) => Buffer.byteLength(value) <= RemoteProtocol.BROWSER_GOAL_MAX_BYTES),
  })
  const messages = {
    invalid_context: "Browser tasks require a trusted parent, message, call, and creation time.",
    invocation_expired: "The browser invocation has expired.",
    invocation_conflict: "The browser invocation already has different saved data.",
    owner_mismatch: "The parent does not own this browser record.",
    not_found: "This parent has no matching browser job.",
    permission_denied: "The parent has not approved this browser provider.",
    invalid_record: "The private browser record is invalid. It was not replaced.",
    unsafe_storage: "The private browser storage has unsafe permissions or file types.",
    unsupported: "The filesystem does not support atomic browser ownership publication.",
    storage_unavailable: "The private browser storage is unavailable. Retry after restoring access.",
  }
  export const Error = NamedError.create("BrowserOwnerError", {
    code: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  })

  function failure(code: keyof typeof messages) {
    return new Error({ code, message: messages[code], retryable: code === "storage_unavailable" })
  }

  function redact(err: unknown) {
    return err instanceof Error ? err : failure("storage_unavailable")
  }

  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw failure("invalid_record")
    return parsed.data
  }

  // UTF-8 byte lengths make the framing unambiguous, including Unicode call IDs.
  function hash(values: string[]) {
    return createHash("sha256")
      .update(values.map((value) => `${Buffer.byteLength(value)}:${value}`).join(""))
      .digest("hex")
  }

  function expiry(id: string) {
    parse(RemoteProtocol.BrowserInvocationId, id)
    const created = Number(id.split(".").at(1))
    const now = Date.now()
    if (!Number.isSafeInteger(now) || now <= 0 || created > now + skew) throw failure("invalid_context")
    return created + retention
  }

  function active(id: string) {
    if (expiry(id) <= Date.now()) throw failure("invocation_expired")
  }

  function secure(stat: Stats, directory = false) {
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw failure("unsafe_storage")
    // Windows inherits the private user-profile ACL. Unix mode bits do not describe that ACL.
    if (process.platform === "win32") return
    if ((stat.mode & 0o7777) !== (directory ? 0o700 : 0o600) || (process.getuid && stat.uid !== process.getuid())) {
      throw failure("unsafe_storage")
    }
  }

  async function sync(dir: string) {
    if (process.platform === "win32") return
    const handle = await fs.open(dir, "r")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async function directory(dir: string) {
    await fs.mkdir(dir, { mode: 0o700 }).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "EEXIST") throw err
    })
    secure(await fs.lstat(dir), true)
    // EEXIST can precede another creator's sync, so every caller must sync the parent.
    await sync(path.dirname(dir))
  }

  async function read<T extends { parentSessionId: string }>(file: string, schema: z.ZodType<T>, session: string) {
    const stat = await fs.lstat(file).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined
      throw err
    })
    if (!stat) return undefined
    secure(stat)
    const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0))
    const handle = await fs.open(file, flags)
    try {
      const opened = await handle.stat()
      secure(opened)
      if (stat.dev !== opened.dev || stat.ino !== opened.ino) throw failure("unsafe_storage")
      if (opened.size >= RemoteProtocol.BROWSER_FRAME_MAX_BYTES) throw failure("invalid_record")
      const text = await handle.readFile("utf8")
      const value = parse(
        schema,
        await Promise.resolve()
          .then(() => JSON.parse(text))
          .catch(() => {
            throw failure("invalid_record")
          }),
      )
      if (value.parentSessionId !== session) throw failure("owner_mismatch")
      // A visible link can precede its creator's sync or survive a failed one.
      await sync(path.dirname(file))
      return value
    } finally {
      await handle.close()
    }
  }

  async function publish<T extends { parentSessionId: string }>(file: string, schema: z.ZodType<T>, value: T) {
    const existing = await read(file, schema, value.parentSessionId)
    if (existing) return existing
    const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`)
    // Open outside the cleanup block: an EEXIST temporary file belongs to someone else.
    const handle = await fs.open(temp, "wx", 0o600)
    try {
      try {
        secure(await handle.stat())
        await handle.writeFile(JSON.stringify(value), "utf8")
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.link(temp, file).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "EEXIST") return
        if (["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EPERM"].includes(err.code ?? "")) {
          throw failure("unsupported")
        }
        throw err
      })
      const winner = await read(file, schema, value.parentSessionId)
      if (!winner) throw failure("invalid_record")
      return winner
    } finally {
      await fs.unlink(temp).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err
      })
    }
  }

  function handle(job: z.infer<typeof Job>): RemoteProtocol.BrowserJobHandle {
    return {
      providerId: job.providerId,
      browserTaskId: job.browserTaskId,
      jobId: job.jobId,
      invocationId: job.invocationId,
    }
  }

  function matches(intent: z.infer<typeof Intent>, job: RemoteProtocol.BrowserJobHandle) {
    if (
      intent.invocationId !== job.invocationId ||
      intent.providerId !== job.providerId ||
      (intent.browserTaskId !== undefined && intent.browserTaskId !== job.browserTaskId)
    ) {
      throw failure("owner_mismatch")
    }
  }

  /** Only Tool.Context establishes authority. Model input, copied metadata, and transcripts cannot supply it. */
  export const open = Effect.fnUntraced(function* (ctx: Tool.Context) {
    if (
      !parent.safeParse(ctx.sessionID).success ||
      typeof ctx.messageID !== "string" ||
      !ctx.messageID.startsWith("msg_") ||
      typeof ctx.callID !== "string" ||
      !ctx.callID.trim()
    ) {
      return yield* Effect.fail(failure("invalid_context"))
    }
    const session = ctx.sessionID
    const message = ctx.messageID
    const call = ctx.callID
    const db = yield* Database.Service
    const row = yield* db.db
      .select({ created: MessageTable.time_created })
      .from(MessageTable)
      .where(and(eq(MessageTable.session_id, session), eq(MessageTable.id, message)))
      .get()
      .pipe(Effect.mapError(() => failure("storage_unavailable")))
    if (!row || !Number.isSafeInteger(row.created) || row.created <= 0 || row.created > 8_640_000_000_000_000) {
      return yield* Effect.fail(failure("invalid_context"))
    }
    const invocationId = `b1.${row.created}.${hash([session, message, call])}`
    return yield* Effect.tryPromise({
      try: async () => {
        active(invocationId)
        const root = path.join(Global.Path.data, "browser-owner")
        const folder = path.join(root, session)
        const base = await fs.lstat(Global.Path.data)
        if (!base.isDirectory() || base.isSymbolicLink()) throw failure("unsafe_storage")
        await directory(root)
        await directory(folder)
        const entries = await fs.readdir(folder)
        const file = path.join(folder, "owner.json")
        const existing = await read(file, Credential, session)
        if (!existing && entries.some((name) => name !== "owner.json" && !name.startsWith("."))) {
          throw failure("invalid_record")
        }
        const credential =
          existing ??
          (await publish(file, Credential, {
            version: 1,
            parentSessionId: session,
            parentProof: randomBytes(32).toString("hex"),
          }))
        const proof = Redacted.make(credential.parentProof)
        const saved = <T extends { parentSessionId: string }>(name: string, schema: z.ZodType<T>) =>
          read(path.join(folder, name), schema, session)
        const store = <T extends { parentSessionId: string }>(name: string, schema: z.ZodType<T>, value: T) =>
          publish(path.join(folder, name), schema, value)
        const run = async <T>(fn: () => Promise<T>) => {
          try {
            secure(await fs.lstat(root), true)
            secure(await fs.lstat(folder), true)
            const current = await saved("owner.json", Credential)
            if (!current || current.parentProof !== Redacted.value(proof)) throw failure("owner_mismatch")
            return await fn()
          } catch (err) {
            throw redact(err)
          }
        }
        const records = async () => {
          const result = []
          for (const name of await fs.readdir(folder)) {
            if (!name.startsWith("intent-") || !name.endsWith(".json")) continue
            const intent = await saved(name, Intent)
            if (!intent || name !== `intent-${intent.invocationId}.json`) throw failure("invalid_record")
            const job = await saved(`job-${intent.invocationId}.json`, Job)
            if (job) matches(intent, job)
            result.push({ ...intent, handle: job ? handle(job) : undefined })
          }
          return result
        }
        const lookup = async (task: string, job?: string) => {
          parse(RemoteProtocol.BrowserTaskId, task)
          if (job !== undefined) parse(RemoteProtocol.BrowserJobId, job)
          const found = (await records()).filter(
            (record) => record.handle?.browserTaskId === task && (job === undefined || record.handle.jobId === job),
          )
          if (!found.length) throw failure("not_found")
          const current = found.filter((record) => expiry(record.invocationId) > Date.now())
          const first = current.at(0)
          if (!first) throw failure("invocation_expired")
          if (current.some((record) => record.providerId !== first.providerId)) throw failure("owner_mismatch")
          // Leave latest-job selection to the relay when the caller supplies no job ID.
          return { providerId: first.providerId, browserTaskId: task, jobId: job }
        }
        return {
          parentSessionId: session,
          invocationId,
          // Unwrap only at the authenticated request boundary, never in tool arguments or output.
          proof,
          approve: (provider: string) =>
            run(async () => {
              const id = parse(RemoteProtocol.BrowserProviderId, provider)
              const approval = await store(`approval-${id}.json`, Approval, {
                version: 1,
                parentSessionId: session,
                providerId: id,
              })
              if (approval.providerId !== id) throw failure("owner_mismatch")
            }),
          approved: (provider: string) =>
            run(async () => {
              parse(RemoteProtocol.BrowserProviderId, provider)
              const approval = await saved(`approval-${provider}.json`, Approval)
              if (approval && approval.providerId !== provider) throw failure("owner_mismatch")
              return approval !== undefined
            }),
          prepare: (input: z.infer<typeof Run>) =>
            run(async () => {
              const value = parse(Run, input)
              active(invocationId)
              const approval = await saved(`approval-${value.providerId}.json`, Approval)
              if (!approval) throw failure("permission_denied")
              if (approval.providerId !== value.providerId) throw failure("owner_mismatch")
              if (value.browserTaskId && (await lookup(value.browserTaskId)).providerId !== value.providerId) {
                throw failure("owner_mismatch")
              }
              const intent = {
                version: 1 as const,
                parentSessionId: session,
                invocationId,
                providerId: value.providerId,
                browserTaskId: value.browserTaskId,
                payloadFingerprint: hash([session, value.providerId, value.browserTaskId ?? "", value.goal]),
              }
              const winner = await store(`intent-${invocationId}.json`, Intent, intent)
              if (JSON.stringify(winner) !== JSON.stringify(intent)) throw failure("invocation_conflict")
              return winner
            }),
          remember: (input: RemoteProtocol.BrowserJobHandle) =>
            run(async () => {
              const value = parse(RemoteProtocol.BrowserJobHandle, input)
              active(value.invocationId)
              const intent = await saved(`intent-${value.invocationId}.json`, Intent)
              if (!intent) throw failure("not_found")
              matches(intent, value)
              const winner = await store(`job-${value.invocationId}.json`, Job, {
                ...value,
                version: 1,
                parentSessionId: session,
              })
              if (JSON.stringify(handle(winner)) !== JSON.stringify(value)) throw failure("invocation_conflict")
              // Keep intents immutable. The durable handle marks an intent as resolved.
              return handle(winner)
            }),
          lookup: (task: string, job?: string) => run(() => lookup(task, job)),
          recover: () =>
            run(async () => (await records()).filter((record) => expiry(record.invocationId) > Date.now())),
        }
      },
      catch: redact,
    })
  })
}
