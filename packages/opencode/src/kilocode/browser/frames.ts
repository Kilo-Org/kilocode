/**
 * Frame scoping for the Playwright backend, applied to tool output text.
 *
 * The upstream snapshot renders each iframe as `- iframe [ref=eN]` and nests the
 * frame's snapshot under it. A frame whose origin has no `read` grant keeps its
 * node and loses its subtree, so the model learns a frame is there without
 * learning what is inside it.
 */

import { BrowserPermission } from "./permission"

export type Ref = { ref: string; indent: number }

const IFRAME = /^(\s*)- iframe(?:\s|$)/

/** Every iframe node in the text, in document order. */
export function iframes(text: string): Ref[] {
  const result: Ref[] = []
  for (const line of text.split("\n")) {
    const match = IFRAME.exec(line)
    if (!match) continue
    const ref = /\[ref=([^\]\s]+)\]/.exec(line)?.[1]
    if (!ref) continue
    result.push({ ref, indent: match[1].length })
  }
  return result
}

/**
 * Replace the subtree of each iframe whose origin is withheld with
 * `- iframe [origin withheld: <origin>]`. `origins` maps a snapshot ref to its
 * frame origin; refs absent from the map are left untouched (unresolved iframe).
 */
export function snapshot(text: string, origins: ReadonlyMap<string, string>, granted: (origin: string) => boolean): string {
  const lines = text.split("\n")
  const out: string[] = []
  // Indentation of the iframe whose children are being dropped, or -1.
  let skipping = -1
  for (const line of lines) {
    const indent = line.length - line.trimStart().length
    if (skipping >= 0) {
      if (line.trim() === "" || indent > skipping) continue
      skipping = -1
    }
    const match = IFRAME.exec(line)
    const ref = match ? /\[ref=([^\]\s]+)\]/.exec(line)?.[1] : undefined
    const origin = ref ? origins.get(ref) : undefined
    if (match && origin && !granted(origin)) {
      out.push(`${match[1]}- iframe [origin withheld: ${origin}]`)
      skipping = indent
      continue
    }
    out.push(line)
  }
  return out.join("\n")
}

/** Console lines end with ` @ <url>:<line>`, which names the frame that logged them. */
export function consoleMessages(text: string, withheld: ReadonlySet<string>): string {
  return text
    .split("\n")
    .filter((line) => {
      const url = / @ (\S+?):\d+$/.exec(line)?.[1]
      if (!url) return true
      return !withheld.has(BrowserPermission.origin(url) ?? "")
    })
    .join("\n")
}

/** Network lines expose request URLs; a withheld origin's traffic leaves with its frame. */
export function networkRequests(text: string, withheld: ReadonlySet<string>): string {
  return text
    .split("\n")
    .filter((line) => {
      if (!/^\d+\. /.test(line)) return true
      const url = /(https?:\/\/\S+)/.exec(line)?.[1]
      if (!url) return true
      return !withheld.has(BrowserPermission.origin(url) ?? "")
    })
    .join("\n")
}
