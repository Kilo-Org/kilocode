import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"

export function PlanTab() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Show
        when={wf.plans.length > 0}
        fallback={
          <text fg={theme.textMuted}>
            No plans yet. Type "plan" to start decomposition.
          </text>
        }
      >
        <For each={wf.plans}>
          {(plan) => (
            <box flexDirection="column" marginBottom={1}>
              <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                {"[" + plan.id + "] " + plan.title}
              </text>
              <text fg={theme.textMuted}>
                {"  Role: " + plan.role + " │ Wave: " + plan.wave + " │ Complexity: " + plan.estimatedComplexity}
              </text>
              <Show when={plan.files.length > 0}>
                <text fg={theme.textMuted}>
                  {"  Files: " + plan.files.join(", ")}
                </text>
              </Show>
              <text fg={theme.text} wrapMode="word" width="100%" paddingLeft={2}>
                {plan.description}
              </text>
            </box>
          )}
        </For>
      </Show>
    </scrollbox>
  )
}
