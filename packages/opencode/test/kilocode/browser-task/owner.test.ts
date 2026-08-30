import { afterEach, describe, expect, mock, spyOn } from "bun:test"
import { rejects } from "node:assert/strict"
import * as crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { inspect } from "node:util"
import { eq, sql } from "drizzle-orm"
import { Effect, Fiber, Layer, Redacted } from "effect"
import z from "zod"
import { BrowserOwner } from "../../../src/kilocode/browser-task/owner"
import { RemoteProtocol } from "../../../src/kilo-sessions/remote-protocol"
import { MessageID, SessionID } from "../../../src/session/schema"
import { Session } from "../../../src/session/session"
import type { Tool } from "../../../src/tool/tool"
import { seedProject, tmpdir } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

function denied(promise: Promise<unknown>, code: string) {
  return rejects(promise, (err: unknown) => err instanceof BrowserOwner.Error && err.data.code === code)
}

const it = testEffect(Database.layerFromPath(":memory:"))
const unix = process.platform === "win32" ? it.live.skip : it.live
const windows = process.platform === "win32" ? it.live : it.live.skip
const provider = "bp_00000000-0000-4000-8000-000000000001"
const other = "bp_00000000-0000-4000-8000-000000000002"
const task = "bt_00000000-0000-4000-8000-000000000003"
const job = "bj_00000000-0000-4000-8000-000000000004"
const week = 604_800_000

const folder = (ctx: Tool.Context) => path.join(Global.Path.data, "browser-owner", ctx.sessionID)
const credential = (ctx: Tool.Context) => path.join(folder(ctx), "owner.json")
const handle = (invocationId: string): RemoteProtocol.BrowserJobHandle => ({
  providerId: provider,
  browserTaskId: task,
  jobId: job,
  invocationId,
})

function seed(input: { created?: number; sessionID?: SessionID; messageID?: MessageID; callID?: string } = {}) {
  return Effect.gen(function* () {
    const db = yield* Database.Service
    const ctx: Tool.Context = {
      sessionID: input.sessionID ?? SessionID.make(`ses_${crypto.randomUUID()}`),
      messageID: input.messageID ?? MessageID.ascending(),
      callID: input.callID ?? crypto.randomUUID(),
      agent: "test",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => Effect.void,
      ask: () => Effect.void,
    }
    const project = ProjectV2.ID.make("a".repeat(40))
    yield* db.db
      .insert(ProjectTable)
      .values({
        id: project,
        worktree: AbsolutePath.make(Global.Path.data),
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run()
    yield* db.db
      .insert(SessionTable)
      .values({
        id: ctx.sessionID,
        project_id: project,
        slug: "browser-owner",
        directory: AbsolutePath.make(Global.Path.data),
        title: "Browser owner test",
        version: "test",
        metadata: { copied: "nonsecret metadata" },
      })
      .onConflictDoNothing()
      .run()
    const data = {
      role: "assistant" as const,
      time: { created: Date.now() },
      parentID: SessionV1.MessageID.make("msg_parent"),
      providerID: "test",
      modelID: "test",
      mode: "test",
      agent: "test",
      path: { cwd: Global.Path.data, root: Global.Path.data },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    yield* db.db
      .insert(MessageTable)
      .values({
        id: SessionV1.MessageID.make(ctx.messageID),
        session_id: ctx.sessionID,
        time_created: input.created ?? Date.now(),
        data,
      })
      .run()
    return ctx
  })
}

afterEach(() => mock.restore())

describe("BrowserOwner invocation identity", () => {
  it.live("uses the immutable column after JSON time and the clock change", () =>
    Effect.gen(function* () {
      const clock = spyOn(Date, "now").mockReturnValue(1_787_875_200_000)
      const ctx = yield* seed()
      const first = yield* BrowserOwner.open(ctx)
      const db = yield* Database.Service
      const row = yield* db.db.select().from(MessageTable).where(eq(MessageTable.id, ctx.messageID)).get()
      if (!row) throw new Error("Missing fixture message")
      clock.mockReturnValue(1_787_875_260_000)
      yield* db.db
        .update(MessageTable)
        .set({
          data: { ...row.data, time: { created: Date.now() } },
          time_updated: Date.now(),
        })
        .where(eq(MessageTable.id, ctx.messageID))
        .run()
      const later = yield* BrowserOwner.open(ctx)
      clock.mockReturnValue(1_787_875_140_000)
      const earlier = yield* BrowserOwner.open(ctx)
      expect(later.invocationId).toBe(first.invocationId)
      expect(earlier.invocationId).toBe(first.invocationId)
      expect(first.invocationId.split(".").at(1)).toBe("1787875200000")
      expect(Redacted.value(later.proof)).toBe(Redacted.value(first.proof))
    }),
  )

  it.live("separates calls and length-delimited message identities", () =>
    Effect.gen(function* () {
      const created = Date.now()
      const ctx = yield* seed({ created, messageID: MessageID.make("msg_foo"), callID: "bar" })
      const adjacent = yield* seed({
        created,
        sessionID: ctx.sessionID,
        messageID: MessageID.make("msg_foob"),
        callID: "ar",
      })
      const first = yield* BrowserOwner.open(ctx)
      const second = yield* BrowserOwner.open(adjacent)
      const third = yield* BrowserOwner.open({ ...ctx, callID: "bár" })
      expect(new Set([first.invocationId, second.invocationId, third.invocationId]).size).toBe(3)
      expect(Redacted.value(first.proof)).toBe(Redacted.value(second.proof))
    }),
  )

  for (const callID of [undefined, "", "   "]) {
    it.live(`rejects ${JSON.stringify(callID)} call identity before creating storage`, () =>
      Effect.gen(function* () {
        const ctx = yield* seed()
        const err = yield* BrowserOwner.open({ ...ctx, callID }).pipe(Effect.flip)
        expect(err.data.code).toBe("invalid_context")
        yield* Effect.promise(() => rejects(fs.lstat(folder(ctx)), { code: "ENOENT" }))
      }),
    )
  }

  it.live("rejects missing messages and another parent's message", () =>
    Effect.gen(function* () {
      const source = yield* seed()
      const foreign = yield* seed()
      for (const ctx of [
        { ...source, messageID: MessageID.make("msg_missing") },
        { ...source, sessionID: foreign.sessionID },
      ]) {
        const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
        expect(err.data.code).toBe("invalid_context")
        yield* Effect.promise(() => rejects(fs.lstat(folder(ctx)), { code: "ENOENT" }))
      }
    }),
  )

  for (const created of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 8_640_000_000_000_001]) {
    it.live(`rejects malformed creation time ${created}`, () =>
      Effect.gen(function* () {
        const ctx = yield* seed({ created })
        const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
        expect(err.data.code).toBe("invalid_context")
        yield* Effect.promise(() => rejects(fs.lstat(folder(ctx)), { code: "ENOENT" }))
      }),
    )
  }

  it.live("rejects a nonnumeric database timestamp without trusting JSON time", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const db = yield* Database.Service
      yield* db.db
        .update(MessageTable)
        .set({ time_created: sql`'not-a-time'` })
        .where(eq(MessageTable.id, ctx.messageID))
        .run()
      const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
      expect(err.data.code).toBe("invalid_context")
    }),
  )

  for (const [age, code] of [
    [week, "invocation_expired"],
    [week + 1, "invocation_expired"],
    [-300_001, "invalid_context"],
  ] as const) {
    it.live(`rejects creation age ${age} without renewing it`, () =>
      Effect.gen(function* () {
        spyOn(Date, "now").mockReturnValue(1_787_875_200_000)
        const ctx = yield* seed({ created: Date.now() - age })
        const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
        expect(err.data.code).toBe(code)
        expect(err.data.retryable).toBe(false)
        yield* Effect.promise(() => rejects(fs.lstat(folder(ctx)), { code: "ENOENT" }))
      }),
    )
  }

  it.live("accepts the final retained millisecond and the exact future-skew boundary", () =>
    Effect.gen(function* () {
      spyOn(Date, "now").mockReturnValue(1_787_875_200_000)
      for (const age of [week - 1, -300_000]) {
        const ctx = yield* seed({ created: Date.now() - age })
        const owner = yield* BrowserOwner.open(ctx)
        expect(Number(owner.invocationId.split(".").at(1))).toBe(Date.now() - age)
        expect(Redacted.value(owner.proof)).toHaveLength(64)
      }
    }),
  )

  it.live("matches the canonical length-delimited invocation vector", () =>
    Effect.gen(function* () {
      spyOn(Date, "now").mockReturnValue(1_787_875_200_000)
      const ctx = yield* seed({
        sessionID: SessionID.make("ses_parent"),
        messageID: MessageID.make("msg_parent"),
        callID: "call_test",
      })
      const owner = yield* BrowserOwner.open(ctx)
      expect(owner.invocationId).toBe(
        "b1.1787875200000.cd1826dc43bbbeaa4651c758014c1bb103a29307738c1715a8ff7311faef9b3a",
      )
    }),
  )
})

describe("BrowserOwner directory durability", () => {
  const isolate = Effect.gen(function* () {
    const original = Global.Path.data
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(async () => {
          Global.Path.data = original
          await tmp[Symbol.asyncDispose]()
        }),
    )
    Global.Path.data = tmp.path
  })

  for (const target of ["root", "parent"] as const) {
    unix(`waits for the ${target} entry sync before publication, including concurrent EEXIST`, () =>
      Effect.gen(function* () {
        yield* isolate
        const ctx = yield* seed()
        const dir = target === "root" ? Global.Path.data : path.dirname(folder(ctx))
        const next = target === "root" ? folder(ctx) : credential(ctx)
        const first = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }
        const second = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }
        const pending = [first, second]
        const open = fs.open
        spyOn(fs, "open").mockImplementation(async (...args) => {
          const file = await open(...args)
          if (String(args.at(0)) !== dir) return file
          const sync = file.sync.bind(file)
          spyOn(file, "sync").mockImplementation(async () => {
            const gate = pending.shift()
            if (!gate) throw new Error("Unexpected parent sync")
            gate.entered.resolve()
            await gate.release.promise
            await sync()
          })
          return file
        })
        const creator = yield* BrowserOwner.open(ctx).pipe(Effect.forkChild)
        try {
          expect(
            yield* Effect.raceFirst(
              Effect.promise(() => first.entered.promise).pipe(Effect.as("blocked")),
              Fiber.await(creator).pipe(Effect.as("returned")),
            ),
          ).toBe("blocked")
          yield* Effect.promise(() => rejects(fs.lstat(next), { code: "ENOENT" }))
          const contender = yield* BrowserOwner.open(ctx).pipe(Effect.forkChild)
          try {
            expect(
              yield* Effect.raceFirst(
                Effect.promise(() => second.entered.promise).pipe(Effect.as("blocked")),
                Fiber.await(contender).pipe(Effect.as("returned")),
              ),
            ).toBe("blocked")
            yield* Effect.promise(() => rejects(fs.lstat(next), { code: "ENOENT" }))
            second.release.resolve()
            const winner = yield* Fiber.join(contender)
            expect(creator.pollUnsafe()).toBeUndefined()
            const stored = yield* Effect.promise(() => fs.readFile(credential(ctx), "utf8"))
            expect(JSON.parse(stored).parentProof).toBe(Redacted.value(winner.proof))
            first.release.resolve()
            const owner = yield* Fiber.join(creator)
            expect(Redacted.value(owner.proof)).toBe(Redacted.value(winner.proof))
          } finally {
            second.release.resolve()
            yield* Fiber.await(contender)
          }
        } finally {
          first.release.resolve()
          yield* Fiber.await(creator)
        }
      }),
    )

    unix(`fails closed when the ${target} entry sync fails, then retries existing directories`, () =>
      Effect.gen(function* () {
        yield* isolate
        const ctx = yield* seed()
        const dir = target === "root" ? Global.Path.data : path.dirname(folder(ctx))
        const open = fs.open
        const opening = spyOn(fs, "open").mockImplementation(async (...args) => {
          const file = await open(...args)
          if (String(args.at(0)) === dir) {
            spyOn(file, "sync").mockRejectedValueOnce(new Error("private directory sync failure"))
          }
          return file
        })
        for (let attempt = 0; attempt < 2; attempt++) {
          const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
          expect(err.data.code).toBe("storage_unavailable")
          expect(err.data.retryable).toBe(true)
          expect(String(err)).not.toContain("private directory sync failure")
          yield* Effect.promise(() => rejects(fs.lstat(credential(ctx)), { code: "ENOENT" }))
        }
        opening.mockRestore()
        const owner = yield* BrowserOwner.open(ctx)
        const stored = yield* Effect.promise(() => fs.readFile(credential(ctx), "utf8"))
        expect(JSON.parse(stored).parentProof).toBe(Redacted.value(owner.proof))
        expect(yield* Effect.promise(() => fs.readdir(folder(ctx)))).toEqual(["owner.json"])
      }),
    )
  }
})

describe("BrowserOwner record durability", () => {
  function publication(kind: "credential" | "intent" | "handle") {
    return Effect.gen(function* () {
      const ctx = yield* seed()
      if (kind === "credential") {
        return {
          ctx,
          file: credential(ctx),
          publish: BrowserOwner.open(ctx).pipe(
            Effect.map((owner) => JSON.stringify({ parentProof: Redacted.value(owner.proof) })),
          ),
          recover: undefined,
        }
      }
      const owner = yield* BrowserOwner.open(ctx)
      const input = { providerId: provider, goal: "Persist before dispatch" } as const
      yield* Effect.promise(() => owner.approve(provider))
      if (kind === "handle") yield* Effect.promise(() => owner.prepare(input))
      return {
        ctx,
        file: path.join(folder(ctx), `${kind === "intent" ? "intent" : "job"}-${owner.invocationId}.json`),
        publish: Effect.tryPromise({
          try: async () =>
            JSON.stringify(
              await (kind === "intent" ? owner.prepare(input) : owner.remember(handle(owner.invocationId))),
            ),
          catch: (err) => err,
        }),
        recover: Effect.tryPromise({ try: () => owner.recover(), catch: (err) => err }),
      }
    })
  }

  for (const kind of ["credential", "intent", "handle"] as const) {
    for (const mode of ["existing", "EEXIST"] as const) {
      unix(`waits for each ${kind} sync on ${mode}, even when one caller fails`, () =>
        Effect.gen(function* () {
          const entry = yield* publication(kind)
          const first = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }
          const second = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }
          const pending = [first, second]
          const ready = Promise.withResolvers<void>()
          let attempts = 0
          let linked = false
          const link = fs.link
          spyOn(fs, "link").mockImplementation(async (source, target) => {
            if (String(target) !== entry.file) return link(source, target)
            if (mode === "EEXIST") {
              if (++attempts === 2) ready.resolve()
              await ready.promise
            }
            linked = true
            return link(source, target)
          })
          const open = fs.open
          spyOn(fs, "open").mockImplementation(async (...args) => {
            const file = await open(...args)
            if (String(args.at(0)) !== folder(entry.ctx)) return file
            const sync = file.sync.bind(file)
            spyOn(file, "sync").mockImplementation(async () => {
              if (!linked) return sync()
              const gate = pending.shift()
              if (!gate) return sync()
              gate.entered.resolve()
              await gate.release.promise
              await sync()
            })
            return file
          })
          const creator = yield* entry.publish.pipe(Effect.forkChild)
          const contender = yield* Effect.gen(function* () {
            if (mode === "existing") yield* Effect.promise(() => first.entered.promise)
            return yield* entry.publish
          }).pipe(Effect.forkChild)
          try {
            for (const [gate, fiber] of [
              [first, creator],
              [second, contender],
            ] as const) {
              expect(
                yield* Effect.raceFirst(
                  Effect.promise(() => gate.entered.promise).pipe(Effect.as("blocked")),
                  Fiber.await(fiber).pipe(Effect.as("returned")),
                ),
              ).toBe("blocked")
            }
            expect(creator.pollUnsafe()).toBeUndefined()
            expect(contender.pollUnsafe()).toBeUndefined()
            first.release.reject(new Error("private record sync failure"))
            const err = yield* Effect.raceFirst(
              Fiber.join(creator).pipe(Effect.flip),
              Fiber.join(contender).pipe(Effect.flip),
            )
            expect(err).toMatchObject({ data: { code: "storage_unavailable", retryable: true } })
            expect(JSON.stringify(err)).not.toContain("private record sync failure")
            expect([creator, contender].filter((fiber) => fiber.pollUnsafe() === undefined)).toHaveLength(1)
            const waiting = creator.pollUnsafe() === undefined ? creator : contender
            const text = yield* Effect.promise(() => fs.readFile(entry.file, "utf8"))
            second.release.resolve()
            const winner = yield* Fiber.join(waiting)
            expect(JSON.parse(text)).toMatchObject(JSON.parse(winner))
            expect(yield* entry.publish).toBe(winner)
            expect(yield* Effect.promise(() => fs.readFile(entry.file, "utf8"))).toBe(text)
          } finally {
            ready.resolve()
            first.release.resolve()
            second.release.resolve()
            yield* Fiber.await(creator)
            yield* Fiber.await(contender)
          }
        }),
      )
    }

    unix(`rejects ${kind} retries and recovery until the failed sync succeeds`, () =>
      Effect.gen(function* () {
        const entry = yield* publication(kind)
        let linked = false
        const link = fs.link
        spyOn(fs, "link").mockImplementation(async (source, target) => {
          if (String(target) === entry.file) linked = true
          return link(source, target)
        })
        const open = fs.open
        const opening = spyOn(fs, "open").mockImplementation(async (...args) => {
          const file = await open(...args)
          if (linked && String(args.at(0)) === folder(entry.ctx)) {
            spyOn(file, "sync").mockRejectedValueOnce(new Error("private record sync failure"))
          }
          return file
        })
        const err = yield* entry.publish.pipe(Effect.flip)
        expect(err).toMatchObject({ data: { code: "storage_unavailable", retryable: true } })
        expect(JSON.stringify(err)).not.toContain("private record sync failure")
        const text = yield* Effect.promise(() => fs.readFile(entry.file, "utf8"))
        const retry = yield* entry.publish.pipe(Effect.flip)
        expect(retry).toMatchObject({ data: { code: "storage_unavailable", retryable: true } })
        if (entry.recover) {
          expect(yield* entry.recover.pipe(Effect.flip)).toMatchObject({
            data: { code: "storage_unavailable", retryable: true },
          })
        }
        expect(yield* Effect.promise(() => fs.readFile(entry.file, "utf8"))).toBe(text)
        opening.mockRestore()
        const result = yield* entry.publish
        expect(JSON.parse(text)).toMatchObject(JSON.parse(result))
        expect(yield* Effect.promise(() => fs.readFile(entry.file, "utf8"))).toBe(text)
        if (entry.recover) {
          const records = yield* entry.recover
          expect(records).toHaveLength(1)
          expect(kind === "intent" ? records.at(0) : records.at(0)?.handle).toMatchObject(JSON.parse(result))
        }
      }),
    )
  }
})

describe("BrowserOwner private publication", () => {
  it.live("concurrent creators read one complete winner and preserve unrelated temporary files", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      yield* Effect.promise(async () => {
        await fs.mkdir(folder(ctx), { recursive: true, mode: 0o700 })
        await fs.writeFile(path.join(folder(ctx), ".another-attempt.tmp"), "keep", { flag: "wx", mode: 0o600 })
      })
      const owners = yield* Effect.all(
        Array.from({ length: 24 }, () => BrowserOwner.open(ctx)),
        { concurrency: "unbounded" },
      )
      const first = owners.at(0)
      if (!first) throw new Error("No creator completed")
      expect(new Set(owners.map((owner) => Redacted.value(owner.proof))).size).toBe(1)
      const stored = yield* Effect.promise(() => fs.readFile(credential(ctx), "utf8"))
      expect(JSON.parse(stored)).toEqual({
        version: 1,
        parentSessionId: ctx.sessionID,
        parentProof: Redacted.value(first.proof),
      })
      expect(Buffer.from(Redacted.value(first.proof), "hex")).toHaveLength(32)
      const names = yield* Effect.promise(() => fs.readdir(folder(ctx)))
      expect(names.sort()).toEqual([".another-attempt.tmp", "owner.json"])
      const reopened = yield* BrowserOwner.open(ctx)
      expect(Redacted.value(reopened.proof)).toBe(Redacted.value(first.proof))
    }),
  )

  windows("creates and reopens credentials using the inherited Windows ACL", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const owner = yield* BrowserOwner.open(ctx)
      const reopened = yield* BrowserOwner.open(ctx)
      expect(Redacted.value(reopened.proof)).toBe(Redacted.value(owner.proof))
      expect(yield* Effect.promise(() => fs.readdir(folder(ctx)))).toEqual(["owner.json"])
    }),
  )

  for (const target of ["root", "directory", "credential"] as const) {
    unix(`rejects unsafe POSIX ${target} permissions`, () =>
      Effect.gen(function* () {
        const ctx = yield* seed()
        yield* BrowserOwner.open(ctx)
        const file =
          target === "root" ? path.dirname(folder(ctx)) : target === "directory" ? folder(ctx) : credential(ctx)
        const expected = target === "credential" ? 0o600 : 0o700
        expect((yield* Effect.promise(() => fs.lstat(file))).mode & 0o7777).toBe(expected)
        yield* Effect.promise(() => fs.chmod(file, target === "credential" ? 0o644 : 0o755))
        try {
          const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
          expect(err.data.code).toBe("unsafe_storage")
        } finally {
          yield* Effect.promise(() => fs.chmod(file, expected))
        }
      }),
    )
  }

  const corrupt = [
    ["truncated JSON", "{", "invalid_record"],
    ["nonobject JSON", "null", "invalid_record"],
    [
      "invalid capability",
      JSON.stringify({ version: 1, parentSessionId: "SESSION", parentProof: "short" }),
      "invalid_record",
    ],
    [
      "wrong version",
      JSON.stringify({ version: 2, parentSessionId: "SESSION", parentProof: "a".repeat(64) }),
      "invalid_record",
    ],
    [
      "foreign binding",
      JSON.stringify({ version: 1, parentSessionId: "ses_foreign", parentProof: "a".repeat(64) }),
      "owner_mismatch",
    ],
    [
      "unknown secret key",
      JSON.stringify({ version: 1, parentSessionId: "SESSION", parentProof: "a".repeat(64), SECRET: true }),
      "invalid_record",
    ],
  ] as const
  for (const [name, value, code] of corrupt) {
    it.live(`does not replace a credential with ${name}`, () =>
      Effect.gen(function* () {
        const ctx = yield* seed()
        yield* BrowserOwner.open(ctx)
        const text = value.replace("SESSION", ctx.sessionID)
        yield* Effect.promise(() => fs.writeFile(credential(ctx), text))
        for (let attempt = 0; attempt < 2; attempt++) {
          const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
          expect(err.data.code).toBe(code)
          expect(err.data.retryable).toBe(false)
          expect(JSON.stringify(err)).not.toContain("SECRET")
        }
        expect(yield* Effect.promise(() => fs.readFile(credential(ctx), "utf8"))).toBe(text)
        expect(yield* Effect.promise(() => fs.readdir(folder(ctx)))).toEqual(["owner.json"])
      }),
    )
  }

  it.live("fails closed when hard-link publication is unavailable", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      spyOn(fs, "link").mockRejectedValueOnce(
        Object.assign(new Error("private filesystem detail"), { code: "ENOTSUP" }),
      )
      const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
      expect(err.data.code).toBe("unsupported")
      expect(err.data.retryable).toBe(false)
      expect(String(err)).not.toContain("private filesystem detail")
      expect(yield* Effect.promise(() => fs.readdir(folder(ctx)))).toEqual([])
    }),
  )

  it.live("keeps transient publication errors retryable without publishing partial credentials", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const link = spyOn(fs, "link").mockRejectedValueOnce(
        Object.assign(new Error("transient I/O failure"), { code: "EIO" }),
      )
      const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
      expect(err.data.code).toBe("storage_unavailable")
      expect(err.data.retryable).toBe(true)
      expect(yield* Effect.promise(() => fs.readdir(folder(ctx)))).toEqual([])
      link.mockRestore()
      const owner = yield* BrowserOwner.open(ctx)
      expect(Redacted.value(owner.proof)).toHaveLength(64)
    }),
  )

  unix("rejects unsafe POSIX temporary credentials", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const open = fs.open
      spyOn(fs, "open").mockImplementation(async (...args) => {
        const file = await open(...args)
        if (String(args.at(0)).endsWith(".tmp")) await file.chmod(0o644)
        return file
      })
      const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
      expect(err.data.code).toBe("unsafe_storage")
      expect(yield* Effect.promise(() => fs.readdir(folder(ctx)))).toEqual([])
    }),
  )

  it.live("does not publish when syncing the complete temporary file fails", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const open = fs.open
      spyOn(fs, "open").mockImplementation(async (...args) => {
        const file = await open(...args)
        if (String(args.at(0)).endsWith(".tmp")) spyOn(file, "sync").mockRejectedValueOnce(new Error("sync failed"))
        return file
      })
      const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
      expect(err.data.code).toBe("storage_unavailable")
      expect(err.data.retryable).toBe(true)
      expect(yield* Effect.promise(() => fs.readdir(folder(ctx)))).toEqual([])
    }),
  )

  it.live("keeps a corrupt race winner instead of replacing or deleting it", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const link = fs.link
      spyOn(fs, "link").mockImplementationOnce(async (source, target) => {
        await fs.writeFile(target, "incomplete winner", { flag: "wx", mode: 0o600 })
        await link(source, target)
      })
      const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
      expect(err.data.code).toBe("invalid_record")
      expect(yield* Effect.promise(() => fs.readFile(credential(ctx), "utf8"))).toBe("incomplete winner")
      expect(yield* Effect.promise(() => fs.readdir(folder(ctx)))).toEqual(["owner.json"])
    }),
  )

  it.live("never removes a temporary file when exclusive creation loses", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const uuid = "00000000-0000-4000-8000-000000000000"
      const temp = path.join(folder(ctx), `.${uuid}.tmp`)
      yield* Effect.promise(async () => {
        await fs.mkdir(folder(ctx), { recursive: true, mode: 0o700 })
        await fs.writeFile(temp, "another creator", { flag: "wx", mode: 0o600 })
      })
      spyOn(crypto, "randomUUID").mockReturnValue(uuid)
      const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
      expect(err.data.code).toBe("storage_unavailable")
      expect(yield* Effect.promise(() => fs.readFile(temp, "utf8"))).toBe("another creator")
      expect(yield* Effect.promise(() => fs.readdir(folder(ctx)))).toEqual([`.${uuid}.tmp`])
    }),
  )

  for (const target of ["directory", "credential"] as const) {
    unix(`rejects a ${target} symlink without altering its target`, () =>
      Effect.gen(function* () {
        const ctx = yield* seed()
        yield* BrowserOwner.open(ctx)
        yield* Effect.promise(async () => {
          const file = target === "directory" ? folder(ctx) : credential(ctx)
          const moved = `${file}.original`
          await fs.rename(file, moved)
          await fs.symlink(moved, file, target === "directory" ? "dir" : "file")
        })
        const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
        expect(err.data.code).toBe("unsafe_storage")
        const original =
          target === "directory" ? path.join(`${folder(ctx)}.original`, "owner.json") : `${credential(ctx)}.original`
        expect(JSON.parse(yield* Effect.promise(() => fs.readFile(original, "utf8"))).parentSessionId).toBe(
          ctx.sessionID,
        )
      }),
    )
  }
})

it.live(
  "recovers credentials, unacknowledged intents, and accepted handles across process restarts",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const database = path.join(tmp.path, "restart.db")
      yield* Effect.gen(function* () {
        const ctx = yield* seed()
        const program = `
      import { Effect, Redacted } from "effect"
      import { createHash } from "node:crypto"
      import { Database } from "@opencode-ai/core/database/database"
      import { Global } from "@opencode-ai/core/global"
      const { BrowserOwner } = await import(${JSON.stringify(new URL("../../../src/kilocode/browser-task/owner.ts", import.meta.url).href)})
      const input = JSON.parse(process.argv[1])
      Global.Path.data = ${JSON.stringify(Global.Path.data)}
      const owner = await Effect.runPromise(BrowserOwner.open(input.ctx).pipe(Effect.provide(Database.layerFromPath(input.database))))
      if (input.create) {
        await owner.approve(${JSON.stringify(provider)})
        await owner.prepare({ providerId: ${JSON.stringify(provider)}, goal: "Persist before dispatch" })
      }
      console.log("BROWSER_OWNER " + JSON.stringify({
        invocationId: owner.invocationId,
        digest: createHash("sha256").update(Redacted.value(owner.proof)).digest("hex"),
        records: await owner.recover(),
      }))
    `
        const launch = async (create: boolean) => {
          const child = Bun.spawn(
            [
              process.execPath,
              "--eval",
              program,
              JSON.stringify({
                ctx: { sessionID: ctx.sessionID, messageID: ctx.messageID, callID: ctx.callID },
                database,
                create,
              }),
            ],
            { cwd: path.resolve(import.meta.dir, "../../.."), stdout: "pipe", stderr: "pipe", windowsHide: true },
          )
          const [code, out, err] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ])
          if (code !== 0) throw new Error(err)
          const line = out.split(/\r?\n/).find((line) => line.startsWith("BROWSER_OWNER "))
          if (!line) throw new Error("The restarted process returned no owner record")
          return z
            .object({
              invocationId: RemoteProtocol.BrowserInvocationId,
              digest: z.string(),
              records: z.array(
                z.object({
                  invocationId: RemoteProtocol.BrowserInvocationId,
                  handle: RemoteProtocol.BrowserJobHandle.optional(),
                }),
              ),
            })
            .parse(JSON.parse(line.slice("BROWSER_OWNER ".length)))
        }
        const first = yield* Effect.promise(() => launch(true))
        const owner = yield* BrowserOwner.open(ctx)
        expect(first.invocationId).toBe(owner.invocationId)
        expect(first.digest).toBe(crypto.createHash("sha256").update(Redacted.value(owner.proof)).digest("hex"))
        expect(first.records).toHaveLength(1)
        expect(first.records.at(0)?.handle).toBeUndefined()
        yield* Effect.promise(() => owner.remember(handle(owner.invocationId)))
        const restarted = yield* Effect.promise(() => launch(false))
        expect(restarted.digest).toBe(first.digest)
        expect(restarted.invocationId).toBe(first.invocationId)
        expect(restarted.records.at(0)?.handle).toEqual(handle(owner.invocationId))
      }).pipe(Effect.provide(Layer.fresh(Database.layerFromPath(database))))
    }),
  30_000,
)

describe("BrowserOwner recovery and parent isolation", () => {
  it.live("persists an intent before acceptance and resolves it only after a durable handle", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const owner = yield* BrowserOwner.open(ctx)
      yield* Effect.promise(async () => {
        expect(await owner.recover()).toEqual([])
        await denied(owner.prepare({ providerId: provider, goal: "Read a page" }), "permission_denied")
        await owner.approve(provider)
        const intent = await owner.prepare({ providerId: provider, goal: "Read a page" })
        expect(await owner.recover()).toEqual([{ ...intent, handle: undefined }])
        expect(await fs.readFile(path.join(folder(ctx), `intent-${owner.invocationId}.json`), "utf8")).not.toContain(
          "Read a page",
        )
        await owner.remember(handle(owner.invocationId))
        expect(await owner.recover()).toEqual([{ ...intent, handle: handle(owner.invocationId) }])
      })
      const reopened = yield* BrowserOwner.open({ ...ctx, callID: "recover-after-restart" })
      expect(yield* Effect.promise(() => reopened.lookup(task, job))).toEqual({
        providerId: provider,
        browserTaskId: task,
        jobId: job,
      })
      expect((yield* Effect.promise(() => reopened.recover())).at(0)?.handle).toEqual(handle(owner.invocationId))
    }),
  )

  it.live("detects conflicting payloads and handle changes without replacing the first records", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const owner = yield* BrowserOwner.open(ctx)
      yield* Effect.promise(async () => {
        await owner.approve(provider)
        const intent = await owner.prepare({ providerId: provider, goal: "First goal" })
        expect(await owner.prepare({ providerId: provider, goal: "First goal" })).toEqual(intent)
        await denied(owner.prepare({ providerId: provider, goal: "Different goal" }), "invocation_conflict")
        const saved = await owner.remember(handle(owner.invocationId))
        await denied(
          owner.remember({ ...saved, jobId: "bj_00000000-0000-4000-8000-000000000005" }),
          "invocation_conflict",
        )
        expect(await owner.recover()).toEqual([{ ...intent, handle: saved }])
      })
    }),
  )

  it.live("keeps concurrent intents and accepted handles complete and first-wins", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const owner = yield* BrowserOwner.open(ctx)
      yield* Effect.promise(async () => {
        await owner.approve(provider)
        const intents = await Promise.allSettled(
          ["First", "Second"].map((goal) => owner.prepare({ providerId: provider, goal })),
        )
        expect(intents.filter((result) => result.status === "fulfilled")).toHaveLength(1)
        const rejected = intents.find((result) => result.status === "rejected")
        expect(rejected?.status === "rejected" ? rejected.reason : undefined).toMatchObject({
          data: { code: "invocation_conflict" },
        })
        const handles = await Promise.all(Array.from({ length: 8 }, () => owner.remember(handle(owner.invocationId))))
        expect(handles).toEqual(Array.from({ length: 8 }, () => handle(owner.invocationId)))
        expect((await owner.recover()).at(0)?.handle).toEqual(handle(owner.invocationId))
        expect((await fs.readdir(folder(ctx))).filter((name) => name.endsWith(".tmp"))).toEqual([])
      })
    }),
  )

  it.live("isolates approvals, recovery, status, cancellation, and continuation lookups by parent", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const foreign = yield* seed()
      const owner = yield* BrowserOwner.open(ctx)
      const outsider = yield* BrowserOwner.open(foreign)
      expect(Redacted.value(outsider.proof)).not.toBe(Redacted.value(owner.proof))
      yield* Effect.promise(async () => {
        await owner.approve(provider)
        await owner.prepare({ providerId: provider, goal: "Read" })
        await owner.remember(handle(owner.invocationId))
        expect(await outsider.approved(provider)).toBe(false)
        expect(await outsider.recover()).toEqual([])
        await outsider.approve(provider)
        await denied(outsider.lookup(task), "not_found")
        await denied(outsider.lookup(task, job), "not_found")
        await denied(outsider.prepare({ providerId: provider, goal: "Continue", browserTaskId: task }), "not_found")
        await denied(outsider.remember(handle(owner.invocationId)), "not_found")
        await denied(owner.lookup("bt_00000000-0000-4000-8000-000000000006", job), "not_found")
        expect(await owner.lookup(task)).toEqual({ providerId: provider, browserTaskId: task, jobId: undefined })
      })
    }),
  )

  it.live("requires a matching provider and durable intent before accepting a handle", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const owner = yield* BrowserOwner.open(ctx)
      yield* Effect.promise(async () => {
        await denied(owner.remember(handle(owner.invocationId)), "not_found")
        await owner.approve(provider)
        await owner.prepare({ providerId: provider, goal: "Read" })
        await denied(owner.remember({ ...handle(owner.invocationId), providerId: other }), "owner_mismatch")
        expect((await owner.recover()).at(0)?.handle).toBeUndefined()
        await owner.remember(handle(owner.invocationId))
      })
      const continuation = yield* BrowserOwner.open({ ...ctx, callID: "continue" })
      yield* Effect.promise(async () => {
        await continuation.approve(other)
        await denied(
          continuation.prepare({ providerId: other, goal: "Continue", browserTaskId: task }),
          "owner_mismatch",
        )
        await continuation.prepare({ providerId: provider, goal: "Continue", browserTaskId: task })
        await denied(
          continuation.remember({
            ...handle(continuation.invocationId),
            browserTaskId: "bt_00000000-0000-4000-8000-000000000006",
          }),
          "owner_mismatch",
        )
        const next = {
          ...handle(continuation.invocationId),
          jobId: "bj_00000000-0000-4000-8000-000000000005",
        } satisfies RemoteProtocol.BrowserJobHandle
        await continuation.remember(next)
        expect(await continuation.lookup(task, next.jobId)).toEqual({
          providerId: provider,
          browserTaskId: task,
          jobId: next.jobId,
        })
        expect(await continuation.lookup(task)).toEqual({ providerId: provider, browserTaskId: task, jobId: undefined })
      })
    }),
  )

  it.live("does not regenerate a missing credential over retained recovery records", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const owner = yield* BrowserOwner.open(ctx)
      yield* Effect.promise(async () => {
        await owner.approve(provider)
        await owner.prepare({ providerId: provider, goal: "Read" })
        await fs.unlink(credential(ctx))
      })
      const err = yield* BrowserOwner.open(ctx).pipe(Effect.flip)
      expect(err.data.code).toBe("invalid_record")
      yield* Effect.promise(() => rejects(fs.lstat(credential(ctx)), { code: "ENOENT" }))
    }),
  )

  it.live("excludes expired intents from recovery and reports expired owned jobs", () =>
    Effect.gen(function* () {
      const clock = spyOn(Date, "now").mockReturnValue(1_787_875_200_000)
      const ctx = yield* seed()
      const owner = yield* BrowserOwner.open(ctx)
      yield* Effect.promise(async () => {
        await owner.approve(provider)
        await owner.prepare({ providerId: provider, goal: "Read" })
        await owner.remember(handle(owner.invocationId))
        clock.mockReturnValue(1_787_875_200_000 + week)
        expect(await owner.recover()).toEqual([])
        await denied(owner.lookup(task), "invocation_expired")
        await denied(owner.prepare({ providerId: provider, goal: "Read" }), "invocation_expired")
        await denied(owner.remember(handle(owner.invocationId)), "invocation_expired")
      })
    }),
  )

  for (const [kind, field, value, code] of [
    ["intent", "parentSessionId", "ses_foreign", "owner_mismatch"],
    ["intent", "invocationId", "malformed", "invalid_record"],
    ["intent", "invocationId", `b1.1787875200000.${"a".repeat(64)}`, "invalid_record"],
    ["job", "providerId", other, "owner_mismatch"],
    ["job", "invocationId", `b1.1787875200000.${"a".repeat(64)}`, "owner_mismatch"],
    ["job", "jobId", "malformed", "invalid_record"],
  ] as const) {
    it.live(`rejects a corrupted ${kind} ${field} binding (${value})`, () =>
      Effect.gen(function* () {
        const ctx = yield* seed()
        const owner = yield* BrowserOwner.open(ctx)
        yield* Effect.promise(async () => {
          await owner.approve(provider)
          await owner.prepare({ providerId: provider, goal: "Read" })
          await owner.remember(handle(owner.invocationId))
          const file = path.join(folder(ctx), `${kind}-${owner.invocationId}.json`)
          const data = z.record(z.string(), z.unknown()).parse(JSON.parse(await fs.readFile(file, "utf8")))
          const text = JSON.stringify({ ...data, [field]: value })
          await fs.writeFile(file, text)
          await denied(owner.recover(), code)
          expect(await fs.readFile(file, "utf8")).toBe(text)
        })
      }),
    )
  }

  it.live("rejects a provider approval copied to another provider's filename", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const owner = yield* BrowserOwner.open(ctx)
      yield* Effect.promise(async () => {
        await owner.approve(provider)
        await fs.copyFile(
          path.join(folder(ctx), `approval-${provider}.json`),
          path.join(folder(ctx), `approval-${other}.json`),
        )
        await denied(owner.approve(other), "owner_mismatch")
        await denied(owner.approved(other), "owner_mismatch")
        await denied(owner.prepare({ providerId: other, goal: "Read" }), "owner_mismatch")
      })
    }),
  )

  it.live("rejects unsafe identifiers, oversized UTF-8 goals, and extra authority fields", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const owner = yield* BrowserOwner.open(ctx)
      yield* Effect.promise(async () => {
        await owner.approve(provider)
        await denied(owner.approved("../../owner"), "invalid_record")
        await denied(owner.lookup("../../owner"), "invalid_record")
        await denied(owner.lookup(task, "../../owner"), "invalid_record")
        for (const goal of ["", "é".repeat(8193)])
          await denied(owner.prepare({ providerId: provider, goal }), "invalid_record")
        const input = { providerId: provider, goal: "Read", parentProof: Redacted.value(owner.proof) } as const
        await denied(owner.prepare(input), "invalid_record")
        expect(await owner.recover()).toEqual([])
      })
    }),
  )

  it.live("does not serialize capability values into metadata, tool arguments, results, or errors", () =>
    Effect.gen(function* () {
      const ctx = yield* seed()
      const metadata: unknown[] = []
      const owner = yield* BrowserOwner.open({
        ...ctx,
        metadata: (value) =>
          Effect.sync(() => {
            metadata.push(value)
          }),
      })
      const secret = Redacted.value(owner.proof)
      const db = yield* Database.Service
      const before = yield* db.db.select().from(SessionTable).where(eq(SessionTable.id, ctx.sessionID)).get()
      const args = RemoteProtocol.BrowserTaskArguments.parse({ operation: "run", provider_id: provider, goal: "Read" })
      yield* Effect.promise(async () => {
        await owner.approve(provider)
        const intent = await owner.prepare({ providerId: provider, goal: args.operation === "run" ? args.goal : "" })
        const result = await owner.remember(handle(owner.invocationId))
        for (const value of [owner, owner.proof, args, intent, result, metadata, await owner.recover()]) {
          expect(JSON.stringify(value)).not.toContain(secret)
          expect(inspect(value)).not.toContain(secret)
        }
        const invalid = RemoteProtocol.BrowserTaskArguments.safeParse({
          ...args,
          parentProof: secret,
          [secret]: secret,
        })
        expect(invalid.success).toBe(false)
        expect(JSON.stringify(invalid)).not.toContain(secret)
        spyOn(fs, "lstat").mockRejectedValueOnce(new Error(`filesystem error ${secret}`))
        const err = await owner.recover().catch((err: unknown) => err)
        expect(err).toBeInstanceOf(BrowserOwner.Error)
        expect(JSON.stringify(err)).not.toContain(secret)
        expect(inspect(err)).not.toContain(secret)
        expect(String(err)).not.toContain(secret)
      })
      const after = yield* db.db.select().from(SessionTable).where(eq(SessionTable.id, ctx.sessionID)).get()
      expect(after).toEqual(before)
      const rows = yield* db.db.select().from(MessageTable).where(eq(MessageTable.session_id, ctx.sessionID)).all()
      const parts = yield* db.db.select().from(PartTable).where(eq(PartTable.session_id, ctx.sessionID)).all()
      expect(JSON.stringify([rows, parts])).not.toContain(secret)
    }),
  )
})

const sessions = testEffect(LayerNode.compile(LayerNode.group([Database.node, Session.node, SessionProjector.node])))
sessions.instance(
  "a real session fork copies metadata but not browser ownership or recovery records",
  () =>
    Effect.gen(function* () {
      yield* seedProject
      const svc = yield* Session.Service
      const chat = yield* svc.create({
        metadata: { browser_task_id: task, job_id: job, parentProof: "copied nonsecret marker" },
      })
      const ctx = yield* seed({ sessionID: chat.id })
      const owner = yield* BrowserOwner.open(ctx)
      yield* Effect.promise(async () => {
        await owner.approve(provider)
        await owner.prepare({ providerId: provider, goal: "Read" })
        await owner.remember(handle(owner.invocationId))
      })
      const copy = yield* svc.fork({ sessionID: chat.id })
      const messages = yield* svc.messages({ sessionID: copy.id })
      const message = messages.find((message) => message.info.role === "assistant")
      if (!message) throw new Error("The fork has no copied message")
      const fork = yield* BrowserOwner.open({
        ...ctx,
        sessionID: copy.id,
        messageID: message.info.id,
        extra: { parentSessionId: chat.id, parentProof: "copied nonsecret marker" },
      })
      expect(copy.metadata).toEqual(chat.metadata)
      expect(fork.invocationId).not.toBe(owner.invocationId)
      expect(Redacted.value(fork.proof)).not.toBe(Redacted.value(owner.proof))
      expect(JSON.stringify([copy, messages])).not.toContain(Redacted.value(owner.proof))
      yield* Effect.promise(async () => {
        expect(await fork.recover()).toEqual([])
        expect(await fork.approved(provider)).toBe(false)
        await denied(fork.lookup(task, job), "not_found")
        expect((await owner.recover()).at(0)?.handle).toEqual(handle(owner.invocationId))
      })
    }),
  30_000,
)
