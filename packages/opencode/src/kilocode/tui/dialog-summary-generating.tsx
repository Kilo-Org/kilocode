import { useTheme } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"

export function DialogSummaryGenerating() {
  const { theme } = useTheme()
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} alignItems="center">
      <Spinner color={theme.textMuted}>Generating summary…</Spinner>
    </box>
  )
}
