// kilocode_change - new file
import type { Config } from "@kilocode/sdk/v2"

const alertedAt = new Map<string, number>()
const COOLDOWN_MS = 5000

/** Strip control characters to prevent escape sequence injection in OSC payloads. */
const sanitize = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, "")

export function notify(title: string, body: string, config: Config, sessionID: string) {
  const now = Date.now()
  const last = alertedAt.get(sessionID) ?? 0
  if (now - last < COOLDOWN_MS) return

  // Prune stale entries to prevent unbounded growth of the alertedAt map
  for (const [key, time] of alertedAt) {
    if (now - time >= COOLDOWN_MS) alertedAt.delete(key)
  }

  alertedAt.set(sessionID, now)

  // bell and osc default to enabled (opt-out via `notifications.bell: false` / `notifications.osc: false`)
  const bell = config.tui?.notifications?.bell !== false
  const osc = config.tui?.notifications?.osc !== false

  if (bell) {
    process.stdout.write("\x07")
  }

  if (osc) {
    const safe = `${sanitize(title)}: ${sanitize(body)}`

    // OSC 9 is widely supported; terminals that don't understand it simply ignore it
    process.stdout.write(`\x1b]9;${safe}\x07`)

    // Kitty uses its own OSC 99 notification protocol
    if (process.env["TERM_PROGRAM"] === "kitty") {
      process.stdout.write(`\x1b]99;i=1:d=0;${safe}\x1b\\`)
    }
  }
}
