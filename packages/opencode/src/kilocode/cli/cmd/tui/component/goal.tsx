import { createMemo, Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useLocal } from "@tui/context/local"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"
import { errorMessage } from "@tui/util/error"

export namespace GoalPrompt {
  export function read(metadata?: Record<string, unknown> | null) {
    const goal = metadata?.["kilo.goal"]
    if (!goal || typeof goal !== "object" || !("text" in goal) || typeof goal.text !== "string" || !goal.text.trim())
      return undefined
    return { text: goal.text, active: "active" in goal && goal.active === true }
  }

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

  export function Row(props: {
    goal: ReturnType<typeof read>
    theme: { text: RGBA; textMuted: RGBA; success: RGBA }
    run: (action: "pause" | "resume" | "clear") => void
  }) {
    return (
      <Show when={props.goal}>
        {(goal) => (
          <box flexDirection="row" gap={1} height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
            <text fg={goal().active ? props.theme.success : props.theme.textMuted} flexShrink={0}>
              Goal {goal().active ? "active" : "paused"}
            </text>
            <text fg={props.theme.text} flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" truncate>
              {goal().text.replace(/\s+/g, " ").trim()}
            </text>
            <text
              fg={props.theme.textMuted}
              flexShrink={0}
              onMouseUp={() => props.run(goal().active ? "pause" : "resume")}
            >
              /goal {goal().active ? "pause" : "resume"}
            </text>
            <text fg={props.theme.textMuted} flexShrink={0} onMouseUp={() => props.run("clear")}>
              /goal clear
            </text>
          </box>
        )}
      </Show>
    )
  }
}

export function GoalRow(props: { sessionID: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const local = useLocal()
  const toast = useToast()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const goal = createMemo(() => GoalPrompt.read(session()?.metadata))

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

  return <GoalPrompt.Row goal={goal()} theme={theme} run={run} />
}
