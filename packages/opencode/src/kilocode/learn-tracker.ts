// kilocode_change - new file
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Storage } from "../storage/storage"
import { Lock } from "../util/lock"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

const log = Log.create({ service: "learn-tracker" })

export namespace LearnTracker {
  export const Category = z.enum(["comprehension", "reasoning", "system", "edge"])

  export const Quality = z.enum(["correct", "partial", "wrong", "skipped"])

  export const Check = z
    .object({
      id: z.string(),
      question: z.string(),
      category: Category,
      quality: Quality,
      concepts: z.array(z.string()).describe("Concepts or identifiers referenced in this check"),
      timestamp: z.number(),
    })
    .meta({ ref: "LearnCheck" })
  export type Check = z.infer<typeof Check>

  export const State = z
    .object({
      checks: z.array(Check),
      level: z.enum(["beginner", "intermediate", "advanced"]),
    })
    .meta({ ref: "LearnState" })
  export type State = z.infer<typeof State>

  export const Event = {
    Updated: BusEvent.define(
      "learn.updated",
      z.object({
        sessionID: z.string(),
        state: State,
      }),
    ),
  }

  function empty(): State {
    return { checks: [], level: "intermediate" }
  }

  export async function get(sessionID: string): Promise<State> {
    return Storage.read<State>(["learn", sessionID])
      .then((x) => x || empty())
      .catch(() => empty())
  }

  export async function record(input: { sessionID: string; check: Omit<Check, "id" | "timestamp"> }) {
    using _ = await Lock.write(`learn:${input.sessionID}`)
    const current = await get(input.sessionID)
    const now = Date.now()
    const check: Check = {
      ...input.check,
      id: `chk_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
    }
    current.checks.push(check)
    current.level = calibrate(current.checks)
    await Storage.write(["learn", input.sessionID], current)
    await appendAggregate({ sessionID: input.sessionID, check }).catch((err) => {
      log.info("aggregate write skipped", { err })
    })
    Bus.publish(Event.Updated, { sessionID: input.sessionID, state: current })
    return current
  }

  export async function clear(sessionID: string) {
    using _ = await Lock.write(`learn:${sessionID}`)
    const state = empty()
    await Storage.write(["learn", sessionID], state)
    Bus.publish(Event.Updated, { sessionID, state })
  }

  function calibrate(checks: Check[]): State["level"] {
    const recent = checks.slice(-5)
    if (recent.length === 0) return "intermediate"
    const wrong = recent.filter((c) => c.quality === "wrong").length
    const correct = recent.filter((c) => c.quality === "correct").length
    if (wrong >= 2) return "beginner"
    if (correct >= 4) return "advanced"
    return "intermediate"
  }

  export function summary(state: State) {
    const understood = state.checks.filter((c) => c.quality === "correct").flatMap((c) => c.concepts)
    const skipped = state.checks.filter((c) => c.quality === "skipped").flatMap((c) => c.concepts)
    const gaps = state.checks.filter((c) => c.quality === "wrong" || c.quality === "partial").flatMap((c) => c.concepts)

    return {
      understood: [...new Set(understood)],
      skipped: [...new Set(skipped)],
      gaps: [...new Set(gaps)],
      total: state.checks.length,
      level: state.level,
    }
  }

  // --- Cross-session aggregate ---

  export const AggregateCheck = Check.extend({
    sessionID: z.string(),
  }).meta({ ref: "LearnAggregateCheck" })
  export type AggregateCheck = z.infer<typeof AggregateCheck>

  export const Aggregate = z
    .object({
      checks: z.array(AggregateCheck),
      level: z.enum(["beginner", "intermediate", "advanced"]),
      sessions: z.number().describe("Number of sessions with learn data"),
    })
    .meta({ ref: "LearnAggregate" })
  export type Aggregate = z.infer<typeof Aggregate>

  function emptyAggregate(): Aggregate {
    return { checks: [], level: "intermediate", sessions: 0 }
  }

  function aggregateKey() {
    return ["learn_aggregate", Instance.project.id]
  }

  export async function getAggregate(): Promise<Aggregate> {
    return Storage.read<Aggregate>(aggregateKey())
      .then((x) => x || emptyAggregate())
      .catch(() => emptyAggregate())
  }

  const MAX_AGGREGATE_CHECKS = 500

  export async function appendAggregate(input: { sessionID: string; check: Check }) {
    using _ = await Lock.write("learn:aggregate")
    const current = await getAggregate()
    const entry: AggregateCheck = { ...input.check, sessionID: input.sessionID }
    current.checks.push(entry)
    if (current.checks.length > MAX_AGGREGATE_CHECKS) current.checks = current.checks.slice(-MAX_AGGREGATE_CHECKS)
    current.level = calibrate(current.checks)
    const ids = new Set(current.checks.map((c) => c.sessionID))
    current.sessions = ids.size
    await Storage.write(aggregateKey(), current)
    return current
  }

  export async function clearAggregate() {
    using _ = await Lock.write("learn:aggregate")
    const state = emptyAggregate()
    await Storage.write(aggregateKey(), state)
    return state
  }
}
