export * as KiloLogo from "./logo-art"

export const palette = { ink: "#FFDD00", dim: "#736400" }

const modern = [
  "██  ██ ██🬺🬏   ██  ██   ██🬺🬏     ████ ██     ██🬺🬏   ",
  "████🬺🬏 ~~██   ██  ~~ ██~~██   ██~~~~ ██     ~~██   ",
  "██  ██ ██████ 🬁🬬████ 🬁🬬██~~   🬁🬬████ 🬁🬬████ ██████ ",
  "~~  ~~ ~~~~~~   ~~~~   ~~       ~~~~   ~~~~ ~~~~~~ ",
]

const fallback = [
  "██  ██ ████   ██  ██   ██       ████ ██     ████   ",
  "████   ~~██   ██  ~~ ██~~██   ██~~~~ ██     ~~██   ",
  "██  ██ ██████ ██████   ██~~     ████   ████ ██████ ",
  "~~  ~~ ~~~~~~  ~~~~~   ~~       ~~~~   ~~~~ ~~~~~~ ",
]

export function supports(env = process.env, platform = process.platform) {
  const override = env.KILO_UNICODE_LOGO?.toLowerCase()
  if (override && ["1", "true", "yes", "on"].includes(override)) return true
  if (override && ["0", "false", "no", "off"].includes(override)) return false
  if (env.TERM === "dumb") return false
  if (platform === "win32")
    return Boolean(
      env.WT_SESSION || env.TERM_PROGRAM === "vscode" || env.WEZTERM_PANE || env.TERM_PROGRAM === "WezTerm",
    )
  return !env.ConEmuPID && !env.ANSICON
}

export function art(env = process.env, platform = process.platform) {
  const selected = (supports(env, platform) ? modern : fallback).map((line, index) =>
    index === 2 ? `${line} v2` : line,
  )
  const logo = {
    left: selected.map((line) => Array.from(line).slice(0, 28).join("")),
    right: selected.map((line) => Array.from(line).slice(29).join("")),
  }
  const compact = selected.slice(0, 3).map((line) => Array.from(line).slice(0, 6).join(""))
  return {
    logo,
    compact,
    widths: {
      split: Math.max(
        ...logo.left.map((line) => Bun.stringWidth(line)),
        ...logo.right.map((line) => Bun.stringWidth(line)),
      ),
      full: Math.max(...selected.map((line) => Bun.stringWidth(line))),
    },
  }
}

const selected = art()
export const logo = selected.logo
export const compact = selected.compact
export const widths = selected.widths
