// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { applyEdits, modify, findNodeAtLocation, parseTree } from "jsonc-parser"

// Replicate patchJsonc logic locally to test it in isolation
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, path, patch === null ? undefined : patch, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    return applyEdits(input, edits)
  }

  if (path.length > 0) {
    const tree = parseTree(input)
    const node = tree && findNodeAtLocation(tree, path)
    if (node && node.type !== "object") {
      const edits = modify(input, path, patch, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      })
      return applyEdits(input, edits)
    }
  }

  return Object.entries(patch).reduce((result, [key, value]) => {
    if (value === undefined) return result
    return patchJsonc(result, value, [...path, key])
  }, input)
}

describe("patchJsonc scalar-to-object transition", () => {
  test("sets object when node does not yet exist", () => {
    const input = `{ "permission": {} }`
    const result = patchJsonc(input, { permission: { bash: { "*": "ask", uname: "allow" } } })
    const parsed = JSON.parse(result)
    expect(parsed.permission.bash).toEqual({ "*": "ask", uname: "allow" })
  })

  test("transitions permission rule from string to object (the bug scenario)", () => {
    // bash is stored as a plain string "ask" in the JSONC file
    const input = `{ "permission": { "bash": "ask" } }`
    // User adds exception "uname" → "allow"; this would previously throw:
    // "Can not add index to parent of type string"
    const result = patchJsonc(input, { permission: { bash: { "*": "ask", uname: "allow" } } })
    const parsed = JSON.parse(result)
    expect(parsed.permission.bash).toEqual({ "*": "ask", uname: "allow" })
  })

  test("does not disturb sibling keys when replacing scalar", () => {
    const input = `{ "permission": { "bash": "ask", "glob": "allow" } }`
    const result = patchJsonc(input, { permission: { bash: { "*": "ask", uname: "allow" } } })
    const parsed = JSON.parse(result)
    expect(parsed.permission.glob).toBe("allow")
    expect(parsed.permission.bash).toEqual({ "*": "ask", uname: "allow" })
  })

  test("updates existing object permission by adding a new key", () => {
    const input = `{ "permission": { "bash": { "*": "ask" } } }`
    const result = patchJsonc(input, { permission: { bash: { "*": "ask", uname: "allow" } } })
    const parsed = JSON.parse(result)
    expect(parsed.permission.bash).toEqual({ "*": "ask", uname: "allow" })
  })

  test("plain string permission update still works", () => {
    const input = `{ "permission": { "bash": "allow" } }`
    const result = patchJsonc(input, { permission: { bash: "ask" } })
    const parsed = JSON.parse(result)
    expect(parsed.permission.bash).toBe("ask")
  })
})
