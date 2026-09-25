/**
 * Source contract for the transcript's Virtua container.
 *
 * A row that mounts taller than its cached Virtua size must not grow the
 * scroller before Virtua measures it. Otherwise the bottom pin scrolls the row
 * out of range, it unmounts unmeasured, and the transcript mounts and unmounts
 * it every frame. Layout is not available in the unit test DOM, so this
 * guards the wiring that prevents the loop.
 */

import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const list = fs.readFileSync(path.join(root, "webview-ui/src/components/chat/MessageList.tsx"), "utf-8")
const css = fs.readFileSync(path.join(root, "webview-ui/src/styles/chat-layout.css"), "utf-8")

describe("transcript virtual container", () => {
  it("renders Virtua rows inside the clipped container", () => {
    expect(list).toMatch(/<Virtualizer[^>]*\bas=\{VirtualBox\}/)
    expect(list).toContain('data-slot="message-list-virtual"')
  })

  it("clips only vertical overflow so rows keep their side bleed and sticky content", () => {
    const rule = css.match(/\[data-slot="message-list-virtual"\]\s*\{([^}]*)\}/)
    expect(rule?.[1]).toContain("overflow: visible clip;")
  })
})
