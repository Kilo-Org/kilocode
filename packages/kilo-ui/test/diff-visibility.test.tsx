import { expect, test } from "bun:test"
import { processFile } from "@pierre/diffs"
import { Diff } from "../src/components/diff"
import { mount } from "./harness"

class DeferredObserver {
  static current: DeferredObserver | undefined
  targets = new Set<Element>()
  constructor(private readonly callback: IntersectionObserverCallback) {
    DeferredObserver.current = this
  }
  observe(target: Element) {
    this.targets.add(target)
  }
  unobserve(target: Element) {
    this.targets.delete(target)
  }
  disconnect() {
    this.targets.clear()
  }
  fire() {
    this.callback(
      [...this.targets].map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
      this as never,
    )
  }
}

test("patch-only diff parses nothing until it becomes visible", async () => {
  const original = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = DeferredObserver as never
  const patch = ["--- a/file.ts", "+++ b/file.ts", "@@ -1,3 +1,3 @@", " a", "-b", "+c", " d"].join("\n")
  const value = mount(() => <Diff patch={patch} diffStyle="unified" hunkSeparators="simple" />)
  try {
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(DeferredObserver.current?.targets.size).toBe(1)
    expect((value.host.firstElementChild as HTMLElement).innerHTML).toBe("")

    // Bun's test DOM cannot run Pierre's highlighter, so the rendered-line
    // assertion lives in the VS Code harness. This covers the parse boundary:
    // the same patch the visible branch passes to processFile has hunks.
    expect(processFile(patch)?.hunks.length).toBeGreaterThan(0)
    DeferredObserver.current?.fire()
    await new Promise((resolve) => setTimeout(resolve, 50))
  } finally {
    value.dispose()
    globalThis.IntersectionObserver = original
  }
})
