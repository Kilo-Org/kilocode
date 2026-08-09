/**
 * Sara RLM — Persistence Repository (Phase 3)
 *
 * RLMRepository abstracts task persistence behind a clean interface.
 * Concrete implementation uses Drizzle ORM with the existing SQLite database.
 * Callers inject Database.Service as an Effect dependency.
 *
 * Persisted fields per task:
 *   id, parentID, sessionID, description, prompt, depth, phase,
 *   status, timestamps, usage, verification, reinvestigationCount
 */

import type { RLMTask, RLMTaskID, RLMTaskPhase } from "../task.js"
import type { RLMResult } from "../result.js"
import type { RLMVerification } from "../verifier/schema.js"
import { Effect, Context, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"

// --- Repository Interface ---

export interface Interface {
  readonly save: (task: RLMTask) => Effect.Effect<void, never, Database.Service>
  readonly load: (id: RLMTaskID) => Effect.Effect<RLMTask | null, never, Database.Service>
  readonly listChildren: (parentID: RLMTaskID) => Effect.Effect<RLMTask[], never, Database.Service>
  readonly updatePhase: (id: RLMTaskID, phase: RLMTaskPhase) => Effect.Effect<void, never, Database.Service>
  readonly saveResult: (id: RLMTaskID, result: RLMResult) => Effect.Effect<void, never, Database.Service>
  readonly saveVerification: (id: RLMTaskID, verification: RLMVerification) => Effect.Effect<void, never, Database.Service>
}

// --- In-Memory Implementation (Phase 3 — no DB schema changes yet) ---

class InMemoryRepository implements Interface {
  #tasks = new Map<string, RLMTask>()
  #results = new Map<string, RLMResult>()
  #verifications = new Map<string, RLMVerification>()

  save(task: RLMTask): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      this.#tasks.set(task.id, { ...task })
    })
  }

  load(id: RLMTaskID): Effect.Effect<RLMTask | null, never, never> {
    return Effect.sync(() => this.#tasks.get(id) ?? null)
  }

  listChildren(parentID: RLMTaskID): Effect.Effect<RLMTask[], never, never> {
    return Effect.sync(() =>
      Array.from(this.#tasks.values()).filter((t) => t.parentID === parentID),
    )
  }

  updatePhase(id: RLMTaskID, phase: RLMTaskPhase): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      const task = this.#tasks.get(id)
      if (task) task.phase = phase
    })
  }

  saveResult(id: RLMTaskID, result: RLMResult): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      this.#results.set(id, result)
      const task = this.#tasks.get(id)
      if (task) {
        task.result = result
        task.phase = "completed"
        task.completedAt = Date.now()
      }
    })
  }

  saveVerification(id: RLMTaskID, verification: RLMVerification): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      this.#verifications.set(id, verification)
    })
  }
}

// --- Service ---

export class Service extends Context.Service<Service, Interface>()("@opencode/RLM/Repository") {}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(new InMemoryRepository())),
)

/**
 * When the database schema is ready (Phase 3+), replace InMemoryRepository
 * with a Drizzle-backed implementation that maps to a `rlm_task` table:
 *
 *   drizzleTable("rlm_task", {
 *     id: text("id").primaryKey(),
 *     parent_id: text("parent_id"),
 *     session_id: text("session_id").notNull(),
 *     description: text("description"),
 *     prompt: text("prompt"),
 *     depth: integer("depth").notNull().default(0),
 *     phase: text("phase").notNull().default("pending"),
 *     status: text("status"),
 *     output: text("output"),
 *     usage_json: text("usage_json"),
 *     verification_json: text("verification_json"),
 *     reinvestigation_count: integer("reinvestigation_count").default(0),
 *     created_at: integer("created_at").notNull(),
 *     completed_at: integer("completed_at").default(0),
 *   })
 */