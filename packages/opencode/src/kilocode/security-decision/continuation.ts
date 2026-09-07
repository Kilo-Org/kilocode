// kilocode_change - new file
import { SecurityBlocked } from "./block"

/**
 * Turn continuation policy for the deterministic security layer.
 *
 * A security block stops the *call*, not the turn: the tool never ran, the model gets a fixed
 * result naming only the rule id, and it keeps its turn to choose another allowed path. Re-issuing
 * the identical call is not another path, so the second identical block ends the turn instead of
 * spinning. This is scoped to security blocks alone — an ordinary rejection keeps the existing
 * `continue_loop_on_deny` rule.
 *
 * Distinctness is not enough on its own, though. A model that answers every refusal with a fresh
 * spelling of the same intent is working around the policy rather than adapting to it, and the
 * per-signature rule never fires because no two attempts are identical. So a run of blocks is also
 * counted, and past a point the turn ends rather than let the enumeration continue.
 *
 * What is counted is a *security block* — a deterministic policy refusal that stopped a call. The
 * reviewer's `keep_ask` is deliberately not counted: our reviewer can only narrow an ask into an
 * allow, so declining to narrow one is the default answer to a question, not a refusal to hold
 * against the model.
 */
export namespace SecurityContinuation {
  /**
   * Where the breaker trips.
   *
   * `consecutive: 3` — the first block tells the model a path is closed and the second is a genuine
   * alternative, but a third distinct refusal with nothing successful in between is no longer
   * exploration. `recent: 5` in a `window: 20` catches the same behaviour spread thin: a block every
   * few successful calls never accumulates consecutively, and without a density rule it could run
   * for the whole turn. Both are chosen for what a *deterministic* refusal means here — unlike a
   * model-produced denial, it is never a false positive about the action's shape.
   */
  export type Limits = Readonly<{ consecutive: number; window: number; recent: number }>

  export const LIMITS: Limits = { consecutive: 3, window: 20, recent: 5 }

  export type State = {
    /** Signatures of the calls already blocked in this turn. */
    readonly signatures: Set<string>
    readonly limits: Limits
    consecutive: number
    /** One entry per settled call, newest last: `true` for a block. Bounded to `limits.window`. */
    readonly recent: boolean[]
    interrupted: boolean
  }

  export type Outcome = "continue" | "stop" | "interrupt"

  export function state(limits: Partial<Limits> = {}): State {
    return {
      signatures: new Set<string>(),
      limits: { ...LIMITS, ...limits },
      consecutive: 0,
      recent: [],
      interrupted: false,
    }
  }

  /** Stable signature of a tool call: argument order must not make a repeat look like a new path. */
  export function signature(tool: string, input: unknown): string {
    return `${tool} ${stable(input)}`
  }

  function stable(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`
  }

  /** Whether this exact call was already blocked in this turn. */
  export function blocked(state: State, tool: string, input: unknown): boolean {
    return state.signatures.has(signature(tool, input))
  }

  function record(state: State, denied: boolean) {
    state.recent.push(denied)
    while (state.recent.length > state.limits.window) state.recent.shift()
  }

  /** A tool call settled without being blocked: the run of refusals is over. */
  export function succeeded(state: State) {
    state.consecutive = 0
    record(state, false)
  }

  /**
   * Outcome for a failed tool call, or `undefined` when the failure is not a security block and the
   * existing rule applies.
   */
  export function after(state: State, error: unknown, call: { tool: string; input: unknown }): Outcome | undefined {
    if (!SecurityBlocked.is(error)) return state.interrupted ? "interrupt" : undefined
    const key = signature(call.tool, call.input)
    if (state.interrupted) {
      state.signatures.add(key)
      return "interrupt"
    }
    // The identical call is not another path, and it is settled before the breaker sees it: an
    // attempt the model already made tells us nothing new about how hard it is pushing.
    if (state.signatures.has(key)) return "stop"
    state.signatures.add(key)

    state.consecutive += 1
    record(state, true)
    const density = state.recent.filter((denied) => denied).length
    if (!state.interrupted && (state.consecutive >= state.limits.consecutive || density >= state.limits.recent)) {
      state.interrupted = true
      return "interrupt"
    }
    return "continue"
  }
}
