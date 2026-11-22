import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { displayText } from "../../webview-ui/src/components/chat/permission-dock-utils"

/**
 * The display class is one policy expressed in three surfaces: the VS Code webview, the CLI and
 * JetBrains. These tests hold the three declarations to the same code point set, and pin the
 * escapes that set produces, so a surface can never quietly show different text from its peers.
 */

type Interval = [start: number, end: number]

const VSCODE = "../../webview-ui/src/components/chat/permission-dock-utils.ts"
const CLI = "../../../opencode/src/kilocode/skills/display.ts"
const JETBRAINS =
  "../../../kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/views/permission/PermissionView.kt"

function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
}

function hex(cp: number): string {
  return "U+" + cp.toString(16).toUpperCase().padStart(4, "0")
}

function format(intervals: Interval[]): string {
  return intervals.map(([s, e]) => (s === e ? hex(s) : `${hex(s)}-${hex(e)}`)).join(", ") || "(none)"
}

function normalize(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Interval[] = []
  for (const [start, end] of sorted) {
    const last = out[out.length - 1]
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end)
    } else {
      out.push([start, end])
    }
  }
  return out
}

/** Code points in `a` that `b` does not cover. */
function diff(a: Interval[], b: Interval[]): Interval[] {
  const rest = normalize(b)
  const out: Interval[] = []
  for (const [start, end] of normalize(a)) {
    let cursor = start
    for (const [s, e] of rest) {
      if (e < cursor || s > end) continue
      if (s > cursor) out.push([cursor, Math.min(s - 1, end)])
      cursor = Math.max(cursor, e + 1)
      if (cursor > end) break
    }
    if (cursor <= end) out.push([cursor, end])
  }
  return out
}

function covers(intervals: Interval[], cp: number): boolean {
  return intervals.some(([s, e]) => cp >= s && cp <= e)
}

const TS_TOKEN = /\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/y

/** Parse one `[...]` class body of escaped code point tokens into intervals. */
function tsIntervals(body: string, label: string): Interval[] {
  const out: Interval[] = []
  let index = 0
  const token = (): number => {
    TS_TOKEN.lastIndex = index
    const match = TS_TOKEN.exec(body)
    if (!match) {
      throw new Error(
        `display class in ${label}: unsupported construct at index ${index}: "${body.slice(index, index + 12)}"`,
      )
    }
    index = TS_TOKEN.lastIndex
    return Number.parseInt(match[1] ?? match[2]!, 16)
  }
  while (index < body.length) {
    const start = token()
    if (body[index] === "-") {
      index += 1
      const end = token()
      if (end < start) throw new Error(`display class in ${label}: descending range ${hex(start)}-${hex(end)}`)
      out.push([start, end])
    } else {
      out.push([start, start])
    }
  }
  if (out.length === 0) throw new Error(`display class in ${label}: no intervals parsed`)
  return normalize(out)
}

/** Extract the `const CONTROL =` class body from a TypeScript mirror. */
function tsBody(src: string, label: string): string {
  const match = /const CONTROL =[\s\S]*?\/\[([\s\S]*?)\]\//.exec(src)
  if (!match?.[1]) throw new Error(`display class in ${label}: no \`const CONTROL = /[...]/ \` literal found`)
  return match[1]
}

function tsSet(src: string, label: string): Interval[] {
  return tsIntervals(tsBody(src, label), label)
}

const KOTLIN_CLAUSE = /code\s+(?:in\s+(0x[0-9a-fA-F]+)\.\.(0x[0-9a-fA-F]+)|==\s*(0x[0-9a-fA-F]+))/g

function kotlinSet(src: string, label: string): Interval[] {
  const start = src.indexOf("private fun isEscapedControlOrFormat")
  if (start < 0) throw new Error(`display class in ${label}: no \`isEscapedControlOrFormat\` predicate found`)
  const end = src.indexOf("\n\n", start)
  const body = src.slice(start, end < 0 ? undefined : end)
  const out: Interval[] = []
  for (const match of body.matchAll(KOTLIN_CLAUSE)) {
    if (match[1] && match[2]) out.push([Number.parseInt(match[1], 16), Number.parseInt(match[2], 16)])
    else if (match[3]) {
      const cp = Number.parseInt(match[3], 16)
      out.push([cp, cp])
    }
  }
  if (out.length === 0) throw new Error(`display class in ${label}: predicate body yielded no intervals`)
  return normalize(out)
}

const vscodeSource = source(VSCODE)
const cliSource = source(CLI)
const kotlinSource = source(JETBRAINS)

const vscode = tsSet(vscodeSource, "permission-dock-utils.ts")
const cli = tsSet(cliSource, "skills/display.ts")
const jetbrains = kotlinSet(kotlinSource, "PermissionView.kt")

describe("display class", () => {
  describe("parity between surfaces", () => {
    it("webview and CLI escape the same code points", () => {
      const forward = diff(vscode, cli)
      const backward = diff(cli, vscode)
      expect(
        forward,
        `webview escapes but CLI does not: ${format(forward)}; CLI escapes but webview does not: ${format(backward)}`,
      ).toEqual([])
      expect(backward).toEqual([])
    })

    it("webview and JetBrains escape the same code points", () => {
      const forward = diff(vscode, jetbrains)
      const backward = diff(jetbrains, vscode)
      expect(
        forward,
        `webview escapes but JetBrains does not: ${format(forward)}; JetBrains escapes but webview does not: ${format(backward)}`,
      ).toEqual([])
      expect(backward).toEqual([])
    })
  })

  describe("coverage", () => {
    it("escapes every control and format code point it claims", () => {
      const claimed = [
        0x0000, 0x001f, 0x007f, 0x009f, 0x00ad, 0x034f, 0x061c, 0x200b, 0x200d, 0x200e, 0x202e, 0x2029, 0x2066, 0xfe0f,
        0xfeff, 0xe0041, 0xe0100, 0xe0000, 0xe0fff,
      ]
      for (const cp of claimed) {
        expect(covers(vscode, cp), `webview display class must cover ${hex(cp)}`).toBe(true)
      }
    })

    it("leaves ordinary text code points alone", () => {
      const ordinary = [0x0041, 0x0061, 0x0020, 0x0439, 0x05d0, 0x4e2d, 0x1f600, 0x1f3f4, 0xfe10]
      for (const cp of ordinary) {
        expect(covers(vscode, cp), `webview display class must not cover ${hex(cp)}`).toBe(false)
      }
    })
  })

  describe("escapes", () => {
    const golden: Array<[number, string]> = [
      [0x00, "\\x00"],
      [0x09, "\\t"],
      [0x0a, "\\n"],
      [0x0d, "\\r"],
      [0x7f, "\\x7f"],
      [0x9f, "\\x9f"],
      [0x00ad, "\\xad"],
      [0x034f, "\\u034f"],
      [0x061c, "\\u061c"],
      [0x200b, "\\u200b"],
      [0x200d, "\\u200d"],
      [0x200e, "\\u200e"],
      [0x202e, "\\u202e"],
      [0x2066, "\\u2066"],
      [0xfe0f, "\\ufe0f"],
      [0xfeff, "\\ufeff"],
      [0xe0041, "\\u{e0041}"],
      [0xe0100, "\\u{e0100}"],
    ]

    it("renders each code point as its literal escape", () => {
      for (const [cp, expected] of golden) {
        const ch = String.fromCodePoint(cp)
        const actual = displayText(ch)
        expect(actual, `${hex(cp)} must render as "${expected}", got "${actual}"`).toBe(expected)
      }
    })

    it("escapes the golden code points on the CLI and JetBrains too", () => {
      for (const [cp] of golden) {
        expect(covers(cli, cp), `CLI display class must cover ${hex(cp)}`).toBe(true)
        expect(covers(jetbrains, cp), `JetBrains display class must cover ${hex(cp)}`).toBe(true)
      }
    })

    it("passes ordinary text through unchanged", () => {
      for (const cp of [0x1f600, 0x1f3f4, 0x4e2d, 0x05d0]) {
        const ch = String.fromCodePoint(cp)
        expect(displayText(ch), `${hex(cp)} must pass through unchanged`).toBe(ch)
      }
    })
  })

  describe("drift detection", () => {
    it("reports a narrowed TypeScript range as a difference", () => {
      const body = tsBody(vscodeSource, "permission-dock-utils.ts").replace("\\ufe00-\\ufe0f", "\\ufe00-\\ufe0e")
      expect(body).not.toBe(tsBody(vscodeSource, "permission-dock-utils.ts"))
      const drifted = tsIntervals(body, "patched permission-dock-utils.ts")
      const forward = diff(vscode, drifted)
      const backward = diff(drifted, vscode)
      expect(
        forward.length + backward.length,
        `narrowing U+FE00-U+FE0F to U+FE00-U+FE0E must show up as a difference, got ${format(forward)} / ${format(backward)}`,
      ).toBeGreaterThan(0)
    })

    it("reports a narrowed Kotlin range as a difference", () => {
      const patched = kotlinSource.replace("code in 0xfe00..0xfe0f", "code in 0xfe00..0xfe0e")
      expect(patched).not.toBe(kotlinSource)
      const drifted = kotlinSet(patched, "patched PermissionView.kt")
      const forward = diff(jetbrains, drifted)
      const backward = diff(drifted, jetbrains)
      expect(
        forward.length + backward.length,
        `narrowing 0xfe00..0xfe0f to 0xfe00..0xfe0e must show up as a difference, got ${format(forward)} / ${format(backward)}`,
      ).toBeGreaterThan(0)
    })
  })
})
