// The Kilo session goal in the TUI: a status line under the prompt and a dialog with the objective and its
// pause, resume and clear controls. The state comes from the `kilocode.goal` RPC; the loop itself runs in the
// goal plugin of packages/kilo-plugin.
import { Plugin } from "@opencode/plugin/tui"
import { KiloGoalRpc } from "@opencode/schema/kilocode/goal"
import { createMemo, createSignal, onCleanup, on, Show, type Accessor } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogFooter, DialogHeader, DialogLayout, type DialogFooterAction } from "../ui/dialog"

/** The goal a client shows, kept current from the plugin's `changed` events and reloaded after a reconnect. */
function createGoal(context: Plugin.Context, sessionID: Accessor<string | undefined>) {
  const [goal, setGoal] = createSignal<KiloGoalRpc.State>()
  const rpc = context.client.rpc(KiloGoalRpc.Definition)
  const turn = { value: 0 }
  const load = (id: string) => {
    const current = ++turn.value
    const directory = context.data.session.get(id)?.location.directory
    void rpc.get({ sessionID: id }, directory ? { location: { directory } } : undefined).then(
      (next) => {
        if (current === turn.value && sessionID() === id) setGoal(next ?? undefined)
      },
      () => undefined,
    )
  }
  onCleanup(
    rpc.events.on("changed", (event) => {
      if (event.data.sessionID !== sessionID()) return
      turn.value++
      setGoal(event.data.goal ?? undefined)
    }),
  )
  onCleanup(
    context.data.on("server.connected", () => {
      const id = sessionID()
      if (id) load(id)
    }),
  )
  on(() => sessionID(), (id) => {
    setGoal(undefined)
    if (id) load(id)
  })
  return goal
}

function goalColor(theme: ReturnType<typeof useTheme>, goal: KiloGoalRpc.State) {
  if (goal.status === "paused" || goal.status === "blocked") return theme.text.feedback.warning.base
  if (goal.status === "complete") return theme.text.feedback.success.base
  if (goal.status === "waiting") return theme.text.feedback.info.base
  return theme.text.muted
}

function goalLabel(goal: KiloGoalRpc.State) {
  if (goal.status === "paused") return "goal paused"
  if (goal.status === "blocked") return "goal blocked"
  if (goal.status === "complete") return "goal met"
  if (goal.status === "waiting") return "goal waiting"
  return "goal"
}

export function GoalStatus(props: {
  context: Plugin.Context
  sessionID: string
  goal: Accessor<KiloGoalRpc.State | undefined>
}) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const color = (current: KiloGoalRpc.State) => (hovered() ? theme.text.base : goalColor(theme, current))

  return (
    <Show when={props.goal()}>
      {(current) => (
        <box
          flexShrink={0}
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
          onMouseUp={() => showGoal(props.context, props.sessionID, props.goal)}
        >
          <text fg={color(current())} wrapMode="none">
            ◎ {goalLabel(current())}
          </text>
        </box>
      )}
    </Show>
  )
}

function showGoal(context: Plugin.Context, sessionID: string, goal: Accessor<KiloGoalRpc.State | undefined>) {
  if (!goal()) {
    context.ui.toast.show({ message: "No goal is set. Start one with /goal <objective>.", variant: "info" })
    return
  }
  context.ui.dialog.show(() => <GoalDialog context={context} sessionID={sessionID} goal={goal} />)
}

function GoalDialog(props: {
  context: Plugin.Context
  sessionID: string
  goal: Accessor<KiloGoalRpc.State | undefined>
}) {
  const theme = useTheme().surface("dialog")
  const goal = props.goal
  const run = (text: "pause" | "resume" | "clear") => {
    if (text === "clear") props.context.ui.dialog.clear()
    void props.context.client.session.command({ sessionID: props.sessionID, name: "goal", text }).catch((error) =>
      props.context.ui.toast.show({
        title: "Failed to update the goal",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      }),
    )
  }
  const actions = createMemo((): DialogFooterAction[] => {
    const current = goal()
    if (!current) return []
    return [
      ...(current.status === "active" || current.status === "waiting"
        ? [{ title: "pause", key: "p", onTrigger: () => run("pause") }]
        : [{ title: current.status === "complete" ? "restart" : "resume", key: "r", onTrigger: () => run("resume") }]),
      { title: "clear", key: "x", onTrigger: () => run("clear") },
    ]
  })

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "p",
        title: "Pause goal",
        group: "Dialog",
        enabled: goal()?.status === "active" || goal()?.status === "waiting",
        run: () => run("pause"),
      },
      {
        bind: "r",
        title: "Resume goal",
        group: "Dialog",
        enabled: goal() !== undefined && goal()?.status !== "active" && goal()?.status !== "waiting",
        run: () => run("resume"),
      },
      { bind: "x", title: "Clear goal", group: "Dialog", enabled: goal() !== undefined, run: () => run("clear") },
    ],
  }))

  return (
    <Show when={goal()}>
      {(current) => (
        <DialogLayout
          header={<DialogHeader title="Goal" />}
          footer={{ actions: { primary: actions() } }}
          legacyFooter={<DialogFooter actions={{ primary: actions() }} />}
        >
          <box gap={1}>
            <text fg={theme.text.base}>{current().text}</text>
            <box>
              <text fg={goalColor(theme, current())} wrapMode="none">
                ◎ {current().status === "active" ? "Active" : goalLabel(current())}
              </text>
              <Show when={current().reason}>{(reason) => <text fg={theme.text.muted}>{reason()}</text>}</Show>
              <Show when={current().wait}>
                {(wait) => (
                  <text fg={theme.text.muted}>
                    Waiting for {wait().kind} {wait().label}
                  </text>
                )}
              </Show>
            </box>
          </box>
        </DialogLayout>
      )}
    </Show>
  )
}

export default Plugin.define({
  id: "kilocode.goal",
  setup(context) {
    context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => {
        const goal = createGoal(context, () => props.sessionID)
        return (
          <Show when={props.mode === "normal" && props.sessionID}>
            {(sessionID) => <GoalStatus context={context} sessionID={sessionID()} goal={goal} />}
          </Show>
        )
      },
    })
  },
})