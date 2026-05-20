/**
 * puny.ts — Normalize IDN/Unicode URLs to punycode ASCII (anti-homograph)
 * Zero deps. Uses URL built-in.
 *
 * norm("https://аpitest.com/path") → "https://xn--pitest-2nf.com/path"
 */
export function norm(text: string): string {
  return text.replace(/https?:\/\/\S+/g, (match) => {
    const stripped = match.replace(/[.,!?;:)"'\]>]+$/, "")
    const tail = match.slice(stripped.length)
    try {
      const u = new URL(stripped)
      const after = stripped.indexOf("//") + 2
      const slash = stripped.indexOf("/", after)
      const raw = slash === -1 ? stripped.slice(after) : stripped.slice(after, slash)
      const host = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw
      if (host === u.hostname) return match
      return stripped.replace(host, u.hostname) + tail
    } catch { return match }
  })
}
