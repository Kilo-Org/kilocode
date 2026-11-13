import { describe, expect, it } from "bun:test"
import type { CodeActionContext, Range, TextDocument } from "vscode"

const { KiloCodeActionProvider } = await import("../src/services/code-actions/code-action-provider")

const provider = new KiloCodeActionProvider()

function provide(isEmpty: boolean, diagnostics: unknown[]) {
  return provider.provideCodeActions(
    {} as TextDocument,
    { isEmpty } as Range,
    { diagnostics } as unknown as CodeActionContext,
  )
}

describe("KiloCodeActionProvider", () => {
  describe("provideCodeActions", () => {
    it("returns empty array when range is empty", () => {
      expect(provide(true, [])).toEqual([])
    })

    it("returns empty array when range is empty even with diagnostics", () => {
      expect(provide(true, [1, 2, 3])).toEqual([])
    })

    describe("non-empty range, no diagnostics", () => {
      it("returns Add, Explain, Improve actions", () => {
        const titles = provide(false, []).map((action) => action.title)
        expect(titles).toContain("Add to Kilo Code")
        expect(titles).toContain("Explain with Kilo Code")
        expect(titles).toContain("Improve with Kilo Code")
      })

      it("does not include Fix action", () => {
        expect(provide(false, []).map((action) => action.title)).not.toContain("Fix with Kilo Code")
      })

      it("returns exactly 3 actions", () => {
        expect(provide(false, [])).toHaveLength(3)
      })

      it("uses correct command IDs", () => {
        const commandIds = provide(false, []).map((action) => action.command?.command)
        expect(commandIds).toContain("kilo-code.v2.addToContext")
        expect(commandIds).toContain("kilo-code.v2.explainCode")
        expect(commandIds).toContain("kilo-code.v2.improveCode")
      })

      it("no action is preferred", () => {
        expect(provide(false, []).every((action) => !action.isPreferred)).toBe(true)
      })
    })

    describe("non-empty range, with diagnostics", () => {
      it("returns Add and Fix actions", () => {
        const titles = provide(false, [1, 2]).map((action) => action.title)
        expect(titles).toContain("Add to Kilo Code")
        expect(titles).toContain("Fix with Kilo Code")
      })

      it("does not include Explain or Improve actions", () => {
        const titles = provide(false, [1]).map((action) => action.title)
        expect(titles).not.toContain("Explain with Kilo Code")
        expect(titles).not.toContain("Improve with Kilo Code")
      })

      it("returns exactly 2 actions", () => {
        expect(provide(false, [1])).toHaveLength(2)
      })

      it("Fix action is preferred", () => {
        const fix = provide(false, [1]).find((action) => action.title === "Fix with Kilo Code")
        expect(fix?.isPreferred).toBe(true)
      })

      it("Fix action uses QuickFix kind", () => {
        const fix = provide(false, [1]).find((action) => action.title === "Fix with Kilo Code")
        expect(fix?.kind?.value).toBe("quickfix")
      })

      it("uses correct Fix command ID", () => {
        const fix = provide(false, [1]).find((action) => action.title === "Fix with Kilo Code")
        expect(fix?.command?.command).toBe("kilo-code.v2.fixCode")
      })
    })
  })
})
