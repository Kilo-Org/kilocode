// kilocode_change new file
import { RGBA } from "@opentui/core"

const ASCII_LOGO = `
⢰⣶⠀⠀⣶⡆⢰⣶⣶⣄⠀⠀⢰⣶⠀⠀⣶⡄⠀⠀⣴⣶⣦⡀      ⢰⣶⣶⣶⣄⠀⠀⢰⣶⠀⠀   ⢰⣶⣶⣄⠀⠀
⢸⣿⠿⠿⣦⡀⠀⠀⢸⣿⠀⠀⢸⣿⠀⠀⠀⠀⢰⣿⠁⠀⣿⡇     ⢸⣿⠀⠀⠀⠀⠀⠀⢸⣿⠀⠀⠀⠀⠀⠀ ⢸⣿⠀⠀
⠸⠿⠀⠀⠿⠃⠘⠿⠿⠿⠿⠇⠘⠿⠿⠿⠿⠇⠈⠻⠿⠿⠀       ⢰⣶⣶⣶⣦⠀⠀⠘⠿⠿⠿⠿⠇ ⠘⠿⠿⠿⠿⠇
`

export function KiloLogo() {
  const yellow = RGBA.fromHex("#F8F675")

  return (
    <box>
      <text fg={yellow} selectable={false}>
        {ASCII_LOGO}
      </text>
    </box>
  )
}
