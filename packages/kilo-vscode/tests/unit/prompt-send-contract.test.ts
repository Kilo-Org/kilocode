/**
 * Source contract tests for prompt send paths.
 *
 * Static analysis — reads session.tsx source and verifies that sendMessage and
 * sendCommand still dismiss suggestions and reject questions before dispatching.
 * Also reads ChatView.tsx and asserts the prompt-block predicate is fed only
 * permission counts, never question counts — guarantees that a pending question
 * cannot re-block the prompt input.
 *
 * Protects against accidental removal during Kilo development.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const SESSION_FILE = path.join(ROOT, "webview-ui/src/context/session.tsx")
const CHATVIEW_FILE = path.join(ROOT, "webview-ui/src/components/chat/ChatView.tsx")
const PROMPT_UTILS_FILE = path.join(ROOT, "webview-ui/src/components/chat/prompt-input-utils.ts")

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8")
}

/**
 * Extract the body of a named function from the source.
 * Finds `function <name>(` and returns everything from there to the next
 * `function ` declaration at the same or lower indentation, or to end of file.
 */
function extractFunctionBody(source: string, name: string): string {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  if (start === -1) return ""

  // Find the next `function ` declaration after the opening one.
  // We search for a newline followed by `  function ` (2-space indent, matching
  // the indentation level of sendMessage/sendCommand inside SessionProvider).
  const rest = source.slice(start + marker.length)
  const next = rest.search(/\n  function /)
  return next === -1 ? rest : rest.slice(0, next)
}

describe("sendMessage dismisses pending tool requests", () => {
  const source = readFile(SESSION_FILE)
  const body = extractFunctionBody(source, "sendMessage")

  it("function sendMessage exists in session.tsx", () => {
    expect(body.length).toBeGreaterThan(0)
  })

  it("dismisses suggestions before sending", () => {
    expect(body).toContain("dismissSuggestion")
  })

  it("rejects questions before sending", () => {
    expect(body).toContain("rejectQuestion")
  })
})

describe("sendCommand dismisses pending tool requests", () => {
  const source = readFile(SESSION_FILE)
  const body = extractFunctionBody(source, "sendCommand")

  it("function sendCommand exists in session.tsx", () => {
    expect(body.length).toBeGreaterThan(0)
  })

  it("dismisses suggestions before sending", () => {
    expect(body).toContain("dismissSuggestion")
  })

  it("rejects questions before sending", () => {
    expect(body).toContain("rejectQuestion")
  })
})

describe("ChatView prompt-block contract", () => {
  const source = readFile(CHATVIEW_FILE)

  it("calls isPromptBlocked with exactly one argument (familyPermissions length)", () => {
    // Exact call shape — prettier formatting is deterministic here, so a strict
    // match catches both "someone added a second arg" and "someone wrapped it in
    // a different expression".
    expect(source).toMatch(/blocked\s*=\s*\(\)\s*=>\s*isPromptBlocked\(familyPermissions\(\)\.length\)/)
  })

  it("does not pass any second argument to isPromptBlocked", () => {
    expect(source).not.toMatch(/isPromptBlocked\s*\([^,)]*,[^)]*\)/)
  })

  it("does not define a blockingQuestions memo", () => {
    expect(source).not.toContain("blockingQuestions")
  })

  it("does not reference q.blocking when building the blocked state", () => {
    expect(source).not.toMatch(/q\.blocking/)
  })
})

describe("isPromptBlocked signature contract", () => {
  const source = readFile(PROMPT_UTILS_FILE)

  it("declares exactly one parameter (source-level guard)", () => {
    // Complements the runtime `isPromptBlocked.length === 1` check in
    // prompt-input-utils.test.ts. `Function.prototype.length` counts parameters
    // before the first default — this regex catches a future regression that
    // sneaks in a second param with a default value (which would otherwise keep
    // `.length === 1` and slip past the runtime check).
    const match = source.match(/export function isPromptBlocked\(([^)]*)\)/)
    expect(match).not.toBeNull()
    const params = match![1]
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    expect(params).toHaveLength(1)
  })
})
