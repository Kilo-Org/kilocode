import fs from "node:fs"

/**
 * Write escape sequences to disable terminal input modes and reset terminal state.
 * This is a safety net to ensure the terminal is clean after exit, even if the renderer's
 * cleanup didn't flush properly (e.g. on Windows).
 */
function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export function kitty() {
  if (truthy("KILO_DISABLE_KITTY_KEYBOARD")) return false
  if (truthy("KILO_ENABLE_KITTY_KEYBOARD")) return true

  const term = process.env.TERM_PROGRAM?.toLowerCase()
  const system = process.env.MSYSTEM?.toLowerCase()

  if (term === "mintty") return false
  if (system) return false

  return true
}

export function sequences() {
  return [
    "\x1b[?9l", // disable X10 mouse tracking
    "\x1b[?1000l", // disable normal mouse tracking
    "\x1b[?1001l", // disable highlight mouse tracking
    "\x1b[?1002l", // disable button-event mouse tracking
    "\x1b[?1003l", // disable any-event mouse tracking (all movement)
    "\x1b[?1005l", // disable UTF-8 extended mouse mode
    "\x1b[?1006l", // disable SGR extended mouse mode
    "\x1b[?1007l", // disable alternate scroll mode
    "\x1b[?1015l", // disable RXVT mouse mode
    "\x1b[?1016l", // disable SGR pixel mouse mode
    "\x1b[?2004l", // disable bracketed paste
    "\x1b[?1004l", // disable focus tracking
    "\x1b[?1l", // disable application cursor keys
    "\x1b>", // disable application keypad mode
    "\x1b[?66l", // disable numeric keypad application mode
    "\x1b[>4;0m", // reset xterm modifyOtherKeys
    ...(kitty() ? ["\x1b[<u"] : []), // pop/disable Kitty keyboard protocol
    "\x1b[?25h", // show cursor
    "\x1b[0m", // reset text attributes
  ]
}

export function resetTerminalState() {
  try {
    fs.writeSync(process.stdout.fd, sequences().join(""))
  } catch (err) {
    console.error("resetTerminalState failed", err)
  }
}
