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

const IFRAME = /^(\s*)- iframe(?:\s|:|$)/

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
 * Replace the subtree of each iframe whose origin is withheld, with
 * `- iframe [origin withheld: <origin>]`. `origins` maps a snapshot ref to its frame origin. A ref that does not
 * resolve, or an iframe node without a ref, is withheld as well: a frame whose origin cannot be determined cannot be
 * shown to be granted, so its subtree never leaves the backend.
 */
export function snapshot(
  text: string,
  origins: ReadonlyMap<string, string>,
  granted: (origin: string) => boolean,
): string {
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
    if (match && (origin === undefined || !granted(origin))) {
      // Keep the ref: the model needs it to request `read:<origin>` for this frame.
      const label = origin === undefined ? "[origin withheld]" : `[origin withheld: ${origin}]`
      out.push(`${match[1]}- iframe${ref ? ` [ref=${ref}]` : ""} ${label}`)
      skipping = indent
      continue
    }
    out.push(line)
  }
  return out.join("\n")
}

/**
 * Console lines end with ` @ <url>:<line>`, which names the frame that logged them. `allowed` is the set of origins
 * this session may read: with it, only a line attributed to a granted origin is kept, and a line whose URL has no
 * http(s) origin (`blob:` script, `data:` document) is dropped because no frame can be found for it.
 */
export function consoleMessages(text: string, withheld: ReadonlySet<string>, allowed?: ReadonlySet<string>): string {
  return text
    .split("\n")
    .filter((line) => {
      const url = / @ (\S+?):\d+$/.exec(line)?.[1]
      if (!url) return true
      const origin = BrowserPermission.origin(url)
      if (origin === undefined) return allowed === undefined
      if (withheld.has(origin)) return false
      return allowed === undefined || allowed.has(origin)
    })
    .join("\n")
}

/** The same attribution rule for the numbered request list. */
export function networkRequests(text: string, withheld: ReadonlySet<string>, allowed?: ReadonlySet<string>): string {
  return text
    .split("\n")
    .filter((line) => {
      if (!/^\d+\. /.test(line)) return true
      const url = /(https?:\/\/\S+)/.exec(line)?.[1]
      if (!url) return allowed === undefined
      const origin = BrowserPermission.origin(url)
      if (origin === undefined) return allowed === undefined
      if (withheld.has(origin)) return false
      return allowed === undefined || allowed.has(origin)
    })
    .join("\n")
}

/** The answer when a result belongs to a withheld frame and cannot be filtered line by line. */
const REFUSED = "The request details are unavailable: the request may belong to a part of the page that is withheld."

/**
 * Frame scoping for one tool result. `withholding` is true when at least one frame is withheld; `withheld` holds the
 * origins those frames belong to (empty when none of them has a determinable origin). `origins` maps every iframe ref
 * in the snapshot to its frame origin, and `granted` answers whether that origin has a `read` grant. Console and
 * network lines are attributed by the URL they name. `browser_network_request` details are refused rather than
 * filtered: a single part (headers or a body) carries no URL, so the backend cannot show the request belongs to a
 * granted frame.
 */
export function scope(input: {
  tool: string
  text: string
  withholding: boolean
  withheld: ReadonlySet<string>
  /** Origins this session may read; set while withholding, so only attributable lines survive. */
  allowed?: ReadonlySet<string>
  origins?: ReadonlyMap<string, string>
  granted: (origin: string) => boolean
}): { text: string; refused: boolean } {
  if (!input.withholding) return { text: input.text, refused: false }
  if (input.tool === "browser_network_request") return { text: REFUSED, refused: true }
  let text = input.text
  if (text.includes("### Snapshot")) text = snapshot(text, input.origins ?? new Map(), input.granted)
  if (input.tool === "browser_console_messages") text = consoleMessages(text, input.withheld, input.allowed)
  if (input.tool === "browser_network_requests") text = networkRequests(text, input.withheld, input.allowed)
  return { text, refused: false }
}
