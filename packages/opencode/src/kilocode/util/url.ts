/**
 * Normalize any http/https URLs in a string so that IDN/Unicode hostnames are
 * converted to their punycode ASCII form, preventing homograph attacks in
 * permission dialogs where visually identical Unicode characters (e.g. Cyrillic
 * 'а' U+0430) could impersonate trusted domains (e.g. 'apitest.com').
 *
 * Example: "curl https://аpitest.com/status" (Cyrillic а)
 *       → "curl https://xn--pitest-2nf.com/status"
 *
 * Trailing sentence punctuation (. , ! ? ; :) that \S+ would otherwise consume
 * into the URL match is stripped before parsing and left in place afterward, so
 * plain-text prose like "see https://example.com." is returned unchanged.
 *
 * Only the hostname is replaced, not the full href, to avoid side-effects such
 * as new URL() appending a trailing slash to bare origins.
 */
export function normalizeUrls(text: string) {
  return text.replace(/https?:\/\/\S+/g, (match) => {
    // Strip trailing sentence punctuation that \S+ greedily consumes but that
    // is almost certainly not part of the URL (e.g. "visit https://x.com.").
    const stripped = match.replace(/[.,!?;:)"'\]>]+$/, "")
    const tail = match.slice(stripped.length)
    try {
      const parsed = new URL(stripped)
      // Extract the raw hostname from the stripped string so we can replace
      // only that part — using href would add a trailing slash to bare origins.
      const afterScheme = stripped.indexOf("//") + 2
      const slashPos = stripped.indexOf("/", afterScheme)
      const rawHost = slashPos === -1 ? stripped.slice(afterScheme) : stripped.slice(afterScheme, slashPos)
      const colon = rawHost.indexOf(":")
      const rawHostname = colon === -1 ? rawHost : rawHost.slice(0, colon)
      if (rawHostname === parsed.hostname) return match // plain ASCII — nothing to change
      return stripped.replace(rawHostname, parsed.hostname) + tail
    } catch {
      return match
    }
  })
}
