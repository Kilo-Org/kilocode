import { Plugin } from "@opencode/plugin/tui"

// kilo_port(cli:fd8272d869ad) activity packets for terminals that ask for them

/**
 * Publishes the activity of the session the TUI shows as OSC 777 packets on the terminal, so an embedding terminal
 * (the Agent Manager terminal tabs) can show whether the Kilo session running in that tab is working, waiting for input
 * or finished.
 *
 * Only enabled when the embedding terminal sets KILO_TERMINAL_ACTIVITY=1, because a normal terminal would print the
 * escape sequence into its own screen.
 */

export type State = "idle" | "busy" | "retry" | "waiting" | "error" | "done"

const ENABLED = "1"
// The reader drops a packet older than 15 seconds, so repeat the current state well inside that window.
export const HEARTBEAT = 5_000
const TICK = 1_000

export function format(state: State, timestamp = Date.now()) {
  return `\x1b]777;kilo;activity;1;${state};${timestamp}\x07`
}

/**
 * The activity of a session and its subagents. A waiting or running subagent lifts its root; a subagent that finished
 * does not.
 */
export function activity(data: Plugin.Context["data"], sessionID: string): State {
  const root = data.session.root(sessionID)
  const members = Array.from(new Set([root, ...data.session.family(root)]))
  const blocked = members.some(
    (id) => (data.session.permission.list(id)?.length ?? 0) > 0 || (data.session.form.list(id)?.length ?? 0) > 0,
  )
  if (blocked) return "waiting"
  const running = members.filter((id) => data.session.status(id) === "running")
  if (running.some((id) => data.session.message.list(id).some((item) => item.type === "assistant" && item.retry)))
    return "retry"
  if (running.length > 0) return "busy"
  if (members.some((id) => data.session.pending.list(id).some((item) => item.type !== "synthetic"))) return "busy"
  const info = data.session.get(root)
  if (info?.outcome === "failed") return "error"
  if (info?.outcome === "succeeded") return "done"
  return "idle"
}

/** Emits on every change and as a heartbeat, so a reader can drop stale packets by their stamp. */
export function createEmitter(input: {
  data: Plugin.Context["data"]
  session: () => string | undefined
  write: (packet: string) => void
  now?: () => number
}) {
  const now = input.now ?? Date.now
  let last: { state: State; at: number } | undefined
  const emit = (state: State, at: number) => input.write(format(state, at))
  const tick = () => {
    const id = input.session()
    const state = id ? activity(input.data, id) : "idle"
    const at = now()
    if (last?.state === state && at - last.at < HEARTBEAT) return
    emit(state, at)
    last = { state, at }
  }
  return { tick, stop: () => emit("idle", now()) }
}

export default Plugin.define({
  id: "kilocode.terminal-activity",
  setup(context) {
    if (process.env.KILO_TERMINAL_ACTIVITY !== ENABLED) return
    const emitter = createEmitter({
      data: context.data,
      session: () => {
        const route = context.ui.router.current()
        return route.type === "session" && route.sessionID !== "dummy" ? route.sessionID : undefined
      },
      write: (packet) => process.stdout.write(packet),
    })
    const timer = setInterval(emitter.tick, TICK)
    // Events reach the classifier data first, so report a change without waiting for the next tick.
    const off = context.data.listen(() => emitter.tick())
    emitter.tick()
    return () => {
      clearInterval(timer)
      off()
      emitter.stop()
    }
  },
})