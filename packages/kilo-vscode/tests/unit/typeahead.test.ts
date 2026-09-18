import { describe, it, expect } from "bun:test"
import { createTypeahead, isTypeaheadChar } from "../../webview-ui/src/utils/typeahead"

const AGENTS = ["Code", "Ask", "Debug", "Orchestrator", "Plan", "Upstream Merge"]
const VARIANTS = ["Default", "Low", "Medium", "High", "Xhigh", "Max"]

/** Feed a whole string one character at a time, returning the final focused index. */
function typeAll(typeahead: ReturnType<typeof createTypeahead>, text: string) {
  return [...text].reduce((_, char) => typeahead.type(char), -1)
}

describe("createTypeahead", () => {
  it("narrows focus as more characters are typed", () => {
    const typeahead = createTypeahead(() => VARIANTS)
    // "High" is the first match for "h", "Xhigh" only wins once "x" leads.
    expect(typeahead.type("h")).toBe(VARIANTS.indexOf("High"))
    expect(
      typeAll(
        createTypeahead(() => VARIANTS),
        "xhi",
      ),
    ).toBe(VARIANTS.indexOf("Xhigh"))
  })

  it("focuses the first occurrence when several items match", () => {
    const labels = ["Max", "Medium", "Minimal"]
    expect(
      typeAll(
        createTypeahead(() => labels),
        "m",
      ),
    ).toBe(0)
    expect(
      typeAll(
        createTypeahead(() => labels),
        "mi",
      ),
    ).toBe(2)
  })

  it("matches case-insensitively", () => {
    expect(
      typeAll(
        createTypeahead(() => VARIANTS),
        "MAX",
      ),
    ).toBe(VARIANTS.indexOf("Max"))
  })

  it("advances to the next word when a space is typed", () => {
    expect(
      typeAll(
        createTypeahead(() => AGENTS),
        "up me",
      ),
    ).toBe(AGENTS.indexOf("Upstream Merge"))
    expect(
      typeAll(
        createTypeahead(() => AGENTS),
        "upstream merge",
      ),
    ).toBe(AGENTS.indexOf("Upstream Merge"))
  })

  it("reports an active buffer only while a search is pending", () => {
    const typeahead = createTypeahead(() => AGENTS)
    expect(typeahead.active()).toBe(false)
    typeahead.type("u")
    expect(typeahead.active()).toBe(true)
    typeahead.reset()
    expect(typeahead.active()).toBe(false)
  })

  it("returns -1 and clears the buffer when nothing matches", () => {
    const typeahead = createTypeahead(() => AGENTS)
    expect(typeahead.type("z")).toBe(-1)
    expect(typeahead.active()).toBe(false)
  })

  it("restarts from the latest character when the accumulated buffer stops matching", () => {
    const typeahead = createTypeahead(() => AGENTS)
    typeahead.type("a") // Ask
    // "ap" matches nothing, so the search restarts from "p" and lands on Plan.
    expect(typeahead.type("p")).toBe(AGENTS.indexOf("Plan"))
  })

  it("does not spuriously match a multi-word label when restarting from a bare space", () => {
    const typeahead = createTypeahead(() => AGENTS)
    typeahead.type("a") // Ask
    typeahead.type("s") // still Ask
    // "as " doesn't extend-match anything, and a lone space carries no search
    // intent, so this must fail rather than jump to the first multi-word label.
    expect(typeahead.type(" ")).toBe(-1)
    expect(typeahead.active()).toBe(false)
  })

  it("reads labels lazily so list changes are picked up", () => {
    const labels = ["Low"]
    const typeahead = createTypeahead(() => labels)
    expect(typeahead.type("h")).toBe(-1)
    labels.push("High")
    expect(typeahead.type("h")).toBe(1)
  })
})

describe("isTypeaheadChar", () => {
  const press = (opts: Partial<KeyboardEvent>) =>
    ({ ctrlKey: false, metaKey: false, altKey: false, ...opts }) as KeyboardEvent

  it("accepts printable characters including space", () => {
    expect(isTypeaheadChar(press({ key: "a" }))).toBe(true)
    expect(isTypeaheadChar(press({ key: " " }))).toBe(true)
  })

  it("ignores modifier combos and non-printable keys", () => {
    expect(isTypeaheadChar(press({ key: "a", ctrlKey: true }))).toBe(false)
    expect(isTypeaheadChar(press({ key: "a", metaKey: true }))).toBe(false)
    expect(isTypeaheadChar(press({ key: "a", altKey: true }))).toBe(false)
    expect(isTypeaheadChar(press({ key: "ArrowDown" }))).toBe(false)
    expect(isTypeaheadChar(press({ key: "Enter" }))).toBe(false)
  })
})
