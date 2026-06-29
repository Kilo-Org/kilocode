import { describe, expect, test } from "bun:test"
import { getVscodeMode } from "./context"

const classes = (...names: string[]) => ({
  contains: (name: string) => names.includes(name),
})

describe("VS Code color scheme", () => {
  test.each([
    [["vscode-dark"], "dark"],
    [["vscode-light"], "light"],
    [["vscode-high-contrast"], "dark"],
    [["vscode-high-contrast", "vscode-high-contrast-light"], "light"],
    [[], undefined],
  ] as const)("resolves body classes %p", (names, expected) => {
    expect(getVscodeMode(classes(...names))).toBe(expected)
  })
})
