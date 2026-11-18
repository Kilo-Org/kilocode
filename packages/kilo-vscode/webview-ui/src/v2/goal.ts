// The `/goal` of the open session, on the goal plugin's `opencode.goal` RPC: fetched when the session changes or the
// server reconnects, since changes published meanwhile were missed, and kept current from its `changed` events. The
// same reader as the TUI's createGoal (packages/tui/src/feature-plugins/prompt/goal.tsx).
import { Goal } from "@opencode/schema/goal"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { useV2 } from "./client"

export type GoalState = Goal.State

export function createGoal(
  session: Accessor<string | undefined>,
  /** Runs before a control is sent, for example to commit the model the composer shows. */
  prepare?: (sessionID: string) => Promise<unknown>,
) {
  const v2 = useV2()
  const rpc = v2.api.rpc(Goal.Definition)
  const location = { directory: v2.directory }
  const [goal, setGoal] = createSignal<GoalState>()
  // A change that arrives while a fetch is in flight is newer than its reply, so each change or fetch takes a turn.
  let turn = 0
  const load = (id: string) => {
    const current = ++turn
    // A server without the goal plugin answers with an error, and the session shows no goal.
    void rpc.get({ sessionID: id }, { location }).then(
      (next) => {
        if (current === turn && session() === id) setGoal(next ?? undefined)
      },
      () => undefined,
    )
  }
  onCleanup(
    rpc.events.on("changed", (event) => {
      if (event.data.sessionID !== session()) return
      turn++
      setGoal(event.data.goal ?? undefined)
    }),
  )
  createEffect(
    on([session, v2.connection.status] as const, ([id, status], previous) => {
      if (id !== previous?.[0]) setGoal(undefined)
      if (id && status === "connected") load(id)
    }),
  )

  // Pause, resume and clear are the plugin's `/goal` controls. A complete goal restarts by setting its objective again.
  const control = (action: "pause" | "resume" | "clear" | "restart") => {
    const id = session()
    const current = goal()
    if (!id || !current) return
    // `--` keeps an objective that is itself a control word, such as "pause", an objective.
    const text = action === "restart" ? `-- ${current.objective}` : action
    // A resume or restart runs on the model the composer shows, as a sent prompt does.
    void Promise.resolve(action === "resume" || action === "restart" ? prepare?.(id) : undefined)
      .then(() => v2.api.session.command({ sessionID: id, name: "goal", text }))
      .catch(v2.report)
  }

  return {
    goal,
    /** A goal that keeps the session working: active, including while it waits on background work. */
    active: () => goal()?.status === "active",
    control,
  }
}

export type GoalSource = ReturnType<typeof createGoal>
