import { describe, expect, test } from "bun:test"
import { VtScreen } from "../../src/kilocode/cli/cmd/tui/vt/vt-screen"

const ESC = "\x1b"
const CSI = ESC + "["

describe("VtScreen", () => {
  test("plain text lands on the grid", () => {
    const vt = new VtScreen(20, 5)
    vt.write("hello")
    expect(vt.lines()[0]).toBe("hello")
    expect(vt.cursor()).toEqual({ x: 5, y: 0 })
  })

  test("newline and carriage return", () => {
    const vt = new VtScreen(20, 5)
    vt.write("ab\r\ncd")
    expect(vt.lines()[0]).toBe("ab")
    expect(vt.lines()[1]).toBe("cd")
  })

  test("carriage return overwrites the current line", () => {
    const vt = new VtScreen(20, 5)
    vt.write("hello\rworld")
    expect(vt.lines()[0]).toBe("world")
  })

  test("backspace moves cursor back", () => {
    const vt = new VtScreen(20, 5)
    vt.write("abc\b\bX")
    expect(vt.lines()[0]).toBe("aXc")
  })

  test("tab advances to the next tab stop", () => {
    const vt = new VtScreen(40, 5)
    vt.write("a\tb")
    expect(vt.lines()[0]).toBe("a       b")
  })

  test("autowrap to the next line at the right edge", () => {
    const vt = new VtScreen(3, 5)
    vt.write("abcd")
    expect(vt.lines()[0]).toBe("abc")
    expect(vt.lines()[1]).toBe("d")
  })

  test("CUP positions the cursor and writes there", () => {
    const vt = new VtScreen(20, 5)
    vt.write(CSI + "3;5H" + "X")
    expect(vt.cursor()).toEqual({ x: 5, y: 2 })
    expect(vt.lines()[2]).toBe("    X")
  })

  test("cursor up then overwrite line (gh-style redraw)", () => {
    const vt = new VtScreen(20, 5)
    vt.write("choice: one\r\nchoice: two\r\n")
    // move up 2 lines, clear line, rewrite first choice as selected
    vt.write(CSI + "2A" + "\r" + CSI + "2K" + "> one")
    expect(vt.lines()[0]).toBe("> one")
    expect(vt.lines()[1]).toBe("choice: two")
  })

  test("erase in line (EL 0/1/2)", () => {
    const vt = new VtScreen(10, 3)
    vt.write("abcdef")
    vt.write("\r" + CSI + "3C" + CSI + "0K") // cursor to col 3, clear to end
    expect(vt.lines()[0]).toBe("abc")

    const vt2 = new VtScreen(10, 3)
    vt2.write("abcdef")
    vt2.write(CSI + "2K")
    expect(vt2.lines()[0]).toBe("")
  })

  test("erase in display (ED 2) clears everything", () => {
    const vt = new VtScreen(10, 3)
    vt.write("a\r\nb\r\nc")
    vt.write(CSI + "2J")
    expect(vt.text()).toBe("")
  })

  test("scroll up when writing past the bottom", () => {
    const vt = new VtScreen(10, 2)
    vt.write("one\r\ntwo\r\nthree")
    expect(vt.lines()[0]).toBe("two")
    expect(vt.lines()[1]).toBe("three")
  })

  test("SGR sets foreground color and attributes on cells", () => {
    const vt = new VtScreen(20, 3)
    vt.write(CSI + "1;31m" + "R" + CSI + "0m" + "n")
    const row = vt.cells()[0]
    expect(row[0].char).toBe("R")
    expect(row[0].fg).toBe(1)
    expect(row[0].bold).toBe(true)
    expect(row[1].char).toBe("n")
    expect(row[1].fg).toBeUndefined()
    expect(row[1].bold).toBeFalsy()
  })

  test("SGR 256 and truecolor", () => {
    const vt = new VtScreen(20, 3)
    vt.write(CSI + "38;5;200m" + "a" + CSI + "38;2;10;20;30m" + "b")
    const row = vt.cells()[0]
    expect(row[0].fg).toBe(200)
    expect(row[1].fg).toEqual({ r: 10, g: 20, b: 30 })
  })

  test("save and restore cursor", () => {
    const vt = new VtScreen(20, 5)
    vt.write(CSI + "2;3H") // row 2 col 3
    vt.write(ESC + "7") // save
    vt.write(CSI + "5;5H" + "X")
    vt.write(ESC + "8") // restore
    vt.write("Y")
    expect(vt.cursor()).toEqual({ x: 3, y: 1 })
    expect(vt.lines()[1]).toBe("  Y")
  })

  test("unknown escape sequences do not corrupt the grid", () => {
    const vt = new VtScreen(20, 3)
    vt.write("a" + CSI + "99999;1!p" + "b" + ESC + "]0;title\x07" + "c")
    expect(vt.lines()[0]).toBe("abc")
  })

  test("cursor hide/show via private mode", () => {
    const vt = new VtScreen(10, 2)
    vt.write(CSI + "?25l")
    expect(vt.cursorVisible).toBe(false)
    vt.write(CSI + "?25h")
    expect(vt.cursorVisible).toBe(true)
  })

  test("resize preserves content within bounds", () => {
    const vt = new VtScreen(10, 3)
    vt.write("hello")
    vt.resize(20, 5)
    expect(vt.cols).toBe(20)
    expect(vt.rows).toBe(5)
    expect(vt.lines()[0]).toBe("hello")
  })

  test("retains the latest 500 scrolled lines", () => {
    const vt = new VtScreen(12, 3)
    for (let index = 0; index < 520; index++) vt.write(`line-${index}\r\n`)

    expect(vt.scrollbackSize()).toBe(500)
    expect(vt.scrollCount()).toBe(518)
    expect(vt.viewLines(0, 3)).toEqual(["line-518", "line-519", ""])
    expect(vt.viewLines(500, 3)).toEqual(["line-18", "line-19", "line-20"])
  })

  test("views scrollback using an offset from the bottom", () => {
    const vt = new VtScreen(12, 3)
    for (let index = 0; index < 10; index++) vt.write(`line-${index}\r\n`)

    expect(vt.viewLines(0, 3)).toEqual(["line-8", "line-9", ""])
    expect(vt.viewLines(2, 3)).toEqual(["line-6", "line-7", "line-8"])
    expect(vt.viewText(2, 3)).toBe("line-6\nline-7\nline-8")
  })

  test("ED 3 clears scrollback", () => {
    const vt = new VtScreen(12, 3)
    for (let index = 0; index < 10; index++) vt.write(`line-${index}\r\n`)
    expect(vt.scrollbackSize()).toBeGreaterThan(0)

    vt.write(CSI + "3J")
    expect(vt.scrollbackSize()).toBe(0)
  })
})
