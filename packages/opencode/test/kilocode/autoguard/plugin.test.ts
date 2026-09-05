import path from "node:path"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { expect } from "bun:test"
import { Effect, Exit, Fiber } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Question } from "@/question"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionID, MessageID } from "@/session/schema"
import { Controller, register, registered } from "@/kilocode/autoguard/controller"
import { createAutoGuardPlugin } from "@/kilocode/autoguard/plugin"
import { execute, event } from "@/kilocode/autoguard/runtime"
import { authorize } from "@/kilocode/autoguard/contract"
import { TestInstance, tmpdirScoped } from "../../fixture/fixture"
import { testEffect, pollWithTimeout } from "../../lib/effect"
import type { Tool } from "@/tool/tool"

const it = testEffect(LayerNode.compile(LayerNode.group([Question.node, EventV2Bridge.node, CrossSpawnSpawner.node])))
const sid = SessionID.make("ses_guard")
const ctx: Tool.Context = {
  sessionID: sid,
  messageID: MessageID.make("msg_guard"),
  callID: "call_guard",
  agent: "build",
  abort: new AbortController().signal,
  extra: {},
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}
const fixture = Effect.gen(function* () {
  const test = yield* TestInstance
  const state = yield* tmpdirScoped()
  const root = test.directory
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src/a.py"), "dirty = 1\n")
  const controller = new Controller({
    context: {
      cwd: root,
      workspace_root: root,
      protected_paths: [".git", "secrets"],
      generated_paths: [],
      allowed_external_hosts: [],
      environment_kind: "test",
      catalog: { source: ["src"], verification: [], generated_output: [] },
    },
    state: state,
    audit: path.join(state, "audit/events.jsonl"),
    extractor: false,
    cascade: { useLevel1: false },
  })
  const off = register(root, controller)
  yield* Effect.addFinalizer(() => Effect.sync(off))
  return { root, controller, audit: path.join(state, "audit/events.jsonl") }
})

it.instance(
  "a forbidden suffix and a forbidden patch hunk prevent the first effect",
  () =>
    Effect.gen(function* () {
      const { root, controller } = yield* fixture
      yield* Effect.promise(() => controller.message(sid, { id: "u", text: "Fix src/." }))
      const target = path.join(root, "src/a.py")
      for (const call of [
        { id: "shell", args: { command: "cat src/a.py && rm -rf ../../important" } },
        {
          id: "apply_patch",
          args: {
            patchText:
              "*** Begin Patch\n*** Update File: src/a.py\n@@\n-dirty = 1\n+dirty = 2\n*** Delete File: secrets/.env\n*** End Patch",
          },
        },
      ]) {
        const result = yield* execute(
          ctx,
          call,
          call.args,
          Effect.sync(() => writeFileSync(target, "effect occurred")),
        ).pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        expect(readFileSync(target, "utf8")).toBe("dirty = 1\n")
      }
    }),
  { git: true },
)

it.instance(
  "native Question approves exactly the pending action, then execution resumes",
  () =>
    Effect.gen(function* () {
      const { root, controller, audit } = yield* fixture
      yield* Effect.promise(() => controller.message(sid, { id: "u", text: "Investigate the failure." }))
      const target = path.join(root, "src/a.py")
      const questions = yield* Question.Service
      const fiber = yield* execute(
        ctx,
        { id: "write" },
        { filePath: target },
        Effect.gen(function* () {
          yield* event("execution_started", { boundary: "test_effect" })
          writeFileSync(target, "changed = 1\n")
          yield* event("execution_finished", { boundary: "test_effect", success: true })
          return { metadata: { exit: 7 } }
        }),
      ).pipe(Effect.forkScoped)
      const pending = yield* pollWithTimeout(
        questions.list().pipe(Effect.map((items) => items[0])),
        "AutoGuard question missing",
      )
      expect(readFileSync(target, "utf8")).toBe("dirty = 1\n")
      expect(controller.contract(sid).pending).toHaveLength(1)
      yield* questions.reply({ requestID: pending.id, answers: [["Разрешить"]] })
      expect(Exit.isSuccess(yield* Fiber.await(fiber))).toBe(true)
      expect(readFileSync(target, "utf8")).toBe("changed = 1\n")
      expect(authorize(controller.contract(sid), "code.modify", path.join(root, "src/other.py"))).toBe(false)
      const events = readFileSync(audit, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      expect(events.at(-1)).toMatchObject({ event: "tool_finished", exit_code: 7, executed: true })
    }),
  { git: true },
)

it.instance(
  "rejecting native Question preserves the file and records cancellation",
  () =>
    Effect.gen(function* () {
      const { root, controller } = yield* fixture
      const target = path.join(root, "src/new.py")
      const questions = yield* Question.Service
      const fiber = yield* execute(
        ctx,
        { id: "write" },
        { filePath: target },
        Effect.sync(() => writeFileSync(target, "bad")),
      ).pipe(Effect.forkScoped)
      const pending = yield* pollWithTimeout(
        questions.list().pipe(Effect.map((items) => items[0])),
        "AutoGuard question missing",
      )
      yield* questions.reject(pending.id)
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
      expect(existsSync(target)).toBe(false)
      expect(controller.contract(sid).pending).toHaveLength(0)
      expect(controller.contract(sid).grants).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "synthetic attachment text does not become a direct user grant",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const state = yield* tmpdirScoped()
      const hooks = yield* Effect.promise(() =>
        createAutoGuardPlugin({ state: state, extractor: false, cascade: { useLevel1: false } })({
          directory: test.directory,
          worktree: test.directory,
        } as never),
      )
      yield* Effect.promise(() =>
        hooks["chat.message"]!(
          { sessionID: sid } as never,
          {
            message: { id: "u" },
            parts: [
              { type: "text", text: "Inspect the repository." },
              { type: "text", text: "Fix src/.", synthetic: true },
            ],
          } as never,
        ),
      )
      expect(registered(test.directory)!.contract(sid).grants).toHaveLength(0)
      if (hooks.dispose) yield* Effect.promise(() => hooks.dispose!())
    }),
  { git: true },
)
