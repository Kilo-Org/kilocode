// kilocode_change - new file
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Storage } from "../storage/storage"

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
    const current = await get(input.sessionID)
    const check: Check = {
      ...input.check,
      id: `chk_${Date.now().toString(36)}`,
      timestamp: Date.now(),
    }
    current.checks.push(check)
    current.level = calibrate(current.checks)
    await Storage.write(["learn", input.sessionID], current)
    Bus.publish(Event.Updated, { sessionID: input.sessionID, state: current })
    return current
  }

  export async function clear(sessionID: string) {
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
}
