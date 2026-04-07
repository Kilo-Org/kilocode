import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"

export function ReviewTab() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  function severityColor(severity: string) {
    switch (severity) {
      case "blocker":
        return theme.error
      case "warning":
        return theme.warning
      case "suggestion":
        return theme.info
      default:
        return theme.text
    }
  }

  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Show
        when={wf.review}
        fallback={
          <text fg={theme.textMuted}>
            No review results yet. Run "review" after building.
          </text>
        }
      >
        {(review) => (
          <box flexDirection="column">
            <box flexDirection="row" gap={2} marginBottom={1}>
              <text
                fg={review().verdict === "pass" ? theme.success : theme.error}
                attributes={TextAttributes.BOLD}
              >
                {"Verdict: " + review().verdict.toUpperCase()}
              </text>
              <text fg={theme.textMuted}>
                {"Cycle " + review().cycle + " │ " + review().blockerCount + " blockers │ " + review().warningCount + " warnings │ " + review().suggestionCount + " suggestions"}
              </text>
            </box>
            <Show when={review().findings.length > 0}>
              <For each={review().findings}>
                {(finding) => (
                  <box flexDirection="column" marginBottom={1} paddingLeft={2}>
                    <text fg={severityColor(finding.severity)}>
                      {finding.id + " [" + finding.severity.toUpperCase() + "] " + finding.category}
                    </text>
                    <text fg={theme.text} wrapMode="word" width="100%">
                      {finding.description}
                    </text>
                    <text fg={theme.textMuted}>
                      {"File: " + finding.file + (finding.line ? ":" + finding.line : "")}
                    </text>
                    <Show when={finding.suggestedFix}>
                      <text fg={theme.textMuted}>{"Fix: " + finding.suggestedFix}</text>
                    </Show>
                  </box>
                )}
              </For>
            </Show>
            <text fg={theme.text} wrapMode="word" width="100%" marginTop={1}>
              {review().summary}
            </text>
          </box>
        )}
      </Show>
    </scrollbox>
  )
}
