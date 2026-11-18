/**
 * The CLI's built-in browser grant, mirrored for the host and the Settings panel. The plugin
 * (`packages/kilo-plugin/src/browser/permission.ts`) allows the localhost family for every class and asks for every
 * other origin; the extension cannot import the plugin, so this copy is the single mirror and a test pins it to the
 * plugin's own `defaultGrant`.
 */

/** The hosts the CLI allows without a rule: `localhost`, `127.0.0.1`, `*.localhost` and the IPv6 loopback. */
const LOCALHOST: Record<string, true> = { localhost: true, "127.0.0.1": true, "[::1]": true, "::1": true }

/**
 * Whether the CLI grants every class on this origin without asking. A port is part of the origin and is ignored here,
 * because the rule binds the host; a value the URL parser refuses is not a localhost origin.
 */
export function defaultAllow(origin: string): boolean {
  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    return false
  }
  return LOCALHOST[host] === true || host.endsWith(".localhost")
}
