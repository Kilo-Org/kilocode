import { createMemo, Show } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { errorMessage } from "@tui/util/error"
import { GoalState } from "@/kilocode/session/goal-state"

export namespace GoalPrompt {
  export const read = GoalState.read

  export function feedback(
    command: string,
    args: string,
    result: { data?: { parts: { type: string; text?: string }[] }; error?: unknown },
    toast: Pick<ReturnType<typeof useToast>, "show">,
  ) {
    if (command !== "goal") return
    if (result.error) {
      toast.show({ title: "Goal command failed", message: errorMessage(result.error), variant: "error" })
      return
    }
    if (args.trim()) return
    const message = result.data?.parts
      .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
      .join("\n")
    if (message) toast.show({ title: "Goal", message, variant: "info" })
  }

  export function Row(props: { goal: ReturnType<typeof read>; run: (action: "pause" | "resume" | "clear") => void }) {
    const dialog = useDialog()
    const { theme } = useTheme()
    return (
      <Show when={props.goal}>
        <text
          alignSelf="flex-start"
          fg={props.goal?.active ? theme.success : theme.textMuted}
          flexShrink={0}
          onMouseUp={() =>
            dialog.replace(() => (
              <DialogSelect<"pause" | "resume" | "clear">
                title={`Goal ${props.goal?.active ? "active" : "paused"}`}
                renderFilter={false}
                options={[
                  {
                    title: props.goal?.active ? "Pause" : "Resume",
                    description: props.goal?.text.replace(/\s+/g, " ").trim(),
                    value: props.goal?.active ? "pause" : "resume",
                  },
                  { title: "Clear", value: "clear" },
                ]}
                onSelect={(option) => {
                  dialog.clear()
                  props.run(option.value)
                }}
              />
            ))
          }
        >
          Goal {props.goal?.active ? "active" : "paused"} ▾
        </text>
      </Show>
    )
  }
}

export function GoalRow(props: { sessionID: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const local = useLocal()
  const toast = useToast()
  const session = createMemo(() => sync.session.get(props.sessionID))

  function run(action: "pause" | "resume" | "clear") {
    const model = local.model.current()
    void sdk.client.session
      .command(
        {
          sessionID: props.sessionID,
          directory: session()?.directory,
          workspace: session()?.workspaceID,
          command: "goal",
          arguments: action,
          ...(action === "resume" && {
            agent: local.agent.current()?.name,
            model: model ? `${model.providerID}/${model.modelID}` : undefined,
            variant: local.model.variant.current(),
          }),
        },
        { throwOnError: true },
      )
      .catch((err) => toast.show({ title: "Goal command failed", message: errorMessage(err), variant: "error" }))
  }

  return <GoalPrompt.Row goal={GoalPrompt.read(session()?.metadata)} run={run} />
}
