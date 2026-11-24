import { afterAll, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "../../..")
const plugin = resolve(import.meta.dir, "../script/oxlint/index.mts")
const dir = mkdtempSync(join(tmpdir(), "kilo-view-active-lint-"))
const config = join(dir, ".oxlintrc.json")

writeFileSync(
  config,
  JSON.stringify({
    categories: {
      correctness: "off",
      suspicious: "off",
      pedantic: "off",
      perf: "off",
      style: "off",
      restriction: "off",
      nursery: "off",
    },
    jsPlugins: [{ name: "kilo-vscode", specifier: plugin }],
    rules: {
      "kilo-vscode/require-view-active-guard": "error",
    },
  }),
)

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

interface LintDiagnostic {
  code: string
  message: string
}

let seq = 0

function lintSnippet(source: string): LintDiagnostic[] {
  const file = join(dir, `case-${++seq}.tsx`)
  writeFileSync(file, source)
  const proc = Bun.spawnSync([process.execPath, "x", "oxlint", "--config", config, "--format", "json", file], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const parsed = JSON.parse(proc.stdout.toString("utf8")) as { diagnostics: LintDiagnostic[] }
  return parsed.diagnostics
}

describe("kilo-vscode/require-view-active-guard", () => {
  it("flags unguarded global listeners, commands, ResizeObserver, CSS.highlights, and unscoped document queries", () => {
    const diagnostics = lintSnippet(`
      import { useViewActive } from "./view-active"
      declare const v2: { onCommand: (cb: (name: string) => void) => void }
      declare function createResizeObserver(target: () => Element | undefined, cb: () => void): void

      export function BadComponent() {
        const viewActive = useViewActive()
        const unrelated = () => viewActive()
        void unrelated

        const onKey = () => {}
        window.addEventListener("keydown", onKey)
        document.addEventListener("pointermove", () => {})
        v2.onCommand((name) => { void name })
        const ro = new ResizeObserver(() => {})
        createResizeObserver(() => undefined, () => {})
        const reg = CSS.highlights
        const found = document.querySelector(".chat-input")
        const all = document.querySelectorAll(".diff-row")
        return { ro, reg, found, all }
      }
    `)

    expect(diagnostics.map((item) => item.message)).toEqual([
      expect.stringContaining("window/document addEventListener"),
      expect.stringContaining("window/document addEventListener"),
      expect.stringContaining("onCommand listener"),
      expect.stringContaining("ResizeObserver"),
      expect.stringContaining("ResizeObserver"),
      expect.stringContaining("CSS.highlights"),
      expect.stringContaining("Unscoped document.querySelector"),
      expect.stringContaining("Unscoped document.querySelector"),
    ])
  })

  it("allows guarded listeners, guarded ResizeObservers, active-slot queries, and element-scoped queries", () => {
    const diagnostics = lintSnippet(`
      import { useViewActive } from "./view-active"
      declare const v2: { onCommand: (cb: (name: string) => void) => void }
      declare function createEffect(fn: () => void): void

      export function GoodComponent(el: HTMLElement) {
        const active = useViewActive()

        const run = () => {
          if (!active()) return
          void CSS.highlights
        }
        const schedule = () => run()

        window.addEventListener("keydown", () => {
          if (!active()) return
        })
        document.addEventListener("pointermove", schedule)
        v2.onCommand((name) => {
          if (!active()) return
          void name
        })
        const ro = new ResizeObserver(schedule)

        createEffect(() => {
          if (!active()) return
          window.addEventListener("resize", () => {})
          void CSS.highlights
        })

        const scoped = document.querySelector(".am-chat-slot-active .chat-input")
        const diffScoped = document.querySelectorAll(".am-diff-panel-cache-active .diff-row")
        const local = el.querySelector(".chat-input")
        return { ro, scoped, diffScoped, local }
      }
    `)

    expect(diagnostics).toEqual([])
  })

  it("still flags document.querySelector even inside a viewActive() guard", () => {
    const diagnostics = lintSnippet(`
      import { useViewActive } from "./view-active"

      export function StillBad() {
        const viewActive = useViewActive()
        if (!viewActive()) return null
        return document.querySelector(".chat-input")
      }
    `)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("Unscoped document.querySelector")
  })
})
