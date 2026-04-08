// devilcode_change new file
import { RGBA } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"

// "The Edge" font from patorjk.com/software/taag
const ASCII_LOGO = [
  `██▄   ▄███▄      ▄   ▄█ █     ▄█▄    ████▄ ██▄   ▄███▄  `,
  `█  █  █▀   ▀      █  ██ █     █▀ ▀▄  █   █ █  █  █▀   ▀ `,
  `█   █ ██▄▄   █     █ ██ █     █   ▀  █   █ █   █ ██▄▄   `,
  `█  █  █▄   ▄▀ █    █ ▐█ ███▄  █▄  ▄▀ ▀████ █  █  █▄   ▄▀`,
  `███▀  ▀███▀    █  █   ▐     ▀ ▀███▀        ███▀  ▀███▀   `,
  `                █▐                                        `,
  `                ▐                                         `,
]

export function DevilLogo() {
  const { theme } = useTheme()
  const yellow = RGBA.fromHex("#F8F675")

  return (
    <box>
      <For each={ASCII_LOGO}>
        {(line) => (
          <box flexDirection="row">
            <text fg={yellow} selectable={false}>
              {line}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
