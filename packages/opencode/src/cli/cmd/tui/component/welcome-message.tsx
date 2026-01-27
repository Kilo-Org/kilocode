// kilocode_change - new file
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { KiloLogo } from "./kilo-logo"

const INSTRUCTIONS = [
  "Type a message to start chatting, or use /help to see available commands.",
  "Commands start with / (e.g., /help, /model)",
]

export function WelcomeMessage() {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" gap={2} alignItems="center">
      <KiloLogo />
      <box flexDirection="column" alignItems="center">
        <For each={INSTRUCTIONS}>{(instruction) => <text fg={theme.textMuted}>{instruction}</text>}</For>
      </box>
    </box>
  )
}
