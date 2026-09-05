export const logo = {
  modern: {
    tui: [
      "██  ██ ██🬺🬏   ██  ██   ██🬺🬏     ████ ██     ██🬺🬏   ",
      "████🬺🬏 ~~██   ██  ~~ ██~~██   ██~~~~ ██     ~~██   ",
      "██  ██ ██████ 🬁🬬████ 🬁🬬██~~   🬁🬬████ 🬁🬬████ ██████ ",
      "~~  ~~ ~~~~~~   ~~~~   ~~       ~~~~   ~~~~ ~~~~~~ ",
    ],
    plain: [
      "██  ██ ██🬺🬏   ██  ██   ██🬺🬏     ████ ██     ██🬺🬏   ",
      "████🬺🬏   ██   ██     ██  ██   ██     ██       ██   ",
      "██  ██ ██████ 🬁🬬████ 🬁🬬██     🬁🬬████ 🬁🬬████ ██████ ",
    ],
    compact: [
      "  ██  ██ ██🬺🬏   ██  ██   ██🬺🬏  ",
      "  ████🬺🬏 ~~██   ██  ~~ ██~~██  ",
      "  ██  ██ ██████ 🬁🬬████ 🬁🬬██~~  ",
      "  ~~  ~~ ~~~~~~   ~~~~   ~~      ",
    ],
  },
  fallback: {
    tui: [
      "██  ██ ████   ██  ██   ██       ████ ██     ████   ",
      "████   ~~██   ██  ~~ ██~~██   ██~~~~ ██     ~~██   ",
      "██  ██ ██████ ██████   ██~~     ████   ████ ██████ ",
      "~~  ~~ ~~~~~~  ~~~~~   ~~       ~~~~   ~~~~ ~~~~~~ ",
    ],
    plain: [
      "██  ██ ████   ██  ██   ███      ████ ██     ████   ",
      "████     ██   ██     ██  ██   ██     ██       ██   ",
      "██  ██ ██████ ██████   ██       ████ ██████ ██████ ",
    ],
    compact: [
      "  ██  ██ ████   ██  ██   ██    ",
      "  ████   ~~██   ██  ~~ ██~~██  ",
      "  ██  ██ ██████ ██████   ██~~  ",
      "  ~~  ~~ ~~~~~~  ~~~~~   ~~    ",
    ],
  },
}

export function supports(env = process.env, platform = process.platform) {
  const override = env.KILO_UNICODE_LOGO?.toLowerCase()
  if (["1", "true", "yes", "on"].includes(override ?? "")) return true
  if (["0", "false", "no", "off"].includes(override ?? "")) return false
  if (env.TERM === "dumb") return false
  if (platform === "win32")
    return Boolean(
      env.WT_SESSION || env.TERM_PROGRAM === "vscode" || env.WEZTERM_PANE || env.TERM_PROGRAM === "WezTerm",
    )
  return !env.ConEmuPID && !env.ANSICON
}
