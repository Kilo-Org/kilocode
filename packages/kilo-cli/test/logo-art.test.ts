import { expect, test } from "bun:test"
import { KiloLogo } from "../src/branding/logo-art"

for (const value of ["1", "true", "yes", "on", "YES"]) {
  test(`modern logo override ${value} wins over terminal detection`, () => {
    expect(KiloLogo.supports({ KILO_UNICODE_LOGO: value, TERM: "dumb" }, "win32")).toBe(true)
  })
}

for (const value of ["0", "false", "no", "off", "NO"]) {
  test(`fallback logo override ${value} wins over terminal detection`, () => {
    expect(KiloLogo.supports({ KILO_UNICODE_LOGO: value, WT_SESSION: "test" }, "win32")).toBe(false)
  })
}

test("uses the block fallback for unsupported terminals", () => {
  expect(KiloLogo.supports({ TERM: "dumb" }, "darwin")).toBe(false)
  expect(KiloLogo.supports({}, "win32")).toBe(false)
  expect(KiloLogo.supports({ ConEmuPID: "1" }, "linux")).toBe(false)
  expect(KiloLogo.supports({ ANSICON: "1" }, "linux")).toBe(false)
})

test("uses sextants on supported terminals", () => {
  expect(KiloLogo.supports({}, "darwin")).toBe(true)
  for (const env of [
    { WT_SESSION: "test" },
    { TERM_PROGRAM: "vscode" },
    { WEZTERM_PANE: "test" },
    { TERM_PROGRAM: "WezTerm" },
  ])
    expect(KiloLogo.supports(env, "win32")).toBe(true)
})

test("invalid overrides fall through to terminal detection", () => {
  expect(KiloLogo.supports({ KILO_UNICODE_LOGO: "invalid", TERM: "dumb" }, "linux")).toBe(false)
  expect(KiloLogo.supports({ KILO_UNICODE_LOGO: "invalid" }, "win32")).toBe(false)
  expect(KiloLogo.supports({ KILO_UNICODE_LOGO: "invalid", WT_SESSION: "test" }, "win32")).toBe(true)
  expect(KiloLogo.supports({ KILO_UNICODE_LOGO: "invalid" }, "linux")).toBe(true)
})

for (const modern of [false, true]) {
  test(`preserves v1 ${modern ? "modern" : "fallback"} artwork and safe compact mark`, () => {
    const art = KiloLogo.art({ KILO_UNICODE_LOGO: modern ? "1" : "0" })
    const rows = art.logo.left.map((line, index) => `${line} ${art.logo.right[index]}`)
    expect(rows).toEqual(
      modern
        ? [
            "██  ██ ██🬺🬏   ██  ██   ██🬺🬏     ████ ██     ██🬺🬏   ",
            "████🬺🬏 ~~██   ██  ~~ ██~~██   ██~~~~ ██     ~~██   ",
            "██  ██ ██████ 🬁🬬████ 🬁🬬██~~   🬁🬬████ 🬁🬬████ ██████ ",
            "~~  ~~ ~~~~~~   ~~~~   ~~       ~~~~   ~~~~ ~~~~~~ ",
          ]
        : [
            "██  ██ ████   ██  ██   ██       ████ ██     ████   ",
            "████   ~~██   ██  ~~ ██~~██   ██~~~~ ██     ~~██   ",
            "██  ██ ██████ ██████   ██~~     ████   ████ ██████ ",
            "~~  ~~ ~~~~~~  ~~~~~   ~~       ~~~~   ~~~~ ~~~~~~ ",
          ],
    )
    expect(art.widths).toEqual({ split: 28, full: 51 })
    expect(rows.map((line) => Bun.stringWidth(line))).toEqual([51, 51, 51, 51])
    expect(art.compact).toEqual(["██  ██", modern ? "████🬺🬏" : "████  ", "██  ██"])
    expect(art.compact.map((line) => Bun.stringWidth(line))).toEqual([6, 6, 6])
    expect(art.compact.join("")).not.toMatch(/[_^~,]/)
    expect(/[🬀-🬿]/u.test(rows.join(""))).toBe(modern)
  })
}
