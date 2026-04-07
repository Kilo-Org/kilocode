import { For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"

export function ChallengeTab() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Show
        when={wf.challenge}
        fallback={
          <text fg={theme.textMuted}>
            No challenge results yet. Run "challenge" after planning.
          </text>
        }
      >
        {(challenge) => (
          <box flexDirection="column">
            <box flexDirection="row" gap={2} marginBottom={1}>
              <text
                fg={
                  challenge().verdict === "approved"
                    ? theme.success
                    : challenge().verdict === "reject"
                      ? theme.error
                      : theme.warning
                }
                attributes={{ bold: true }}
              >
                {"Verdict: " + challenge().verdict.toUpperCase()}
              </text>
            </box>
            <text fg={theme.text} wrapMode="word" width="100%" marginBottom={1}>
              {challenge().summary}
            </text>
            <Show when={challenge().concerns.length > 0}>
              <text fg={theme.text} attributes={{ bold: true }} marginBottom={1}>
                Concerns:
              </text>
              <For each={challenge().concerns}>
                {(concern) => (
                  <box flexDirection="column" marginBottom={1} paddingLeft={2}>
                    <text
                      fg={
                        concern.severity === "critical"
                          ? theme.error
                          : concern.severity === "moderate"
                            ? theme.warning
                            : theme.info
                      }
                    >
                      {"[" + concern.severity.toUpperCase() + "] " + concern.category}
                    </text>
                    <text fg={theme.text} wrapMode="word" width="100%">
                      {concern.description}
                    </text>
                    <text fg={theme.textMuted}>
                      {"Fix: " + concern.suggestedChange}
                    </text>
                    <Show when={concern.affectedTasks.length > 0}>
                      <text fg={theme.textMuted}>
                        {"Tasks: " + concern.affectedTasks.join(", ")}
                      </text>
                    </Show>
                  </box>
                )}
              </For>
            </Show>
            <Show when={challenge().alternativeApproach}>
              <text fg={theme.info} attributes={{ bold: true }}>
                Alternative Approach:
              </text>
              <text fg={theme.text} wrapMode="word" width="100%">
                {challenge().alternativeApproach}
              </text>
            </Show>
          </box>
        )}
      </Show>
    </scrollbox>
  )
}
