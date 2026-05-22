// kilocode_change - new file
/**
 * Write escape sequences to disable all mouse tracking modes and reset terminal state.
 * This is a safety net to ensure the terminal is clean after exit, even if the renderer's
 * cleanup didn't flush properly (e.g. on Windows).
 */
export function resetTerminalState() {
  const sequences = [
    "\x1b[?1000l", // disable normal mouse tracking
    "\x1b[?1002l", // disable button-event mouse tracking
    "\x1b[?1003l", // disable any-event mouse tracking (all movement)
    "\x1b[?1006l", // disable SGR extended mouse mode
    "\x1b[?1015l", // disable RXVT mouse mode
    "\x1b[<u", // pop/disable Kitty keyboard protocol
    "\x1b[0m", // reset text attributes
  ]
  try {
    process.stdout.write(sequences.join(""))
  } catch (err) {
    console.error("resetTerminalState failed", err)
  }
}
