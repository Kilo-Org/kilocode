import { describe, expect, test } from "bun:test"
import { buildRunMessage } from "../../../../src/kilocode/cli/cmd/run-message"

describe("buildRunMessage", () => {
  test("preserves shell-bound multi-word positionals via wrap-quote (PR #4979)", () => {
    expect(buildRunMessage(["hello", "world foo", "bar"], undefined)).toBe('hello "world foo" bar')
  })

  test("does not quote single-word positionals", () => {
    expect(buildRunMessage(["hello", "world"], undefined)).toBe("hello world")
  })

  test("escapes embedded double quotes inside positionals", () => {
    expect(buildRunMessage(['say "hi"'], undefined)).toBe('"say \\"hi\\""')
  })

  test("passes args['--'] through verbatim without wrap-quote (#9622)", () => {
    // `kilo run -- "- Who are you?"` - yargs+populate-- captures the leading-dash
    // phrase as a single atom in args["--"]. The assembler must NOT wrap it,
    // because the user typed `--` precisely to opt out of further parsing.
    expect(buildRunMessage([], ["- Who are you?"])).toBe("- Who are you?")
  })

  test("does not synthesize quote bytes around dash atoms even when they contain spaces", () => {
    expect(buildRunMessage([], ["one two", "three"])).toBe("one two three")
  })

  test("combines positionals and dash args with appropriate quoting per source", () => {
    expect(buildRunMessage(["pre", "fix arg"], ["raw arg", "tail"])).toBe('pre "fix arg" raw arg tail')
  })

  test("handles undefined and empty dash args identically", () => {
    expect(buildRunMessage(["x"], undefined)).toBe("x")
    expect(buildRunMessage(["x"], [])).toBe("x")
  })
})
