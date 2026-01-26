// kilocode_change new file
import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, Show } from "solid-js"

// Bordered box logo with "KILO" and "CODE" inside (~20 chars wide)
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

// Large block letters "Kilo Code" (~80 chars wide)
const BIG_TEXT = ` █████   ████  ███  ████                █████████               █████
░░███   ███░  ░░░  ░░███               ███░░░░░███             ░░███
 ░███  ███    ████  ░███   ██████     ███     ░░░   ██████   ███████   ██████
 ░███████    ░░███  ░███  ███░░███   ░███          ███░░███ ███░░███  ███░░███
 ░███░░███    ░███  ░███ ░███ ░███   ░███         ░███ ░███░███ ░███ ░███████
 ░███ ░░███   ░███  ░███ ░███ ░███   ░░███     ███░███ ░███░███ ░███ ░███░░░
 █████ ░░████ █████ █████░░██████     ░░█████████ ░░██████ ░░████████░░██████
░░░░░   ░░░░ ░░░░░ ░░░░░  ░░░░░░       ░░░░░░░░░   ░░░░░░   ░░░░░░░░  ░░░░░░ `

export function KiloLogo() {
  const yellow = RGBA.fromHex("#F8F675")
  const dimensions = useTerminalDimensions()
  const columns = createMemo(() => dimensions().width)

  // BIG_TEXT is ~80 chars wide, ASCII_LOGO is ~20 chars wide
  // Combined with gap of 4, they need ~104 chars
  // Show:
  // - < 85: Only ASCII_LOGO (bordered box)
  // - 85-109: Only BIG_TEXT (needs ~80 chars)
  // - >= 110: Both side by side

  return (
    <box flexDirection="row" alignItems="center" gap={4}>
      <Show when={columns() < 85}>
        <box flexDirection="column">
          <text fg={yellow} selectable={false}>
            {ASCII_LOGO}
          </text>
        </box>
      </Show>
      <Show when={columns() >= 85 && columns() < 110}>
        <box flexDirection="column">
          <text fg={yellow} selectable={false}>
            {BIG_TEXT}
          </text>
        </box>
      </Show>
      <Show when={columns() >= 110}>
        <box flexDirection="column">
          <text fg={yellow} selectable={false}>
            {ASCII_LOGO}
          </text>
        </box>
        <box flexDirection="column">
          <text fg={yellow} selectable={false}>
            {BIG_TEXT}
          </text>
        </box>
      </Show>
    </box>
  )
}
