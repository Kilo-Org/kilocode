// kilocode_change - updated file
import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Match, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"

// Compact braille icon
const ASCII_LOGO = `⣿⡿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⢿⣿
⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿
⣿⡇⠀⠀⢰⣶⠀⠀⣶⡆⢰⣶⣶⣄⠀⠀⠀⠀⢸⣿
⣿⡇⠀⠀⢸⣿⠿⠿⣦⡀⠀⠀⢸⣿⠀⠀⠀⠀⢸⣿
⣿⡇⠀⠀⠸⠿⠀⠀⠿⠃⠘⠿⠿⠿⠿⠇⠀⠀⢸⣿
⣿⡇⠀⠀⢰⣶⠀⠀⣶⡄⠀⠀⣴⣶⣦⡀⠀⠀⢸⣿
⣿⡇⠀⠀⢸⣿⠀⠀⠀⠀⢰⣿⠁⠀⣿⡇⠀⠀⢸⣿
⣿⡇⠀⠀⠘⠿⠿⠿⠿⠇⠈⠻⠿⠿⠀⠀⠀⠀⢸⣿
⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿
⣿⣷⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣾⣿`

// Large ASCII text "Kilo Code"
const BIG_TEXT = ` █████   ████  ███  ████                █████████               █████
░░███   ███░  ░░░  ░░███               ███░░░░░███             ░░███
 ░███  ███    ████  ░███   ██████     ███     ░░░   ██████   ███████   ██████
 ░███████    ░░███  ░███  ███░░███   ░███          ███░░███ ███░░███  ███░░███
 ░███░░███    ░███  ░███ ░███ ░███   ░███         ░███ ░███░███ ░███ ░███████
 ░███ ░░███   ░███  ░███ ░███ ░███   ░░███     ███░███ ░███░███ ░███ ░███░░░
 █████ ░░████ █████ █████░░██████     ░░█████████ ░░██████ ░░████████░░██████
░░░░░   ░░░░ ░░░░░ ░░░░░  ░░░░░░       ░░░░░░░░░   ░░░░░░   ░░░░░░░░  ░░░░░░`

export function KiloLogo() {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const columns = createMemo(() => dimensions().width)

  // Use theme primary or fallback to Kilo yellow
  const logoColor = createMemo(() => theme.primary ?? RGBA.fromHex("#F8F675"))

  const LogoIcon = (
    <box flexDirection="column">
      <For each={ASCII_LOGO.split("\n")}>
        {(line) => (
          <text fg={logoColor()} selectable={false}>
            {line}
          </text>
        )}
      </For>
    </box>
  )

  const LogoBigText = (
    <box flexDirection="column">
      <For each={BIG_TEXT.split("\n")}>
        {(line) => (
          <text fg={logoColor()} selectable={false}>
            {line}
          </text>
        )}
      </For>
    </box>
  )

  // Responsive layout based on terminal width:
  // < 80 cols: icon only
  // < 104 cols: big text only
  // >= 104 cols: icon + big text
  return (
    <box flexDirection="row" alignItems="center" gap={4} justifyContent="flex-start">
      <Switch>
        <Match when={columns() < 80}>{LogoIcon}</Match>
        <Match when={columns() < 104}>{LogoBigText}</Match>
        <Match when={columns() >= 104}>
          {LogoIcon}
          {LogoBigText}
        </Match>
      </Switch>
    </box>
  )
}
