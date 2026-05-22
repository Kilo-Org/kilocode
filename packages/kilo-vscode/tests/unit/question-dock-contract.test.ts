/**
 * QuestionDock submission contract tests.
 *
 * Static analysis — reads QuestionDock source and locks the explicit-submit
 * behavior for single-question option picks.
 */

import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const FILE = path.join(ROOT, "webview-ui/src/components/chat/QuestionDock.tsx")

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8")
}

function extractBody(source: string, name: string): string {
  const marker = `const ${name} = `
  const start = source.indexOf(marker)
  if (start === -1) return ""
  const rest = source.slice(start + marker.length)
  const next = rest.search(/\n  const /)
  return next === -1 ? rest : rest.slice(0, next)
}

describe("QuestionDock explicit submit contract", () => {
  const source = readFile(FILE)
  const pick = extractBody(source, "pick")

  it("keeps option clicks local instead of replying immediately", () => {
    expect(pick.length).toBeGreaterThan(0)
    expect(pick).not.toContain("reply([[answer]])")
  })

  it("still advances multi-question single-select flows", () => {
    expect(pick).toContain('if (outcome.kind === "advance")')
    expect(pick).toContain('setStore("tab", store.tab + 1)')
  })

  it("still syncs the optimistic agent selection on pick", () => {
    expect(pick).toContain("syncAgent(answers, kinds)")
  })

  it("restores the optimistic agent before dismissing a question", () => {
    const reject = extractBody(source, "reject")
    expect(reject).toContain("if (prevAgent !== undefined)")
    expect(reject).toContain("session.selectAgent(prevAgent)")
    expect(reject).toContain("prevAgent = undefined")
    const reset = reject.indexOf("prevAgent = undefined")
    const sending = reject.indexOf('setStore("sending", true)')
    expect(reset).toBeGreaterThan(-1)
    expect(sending).toBeGreaterThan(-1)
    expect(reset, "reject should restore the agent before sending the dismissal").toBeLessThan(sending)
  })

  it("keeps the footer Submit button wired to submit()", () => {
    expect(source).toContain('<Button variant="primary" size="small" onClick={submit} disabled={store.sending}>')
  })
})
