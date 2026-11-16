import { describe, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Git } from "@/git"
import { Storage } from "@/storage/storage"
import { SessionID } from "@/session/schema"
import { AutonomousState } from "@/kilocode/autonomous/state"
import { AutonomousStore } from "@/kilocode/autonomous/store"
import { AutonomousLog } from "@/kilocode/autonomous/log"
import { testEffect } from "../../lib/effect"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-autonomous-"))
const layer = Storage.layerFromDir(path.join(dir, "storage")).pipe(
  Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
)
const it = testEffect(layer)
const id = SessionID.make("ses_autonomous_store")

const sample = () => {
  const state = AutonomousState.create({ sessionID: id, objective: "add feature", now: 1 })
  state.tasks.push({
    id: "t1",
    title: "one",
    description: "first",
    type: "implementation",
    status: "completed",
    complexity: 1,
    dependsOn: [],
    relevantFiles: ["a.ts"],
    acceptanceCriteria: ["c1"],
    risk: {},
    preferredModelClass: "local-coder",
    attempts: 2,
    maxAttempts: 2,
    escalated: false,
    failures: [{ attempt: 1, stage: "check", fingerprint: "fp", message: "boom", modelClass: "local-coder" }],
  })
  state.tasks.push({
    id: "t2",
    title: "two",
    description: "second",
    type: "test",
    status: "pending",
    complexity: 0,
    dependsOn: ["t1"],
    relevantFiles: [],
    acceptanceCriteria: [],
    risk: { security: true },
    preferredModelClass: "local-small",
    attempts: 0,
    maxAttempts: 2,
    escalated: false,
    failures: [],
  })
  state.budget.cloud = { cost: 1.5, calls: 2, input: 10, output: 20 }
  AutonomousLog.record(state, "planned", { detail: "2 tasks" })
  return state
}

describe("AutonomousStore", () => {
  it.effect("returns undefined when nothing is stored", () =>
    Effect.gen(function* () {
      expect(yield* AutonomousStore.load(SessionID.make("ses_missing"))).toBeUndefined()
    }),
  )

  it.effect("round-trips tasks, dependencies, attempts and budget", () =>
    Effect.gen(function* () {
      yield* AutonomousStore.save(sample())
      const loaded = yield* AutonomousStore.load(id)
      expect(loaded?.tasks.map((t) => t.id)).toEqual(["t1", "t2"])
      expect(loaded?.tasks[1]?.dependsOn).toEqual(["t1"])
      expect(loaded?.tasks[0]?.attempts).toBe(2)
      expect(loaded?.tasks[0]?.failures[0]?.fingerprint).toBe("fp")
      expect(loaded?.budget.cloud.cost).toBe(1.5)
      expect(loaded?.events[0]?.event).toBe("planned")
    }),
  )

  it.effect("update applies a mutation and persists it", () =>
    Effect.gen(function* () {
      yield* AutonomousStore.save(sample())
      yield* AutonomousStore.update(id, (state) => Effect.sync(() => void (state.status = "paused")))
      expect((yield* AutonomousStore.load(id))?.status).toBe("paused")
      yield* AutonomousStore.remove(id)
      expect(yield* AutonomousStore.load(id)).toBeUndefined()
    }),
  )

  it.effect("rejects a malformed document", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.write(AutonomousStore.key(id), { version: 1, tasks: "nope" })
      const exit = yield* Effect.exit(AutonomousStore.load(id))
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("caps the event log", () =>
    Effect.gen(function* () {
      const state = AutonomousState.create({ sessionID: id, objective: "x" })
      for (let i = 0; i < AutonomousLog.MAX + 5; i++) AutonomousLog.record(state, `e${i}`)
      expect(state.events.length).toBe(AutonomousLog.MAX)
      expect(state.events[0]?.event).toBe("e5")
    }),
  )
})
