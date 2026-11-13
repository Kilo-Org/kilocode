// The v1 model selectors keep their loading and value-change motion in the v2 webview: the prompt label rises in when
// the model changes, the picker eases its own width and height, and reduced motion turns all of it off. Each assertion
// names the v1 timing and easing, so a refactor cannot quietly retune or drop them.
import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const read = (file: string) => fs.readFileSync(path.join(root, "webview-ui/src", file), "utf8")
/** CSS declarations are compared without their line breaks and indentation. */
const compact = (css: string) => css.replace(/\s+/g, " ")

const prompt = compact(read("styles/prompt-input.css"))
const picker = compact(read("styles/model-selector.css"))
const selector = read("components/shared/ModelSelector.tsx")

describe("model selector animations", () => {
  it("rises the prompt label in over 200ms with the shared prompt easing", () => {
    expect(prompt).toContain("--prompt-selectors-ease: cubic-bezier(0.2, 0.9, 0.3, 1);")
    expect(prompt).toContain(
      ".prompt-selectors :is(.mode-switcher-trigger-label, .model-selector-trigger-label, .thinking-selector-trigger-label) { display: inline-block; min-width: 0; animation: prompt-selector-value-in 200ms var(--prompt-selectors-ease); }",
    )
    expect(prompt).toContain("@keyframes prompt-selector-value-in { from { opacity: 0; transform: translateY(3px); } }")
  })

  it("remounts the trigger label on a change so the rise replays", () => {
    expect(selector).toContain("<Show when={triggerLabel()} keyed>")
    expect(selector).toContain('class="model-selector-trigger-label"')
  })

  it("turns the animations off for reduced motion, both the setting and the media query", () => {
    expect(prompt).toContain(
      "body.vscode-reduce-motion .prompt-selectors, body.vscode-reduce-motion .prompt-selectors *, body.vscode-reduce-motion .prompt-selectors *::before, body.vscode-reduce-motion .prompt-action { animation: none !important; transition: none !important; }",
    )
    const reduced = prompt.slice(prompt.indexOf("@media (prefers-reduced-motion: reduce) { .prompt-selectors,"))
    expect(reduced).toContain(".prompt-selectors *::before, .prompt-action { animation: none !important;")
  })

  it("eases the picker width, body height, group chevrons and favorite stars", () => {
    expect(picker).toContain(".model-selector-popover { transition: width 0.2s ease, max-width 0.2s ease; }")
    expect(picker).toContain(".model-selector-body { display: flex; flex-direction: column; overflow: hidden; transition: height 0.2s ease; }")
    expect(picker).toContain("transition: max-height 0.15s ease;")
    expect(picker).toContain(".model-selector-group-chevron { flex-shrink: 0; transition: transform 0.12s ease; }")
    expect(picker).toContain("transition: opacity 0.1s ease, color 0.1s ease;")
  })

  it("turns the picker chevron while its popover is open", () => {
    expect(prompt).toContain(
      '.prompt-selectors [data-slot="popover-trigger"][data-expanded] :is(.selector-trigger-chevron, .model-selector-trigger-chevron) { transform: rotate(180deg); }',
    )
  })
})
