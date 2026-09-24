// kilocode_change - new file
// Real WriteTool + Permission integration for dangling config symlinks. The classifier unit tests
// cover the path algebra; these tests prove the actual write path cannot create a protected global
// config file through an in-project symlink whose destination does not exist yet.
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer, Option } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Format } from "@/format"
import { ConfigProtection } from "@/kilocode/permission/config-paths"
import { LSP } from "@/lsp/lsp"
import { Permission } from "@/permission"
import { MessageID, SessionID } from "@/session/schema"
import type { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { WriteTool } from "@/tool/write"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { disposeAllInstances, provideTmpdirInstance } from "../../fixture/fixture"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const env = Layer.mergeAll(
  AppNodeBuilder.build(
    LayerNode.group([
      Permission.node,
      Config.node,
      LSP.node,
      FSUtil.node,
      EventV2Bridge.node,
      Format.node,
      CrossSpawnSpawner.node,
      Truncate.node,
      Agent.node,
    ]),
  ),
  Bus.layer,
)
const it = testEffect(env)

const allow: Permission.Ruleset = [
  { permission: "edit", pattern: "*", action: "allow" },
  { permission: "external_directory", pattern: "*", action: "allow" },
]

const primary = (name: string) => path.join(Global.Path.config, name)

async function resetGlobal() {
  for (const name of ["kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc"]) {
    await fs.rm(primary(name), { force: true })
  }
}

const list = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.list()
  })

// Run the real WriteTool under real Permission with allow-all rules. Watch the pending list; reject
// a protected request and forward the fiber Exit so callers can assert the write outcome.
const run = (id: string, file: string, content: string) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const info = yield* WriteTool
    const tool = yield* info.init()
    const sessionID = SessionID.make("ses_" + id)
    const ctx: Tool.Context = {
      sessionID,
      messageID: MessageID.make("msg_" + id),
      callID: id,
      agent: "build",
      abort: AbortSignal.any([]),
      messages: [],
      metadata: () => Effect.void,
      ask: (req) =>
        permission
          .ask({ ...req, id: PermissionV1.ID.make(id), sessionID, ruleset: allow })
          .pipe(Effect.asVoid, Effect.orDie),
    }
    const fiber = yield* tool.execute({ filePath: file, content }, ctx).pipe(Effect.forkScoped)
    const pending = yield* pollWithTimeout(
      list().pipe(Effect.map((items) => (items.length > 0 ? items : undefined))),
      "no pending permission request",
      "1500 millis",
    ).pipe(Effect.timeout("2000 millis"), Effect.option)
    if (Option.isSome(pending)) {
      const metadata = pending.value[0]?.metadata as Record<string, unknown> | undefined
      yield* permission.reply({ requestID: PermissionV1.ID.make(id), reply: "reject" })
      const exit = yield* Fiber.await(fiber)
      return { kind: "prompt" as const, metadata, exit, body: undefined }
    }
    const exit = yield* Fiber.await(fiber)
    // A failed write must surface the real Cause. Reporting it as "auto" would hide a runtime tool
    // error and make a failed write look like an auto-approved one.
    if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause)
    const body = yield* Effect.promise(() => fs.readFile(file, "utf8").catch(() => undefined))
    return { kind: "auto" as const, metadata: undefined, exit, body }
  })

afterEach(async () => {
  await resetGlobal()
  await disposeAllInstances()
})

describe("dangling config symlinks through the real WriteTool", () => {
  it.live("keeps protection for a dangling in-project symlink and never creates the missing global target", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(resetGlobal)
          yield* Effect.promise(() =>
            fs.writeFile(path.join(dir, "kilo.json"), JSON.stringify({ require_approval_for_config_edits: false })),
          )
          yield* Effect.promise(() =>
            fs.writeFile(primary("kilo.json"), JSON.stringify({ require_approval_for_config_edits: true })),
          )
          const target = primary("opencode.jsonc")
          yield* Effect.promise(() => fs.rm(target, { force: true }))
          yield* Effect.promise(() => fs.mkdir(path.join(dir, ".kilo"), { recursive: true }))
          const symlink = path.join(dir, ".kilo", "kilo.json")
          yield* Effect.promise(() => fs.symlink(target, symlink, "file"))

          const result = yield* run("per_dangle_write", symlink, '{"username":"dangle"}')
          expect(result.kind).toBe("prompt")
          expect(result.metadata).toMatchObject({ disableAlways: true, configProtected: true })
          expect(Exit.isFailure(result.exit)).toBe(true)
          expect(
            yield* Effect.promise(() =>
              fs.stat(target).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)

          const classification = ConfigProtection.classify(
            { permission: "edit", patterns: [".kilo/kilo.json"], metadata: { filepath: symlink } },
            dir,
          )
          expect(classification).toMatchObject({ candidate: true, external: true, inside: false })
        }),
      { git: true },
    ),
  )

  it.live("prompts for a symlink to an existing global config target", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(resetGlobal)
          yield* Effect.promise(() =>
            fs.writeFile(primary("kilo.json"), JSON.stringify({ require_approval_for_config_edits: true })),
          )
          yield* Effect.promise(() => fs.mkdir(path.join(dir, ".kilo"), { recursive: true }))
          const symlink = path.join(dir, ".kilo", "existing.json")
          yield* Effect.promise(() => fs.symlink(primary("kilo.json"), symlink, "file"))

          const result = yield* run("per_existing_write", symlink, '{"username":"existing"}')
          expect(result.kind).toBe("prompt")
          expect(result.metadata).toMatchObject({ disableAlways: true, configProtected: true })
          expect(Exit.isFailure(result.exit)).toBe(true)
        }),
      { git: true },
    ),
  )

  it.live("auto-approves an ordinary project file without a symlink", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(resetGlobal)
          const file = path.join(dir, "src", "fresh.txt")
          const result = yield* run("per_ordinary_write", file, "hello")
          expect(result.kind).toBe("auto")
          expect(Exit.isSuccess(result.exit)).toBe(true)
          expect(result.body).toBe("hello")
        }),
      { git: true },
    ),
  )

  it.live("prompts for a relative in-project `..` dangling link under project policy", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(resetGlobal)
          yield* Effect.promise(() =>
            fs.writeFile(path.join(dir, "kilo.json"), JSON.stringify({ require_approval_for_config_edits: true })),
          )
          yield* Effect.promise(() =>
            fs.writeFile(primary("kilo.json"), JSON.stringify({ require_approval_for_config_edits: false })),
          )
          const symlink = path.join(dir, ".kilo", "link")
          yield* Effect.promise(() => fs.mkdir(path.join(dir, ".kilo"), { recursive: true }))
          yield* Effect.promise(() => fs.symlink(["..", "missing.json"].join("/"), symlink, "file"))
          const target = path.join(dir, "missing.json")

          const result = yield* run("per_rel_inside_on", symlink, '{"username":"rel-inside"}')
          expect(result.kind).toBe("prompt")
          expect(result.metadata).toMatchObject({ disableAlways: true, configProtected: true })
          expect(Exit.isFailure(result.exit)).toBe(true)
          expect(
            yield* Effect.promise(() =>
              fs.stat(target).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("auto-approves a relative in-project `..` dangling link when the project opts out", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(resetGlobal)
          yield* Effect.promise(() =>
            fs.writeFile(path.join(dir, "kilo.json"), JSON.stringify({ require_approval_for_config_edits: false })),
          )
          yield* Effect.promise(() =>
            fs.writeFile(primary("kilo.json"), JSON.stringify({ require_approval_for_config_edits: true })),
          )
          const symlink = path.join(dir, ".kilo", "link")
          yield* Effect.promise(() => fs.mkdir(path.join(dir, ".kilo"), { recursive: true }))
          yield* Effect.promise(() => fs.symlink(["..", "missing.json"].join("/"), symlink, "file"))

          const result = yield* run("per_rel_inside_off", symlink, '{"username":"rel-optout"}')
          expect(result.kind).toBe("auto")
          expect(Exit.isSuccess(result.exit)).toBe(true)
          expect(result.body).toContain("rel-optout")
        }),
      { git: true },
    ),
  )

  it.live("requires global policy for a relative `..` escape through a symlink ancestor", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(resetGlobal)
          yield* Effect.promise(() =>
            fs.writeFile(path.join(dir, "kilo.json"), JSON.stringify({ require_approval_for_config_edits: false })),
          )
          yield* Effect.promise(() =>
            fs.writeFile(primary("kilo.json"), JSON.stringify({ require_approval_for_config_edits: true })),
          )
          yield* Effect.promise(() =>
            fs.symlink(Global.Path.config, path.join(dir, "alias"), process.platform === "win32" ? "junction" : "dir"),
          )
          const symlink = path.join(dir, ".kilo", "link")
          yield* Effect.promise(() => fs.mkdir(path.join(dir, ".kilo"), { recursive: true }))
          yield* Effect.promise(() => fs.symlink(["..", "alias", "opencode.jsonc"].join("/"), symlink, "file"))
          const target = primary("opencode.jsonc")
          yield* Effect.promise(() => fs.rm(target, { force: true }))

          const classification = ConfigProtection.classify(
            { permission: "edit", patterns: [".kilo/link"], metadata: { filepath: symlink } },
            dir,
          )
          expect(classification).toMatchObject({ candidate: true, external: true, inside: false })

          const result = yield* run("per_rel_escape", symlink, '{"username":"rel-escape"}')
          expect(result.kind).toBe("prompt")
          expect(result.metadata).toMatchObject({ disableAlways: true, configProtected: true })
          expect(Exit.isFailure(result.exit)).toBe(true)
          expect(
            yield* Effect.promise(() =>
              fs.stat(target).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("prompts when a raw absolute `..` follows an in-project symlink out of the boundary", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(resetGlobal)
          yield* Effect.promise(() =>
            fs.writeFile(path.join(dir, "kilo.json"), JSON.stringify({ require_approval_for_config_edits: false })),
          )
          yield* Effect.promise(() =>
            fs.writeFile(primary("kilo.json"), JSON.stringify({ require_approval_for_config_edits: true })),
          )
          const base = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-raw-escape-")))
          const outside = path.join(base, "outside")
          yield* Effect.promise(() => fs.mkdir(outside, { recursive: true }))
          yield* Effect.promise(() =>
            fs.symlink(outside, path.join(dir, "link"), process.platform === "win32" ? "junction" : "dir"),
          )
          // The file tool keeps the absolute spelling; only the kernel applies `..` to the physical
          // symlink target, so the write would land outside the project without the classification fix.
          const raw = dir + path.sep + "link" + path.sep + ".." + path.sep + ".kilo" + path.sep + "kilo.json"
          const physical = path.join(base, ".kilo", "kilo.json")
          try {
            expect(
              ConfigProtection.classify({ permission: "edit", patterns: [raw], metadata: { filepath: raw } }, dir),
            ).toMatchObject({ candidate: true, external: true, inside: false })

            const result = yield* run("per_raw_escape", raw, '{"username":"raw-escape"}')
            expect(result.kind).toBe("prompt")
            expect(Exit.isFailure(result.exit)).toBe(true)
            expect(
              yield* Effect.promise(() =>
                fs.stat(physical).then(
                  () => true,
                  () => false,
                ),
              ),
            ).toBe(false)
          } finally {
            yield* Effect.promise(() => fs.rm(base, { recursive: true, force: true }))
          }
        }),
      { git: true },
    ),
  )

  it.live("treats a dangling symlink as absent", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const svc = yield* FSUtil.Service
          const link = path.join(dir, "dangling-link")
          yield* Effect.promise(() => fs.symlink(path.join(dir, "missing-target"), link, "file"))
          // `access` on Windows reports a broken reparse point as existing; the follow-check keeps it
          // absent so the write path asks permission instead of aborting on a read of the missing target.
          expect(yield* svc.existsSafe(link)).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("surfaces a failed fiber instead of reporting it as auto-approved", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          // A directory cannot be read as a pre-image, so the tool fails before the permission ask.
          // The helper must forward that Cause rather than label the failed write "auto".
          const target = path.join(dir, "a-directory")
          yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))
          const exit = yield* run("per_failure", target, "content").pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      { git: true },
    ),
  )
})
