import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import path from "path"
import fs from "fs/promises"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import * as Config from "../../../src/config/config"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { InstanceState } from "../../../src/effect/instance-state"
import { Permission } from "../../../src/permission"
import { SessionID } from "../../../src/session/schema"
import { IgnorePermission } from "../../../src/kilocode/permission/ignore"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const env = Layer.mergeAll(
  Permission.layer.pipe(
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Database.defaultLayer),
  ),
  CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

function denied(exit: Exit.Exit<unknown, unknown>) {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.DeniedError)
}

const rules = Permission.fromConfig({ read: "allow", edit: "allow" })

describe(".kilocodeignore policy", () => {
  it.live("uses Git-ignore patterns and source ordering", () =>
    Effect.sync(() => {
      const root = "/workspace"
      expect(
        IgnorePermission.matches({ root, filepath: "/workspace/.env.local", contents: [".env*\n!.env.example\n"] }),
      ).toBe(true)
      expect(
        IgnorePermission.matches({ root, filepath: "/workspace/.env.example", contents: [".env*\n!.env.example\n"] }),
      ).toBe(false)
      expect(
        IgnorePermission.matches({
          root,
          filepath: "/workspace/private/token.txt",
          contents: ["private/\n!private/public.txt\n"],
        }),
      ).toBe(true)
      expect(
        IgnorePermission.matches({
          root,
          filepath: "/workspace/private/public.txt",
          contents: ["private/\n!private/\n!private/public.txt\n"],
        }),
      ).toBe(false)
      expect(
        IgnorePermission.matches({ root, filepath: "/workspace/.env.local", contents: [".env*\n", "!.env.local\n"] }),
      ).toBe(false)
    }),
  )

  it.live("loads legacy user, current user, and workspace policies in order", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const legacy = path.join(dir, "legacy")
          const current = path.join(dir, "current")
          const ctx = yield* InstanceState.context
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(path.join(legacy, ".kilocodeignore"), "legacy.txt\nshared.txt\n"),
              Bun.write(path.join(current, ".kilocodeignore"), "!shared.txt\ncurrent.txt\n"),
              Bun.write(path.join(dir, ".kilocodeignore"), "!current.txt\nworkspace.txt\n"),
            ]),
          )

          const input = { ctx, permission: "read", dirs: [legacy, current] }
          denied(yield* IgnorePermission.assert({ ...input, patterns: ["legacy.txt"] }).pipe(Effect.exit))
          yield* IgnorePermission.assert({ ...input, patterns: ["shared.txt"] })
          yield* IgnorePermission.assert({ ...input, patterns: ["current.txt"] })
          denied(yield* IgnorePermission.assert({ ...input, patterns: ["workspace.txt"] }).pipe(Effect.exit))
        }),
      { git: true },
    ),
  )

  it.live("hard denies ignored read and edit paths despite broad allows", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(path.join(dir, ".env.local"), "KILO_11637_SECRET"),
              Bun.write(path.join(dir, ".kilocodeignore"), ".env*\n"),
            ]),
          )
          const input = {
            sessionID: SessionID.make("ses_ignore"),
            patterns: [".env.local"],
            metadata: {},
            always: ["*"],
            ruleset: rules,
          }

          denied(yield* ask({ ...input, permission: "read" }).pipe(Effect.exit))
          denied(yield* ask({ ...input, permission: "edit" }).pipe(Effect.exit))
          expect(yield* (yield* Permission.Service).list()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("maps filesystem permission variants to the policy access categories", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => Bun.write(path.join(dir, ".kilocodeignore"), "secret.ipynb\n"))
          const input = {
            sessionID: SessionID.make("ses_ignore_variants"),
            patterns: ["secret.ipynb"],
            metadata: {},
            always: ["*"],
            ruleset: Permission.fromConfig({ "*": "allow" }),
          }
          for (const permission of ["write", "notebook_read", "notebook_edit", "notebook_execute"]) {
            denied(yield* ask({ ...input, permission }).pipe(Effect.exit))
          }
          expect(IgnorePermission.access("glob")).toBeUndefined()
        }),
      { git: true },
    ),
  )

  it.live("fails closed for symlinked and oversized policy files", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const target = path.join(dir, "secret.txt")
          const policy = path.join(dir, ".kilocodeignore")
          yield* Effect.promise(() => Bun.write(target, "KILO_11637_SECRET"))
          yield* Effect.promise(() => fs.symlink(target, policy))
          denied(
            yield* IgnorePermission.assert({ ctx, access: "read", candidates: [{ requested: target }] }).pipe(
              Effect.exit,
            ),
          )
          yield* Effect.promise(() => fs.rm(policy))
          yield* Effect.promise(() => Bun.write(policy, "#".repeat(1024 * 1024 + 1)))
          denied(
            yield* IgnorePermission.assert({ ctx, access: "read", candidates: [{ requested: target }] }).pipe(
              Effect.exit,
            ),
          )
        }),
      { git: true },
    ),
  )

  it.live("applies policy changes without restarting the instance", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "secret.txt")
          const input = {
            sessionID: SessionID.make("ses_ignore_reload"),
            permission: "read",
            patterns: ["secret.txt"],
            metadata: {},
            always: ["*"],
            ruleset: rules,
          }
          yield* Effect.promise(() => Bun.write(file, "KILO_11637_SECRET"))
          yield* ask(input)

          yield* Effect.promise(() => Bun.write(path.join(dir, ".kilocodeignore"), "secret.txt\n"))
          denied(yield* ask(input).pipe(Effect.exit))

          yield* Effect.promise(() => Bun.write(path.join(dir, ".kilocodeignore"), "secret.txt\n!secret.txt\n"))
          yield* ask(input)

          yield* Effect.promise(() => Bun.file(path.join(dir, ".kilocodeignore")).delete())
          yield* ask(input)
        }),
      { git: true },
    ),
  )

  it.live("rechecks the policy after a pending approval", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const input = {
            sessionID: SessionID.make("ses_ignore_pending"),
            permission: "read",
            patterns: [".env.local"],
            metadata: {},
            always: ["*"],
            ruleset: Permission.fromConfig({ read: "ask" }),
          }
          yield* Effect.promise(() => Bun.write(path.join(dir, ".env.local"), "KILO_11637_SECRET"))
          const asking = yield* ask(input).pipe(Effect.forkScoped)
          const pending = yield* pollWithTimeout(
            Effect.gen(function* () {
              return (yield* permission.list()).find((item) => item.sessionID === input.sessionID)
            }),
            "read permission was never requested",
          )
          yield* Effect.promise(() => Bun.write(path.join(dir, ".kilocodeignore"), ".env*\n"))
          yield* permission.reply({ requestID: pending.id, reply: "once" })
          denied(yield* Fiber.await(asking))
          expect(yield* permission.list()).toEqual([])
        }),
      { git: true },
    ),
  )
})
