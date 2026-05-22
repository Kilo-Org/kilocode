import { afterEach, expect, test } from "bun:test"
import { kitty, sequences } from "../../src/kilocode/cli/cmd/tui/util/terminal"

const keys = ["TERM_PROGRAM", "MSYSTEM", "KILO_DISABLE_KITTY_KEYBOARD", "KILO_ENABLE_KITTY_KEYBOARD"] as const
type Key = (typeof keys)[number]
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]])) as Record<Key, string | undefined>

function env(input: Partial<Record<Key, string | undefined>>) {
  for (const key of keys) {
    const value = input[key]
    if (value === undefined) {
      delete process.env[key]
      continue
    }
    process.env[key] = value
  }
}

function restore() {
  for (const key of keys) {
    const value = saved[key]
    if (value === undefined) {
      delete process.env[key]
      continue
    }
    process.env[key] = value
  }
}

afterEach(() => {
  restore()
})

test("enables Kitty keyboard reset by default", () => {
  env({})

  expect(kitty()).toBe(true)
  expect(sequences()).toContain("\x1b[<u")
})

test("disables Kitty keyboard in mintty", () => {
  env({ TERM_PROGRAM: "mintty" })

  expect(kitty()).toBe(false)
  expect(sequences()).not.toContain("\x1b[<u")
})

test("disables Kitty keyboard in MSYS shells", () => {
  env({ MSYSTEM: "MINGW64" })

  expect(kitty()).toBe(false)
  expect(sequences()).not.toContain("\x1b[<u")
})

test("allows explicitly enabling Kitty keyboard", () => {
  env({ KILO_ENABLE_KITTY_KEYBOARD: "1", MSYSTEM: "MINGW64" })

  expect(kitty()).toBe(true)
  expect(sequences()).toContain("\x1b[<u")
})

test("allows explicitly disabling Kitty keyboard", () => {
  env({ KILO_DISABLE_KITTY_KEYBOARD: "1", KILO_ENABLE_KITTY_KEYBOARD: "1" })

  expect(kitty()).toBe(false)
  expect(sequences()).not.toContain("\x1b[<u")
})

test("resets common terminal input modes", () => {
  env({ KILO_DISABLE_KITTY_KEYBOARD: "1" })

  expect(sequences()).toEqual(
    expect.arrayContaining([
      "\x1b[?9l",
      "\x1b[?1000l",
      "\x1b[?1001l",
      "\x1b[?1002l",
      "\x1b[?1003l",
      "\x1b[?1005l",
      "\x1b[?1006l",
      "\x1b[?1007l",
      "\x1b[?1015l",
      "\x1b[?1016l",
      "\x1b[?2004l",
      "\x1b[?1004l",
      "\x1b[?1l",
      "\x1b>",
      "\x1b[?66l",
      "\x1b[>4;0m",
      "\x1b[?25h",
      "\x1b[0m",
    ]),
  )
})
