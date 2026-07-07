// Minimal VT/ANSI screen emulator for the interactive terminal dialog.
//
// This is intentionally small: it covers the escape sequences that line-oriented
// interactive prompts emit (credential prompts, `gh auth login`'s arrow-key
// survey UI, REPLs, `ssh` passphrase, installers): SGR colors/attrs, cursor
// movement, erase-in-line / erase-in-display, scrolling, save/restore cursor,
// tab/backspace/carriage-return. It deliberately does NOT aim for full
// terminal fidelity (no sixel, no full alt-screen app rendering); unknown
// sequences are dropped without corrupting the grid.
//
// Pure and dependency-free so it can be unit tested by feeding raw bytes and
// asserting the resulting grid. Color is normalized to a transport-neutral
// shape (palette index or rgb) and mapped to OpenTUI/theme colors by the caller.

export type Color = number | { r: number; g: number; b: number }

export interface Cell {
  char: string
  fg?: Color
  bg?: Color
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

interface Attrs {
  fg?: Color
  bg?: Color
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

const TAB = 8
const MAX_ROWS = 200 // hard cap so a runaway program can't grow the grid unbounded
export const SCROLLBACK_LINES = 500

function blank(attrs?: Attrs): Cell {
  return { char: " ", ...(attrs ?? {}) }
}

export class VtScreen {
  cols: number
  rows: number
  private grid: Cell[][]
  private history: Cell[][] = []
  private scrolled = 0
  private cur = { x: 0, y: 0 }
  private saved = { x: 0, y: 0 }
  private attrs: Attrs = {}
  private top = 0
  private bottom: number
  private wrapPending = false
  cursorVisible = true

  // parser state
  private state: "ground" | "esc" | "csi" | "osc" | "osc-esc" = "ground"
  private params = ""
  private intermediate = ""

  constructor(cols = 80, rows = 24) {
    this.cols = Math.max(1, cols)
    this.rows = Math.max(1, Math.min(MAX_ROWS, rows))
    this.bottom = this.rows - 1
    this.grid = Array.from({ length: this.rows }, () => this.row())
  }

  private row(): Cell[] {
    return Array.from({ length: this.cols }, () => blank())
  }

  /** Current grid snapshot for rendering (rows of cells). */
  cells(): ReadonlyArray<ReadonlyArray<Cell>> {
    return this.grid
  }

  /** Plain text per line, trailing blanks trimmed. Used by tests and fallbacks. */
  lines(): string[] {
    return this.grid.map((row) => {
      let text = row.map((c) => c.char).join("")
      return text.replace(/\s+$/u, "")
    })
  }

  /** Whole screen as text with trailing empty lines removed. */
  text(): string {
    const lines = this.lines()
    let end = lines.length
    while (end > 0 && lines[end - 1] === "") end--
    return lines.slice(0, end).join("\n")
  }

  scrollbackSize() {
    return this.history.length
  }

  scrollCount() {
    return this.scrolled
  }

  viewLines(offset = 0, height = this.rows) {
    const rows = [...this.history, ...this.grid]
    const size = Math.max(1, Math.min(rows.length, height))
    const distance = Math.max(0, Math.min(this.history.length, offset))
    const end = rows.length - distance
    const start = Math.max(0, end - size)
    return rows.slice(start, end).map((row) =>
      row
        .map((cell) => cell.char)
        .join("")
        .replace(/\s+$/u, ""),
    )
  }

  viewText(offset = 0, height = this.rows) {
    return this.viewLines(offset, height).join("\n")
  }

  cursor() {
    return { x: this.cur.x, y: this.cur.y }
  }

  resize(cols: number, rows: number) {
    cols = Math.max(1, cols)
    rows = Math.max(1, Math.min(MAX_ROWS, rows))
    if (cols === this.cols && rows === this.rows) return
    const next = Array.from({ length: rows }, (_, y) => {
      const old = this.grid[y]
      return Array.from({ length: cols }, (_, x) => old?.[x] ?? blank())
    })
    const history = this.history.map((row) => Array.from({ length: cols }, (_, x) => row[x] ?? blank()))
    this.cols = cols
    this.rows = rows
    this.grid = next
    this.history = history
    this.top = 0
    this.bottom = rows - 1
    this.cur.x = Math.min(this.cur.x, cols - 1)
    this.cur.y = Math.min(this.cur.y, rows - 1)
    this.wrapPending = false
  }

  write(data: string) {
    for (const ch of data) {
      const code = ch.codePointAt(0)!
      if (this.state === "ground") this.ground(ch, code)
      else if (this.state === "esc") this.esc(ch)
      else if (this.state === "csi") this.csi(ch, code)
      else this.osc(ch, code)
    }
  }

  private ground(ch: string, code: number) {
    if (code === 0x1b) {
      this.state = "esc"
      this.params = ""
      this.intermediate = ""
      return
    }
    if (code === 0x0a || code === 0x0b || code === 0x0c) return this.lineFeed() // LF/VT/FF
    if (code === 0x0d) {
      this.cur.x = 0
      this.wrapPending = false
      return
    }
    if (code === 0x08) {
      this.cur.x = Math.max(0, this.cur.x - 1)
      this.wrapPending = false
      return
    }
    if (code === 0x09) {
      const next = Math.min(this.cols - 1, (Math.floor(this.cur.x / TAB) + 1) * TAB)
      this.cur.x = next
      return
    }
    if (code === 0x07) return // BEL
    if (code < 0x20) return // other C0 controls ignored
    this.put(ch)
  }

  private put(ch: string) {
    if (this.wrapPending) {
      this.cur.x = 0
      this.lineFeed()
      this.wrapPending = false
    }
    const line = this.grid[this.cur.y]
    if (!line) return
    line[this.cur.x] = { char: ch, ...this.attrs }
    if (this.cur.x === this.cols - 1) this.wrapPending = true
    else this.cur.x++
  }

  private lineFeed() {
    if (this.cur.y === this.bottom) {
      this.scrollUp(1)
      return
    }
    if (this.cur.y < this.rows - 1) this.cur.y++
  }

  private scrollUp(n: number) {
    for (let i = 0; i < n; i++) {
      const removed = this.grid.splice(this.top, 1)[0]
      if (removed && this.top === 0 && this.bottom === this.rows - 1) {
        this.history.push(removed)
        this.scrolled++
        if (this.history.length > SCROLLBACK_LINES) this.history.splice(0, this.history.length - SCROLLBACK_LINES)
      }
      this.grid.splice(this.bottom, 0, this.row())
    }
  }

  private scrollDown(n: number) {
    for (let i = 0; i < n; i++) {
      this.grid.splice(this.bottom, 1)
      this.grid.splice(this.top, 0, this.row())
    }
  }

  private esc(ch: string) {
    if (ch === "[") {
      this.state = "csi"
      this.params = ""
      this.intermediate = ""
      return
    }
    if (ch === "]") {
      this.state = "osc"
      return
    }
    if (ch === "7") {
      this.saveCursor()
      this.state = "ground"
      return
    }
    if (ch === "8") {
      this.restoreCursor()
      this.state = "ground"
      return
    }
    if (ch === "M") {
      // reverse index: move up, scroll down at top
      if (this.cur.y === this.top) this.scrollDown(1)
      else this.cur.y = Math.max(0, this.cur.y - 1)
      this.state = "ground"
      return
    }
    if (ch === "c") {
      this.reset()
      this.state = "ground"
      return
    }
    if (ch === "(" || ch === ")" || ch === "#" || ch === "%") {
      // charset designators consume one more byte; approximate by staying in
      // esc for the next char then dropping it.
      this.intermediate = ch
      return
    }
    if (this.intermediate) {
      // drop the charset payload byte
      this.intermediate = ""
      this.state = "ground"
      return
    }
    this.state = "ground"
  }

  private osc(ch: string, code: number) {
    if (code === 0x07) {
      this.state = "ground"
      return
    }
    if (this.state === "osc" && code === 0x1b) {
      this.state = "osc-esc"
      return
    }
    if (this.state === "osc-esc" && ch === "\\") {
      this.state = "ground"
      return
    }
    this.state = "osc"
  }

  private csi(ch: string, code: number) {
    // params: digits, ';', and a leading '?' private marker
    if ((code >= 0x30 && code <= 0x3f) || ch === ":") {
      this.params += ch
      return
    }
    if (code >= 0x20 && code <= 0x2f) {
      this.intermediate += ch
      return
    }
    this.dispatch(ch)
    this.state = "ground"
  }

  private nums(): number[] {
    const raw = this.params.startsWith("?") ? this.params.slice(1) : this.params
    if (raw === "") return []
    return raw.split(";").map((p) => {
      const n = parseInt(p, 10)
      return Number.isFinite(n) ? n : 0
    })
  }

  private dispatch(ch: string) {
    const priv = this.params.startsWith("?")
    const p = this.nums()
    const n = p[0] && p[0] > 0 ? p[0] : 1
    switch (ch) {
      case "A":
        this.cur.y = Math.max(this.top, this.cur.y - n)
        this.wrapPending = false
        return
      case "B":
        this.cur.y = Math.min(this.bottom, this.cur.y + n)
        this.wrapPending = false
        return
      case "C":
        this.cur.x = Math.min(this.cols - 1, this.cur.x + n)
        this.wrapPending = false
        return
      case "D":
        this.cur.x = Math.max(0, this.cur.x - n)
        this.wrapPending = false
        return
      case "E":
        this.cur.y = Math.min(this.bottom, this.cur.y + n)
        this.cur.x = 0
        this.wrapPending = false
        return
      case "F":
        this.cur.y = Math.max(this.top, this.cur.y - n)
        this.cur.x = 0
        this.wrapPending = false
        return
      case "G":
        this.cur.x = Math.min(this.cols - 1, Math.max(0, (p[0] ?? 1) - 1))
        this.wrapPending = false
        return
      case "d":
        this.cur.y = Math.min(this.rows - 1, Math.max(0, (p[0] ?? 1) - 1))
        this.wrapPending = false
        return
      case "H":
      case "f": {
        const r = (p[0] ?? 1) - 1
        const c = (p[1] ?? 1) - 1
        this.cur.y = Math.min(this.rows - 1, Math.max(0, r))
        this.cur.x = Math.min(this.cols - 1, Math.max(0, c))
        this.wrapPending = false
        return
      }
      case "J":
        this.eraseDisplay(p[0] ?? 0)
        return
      case "K":
        this.eraseLine(p[0] ?? 0)
        return
      case "X":
        this.eraseChars(n)
        return
      case "P":
        this.deleteChars(n)
        return
      case "@":
        this.insertChars(n)
        return
      case "L":
        this.insertLines(n)
        return
      case "M":
        this.deleteLines(n)
        return
      case "S":
        this.scrollUp(n)
        return
      case "T":
        this.scrollDown(n)
        return
      case "m":
        this.sgr(p)
        return
      case "r": {
        this.top = Math.max(0, (p[0] ?? 1) - 1)
        this.bottom = Math.min(this.rows - 1, (p[1] ?? this.rows) - 1)
        if (this.bottom < this.top) {
          this.top = 0
          this.bottom = this.rows - 1
        }
        this.cur.x = 0
        this.cur.y = this.top
        return
      }
      case "s":
        this.saveCursor()
        return
      case "u":
        this.restoreCursor()
        return
      case "h":
        if (priv && p.includes(25)) this.cursorVisible = true
        if (priv && (p.includes(1049) || p.includes(47) || p.includes(1047))) this.clearAll()
        return
      case "l":
        if (priv && p.includes(25)) this.cursorVisible = false
        if (priv && (p.includes(1049) || p.includes(47) || p.includes(1047))) this.clearAll()
        return
      default:
        return
    }
  }

  private eraseLine(mode: number) {
    const line = this.grid[this.cur.y]
    if (!line) return
    const from = mode === 0 ? this.cur.x : 0
    const to = mode === 1 ? this.cur.x : this.cols - 1
    for (let x = from; x <= to; x++) line[x] = blank(this.attrs)
  }

  private eraseDisplay(mode: number) {
    if (mode === 2 || mode === 3) {
      if (mode === 3) this.history = []
      this.clearAll()
      return
    }
    if (mode === 0) {
      this.eraseLine(0)
      for (let y = this.cur.y + 1; y < this.rows; y++) this.grid[y] = this.row()
      return
    }
    // mode 1: start of screen to cursor
    for (let y = 0; y < this.cur.y; y++) this.grid[y] = this.row()
    const line = this.grid[this.cur.y]
    if (line) for (let x = 0; x <= this.cur.x; x++) line[x] = blank(this.attrs)
  }

  private eraseChars(n: number) {
    const line = this.grid[this.cur.y]
    if (!line) return
    for (let i = 0; i < n && this.cur.x + i < this.cols; i++) line[this.cur.x + i] = blank(this.attrs)
  }

  private deleteChars(n: number) {
    const line = this.grid[this.cur.y]
    if (!line) return
    line.splice(this.cur.x, n)
    while (line.length < this.cols) line.push(blank(this.attrs))
  }

  private insertChars(n: number) {
    const line = this.grid[this.cur.y]
    if (!line) return
    for (let i = 0; i < n; i++) line.splice(this.cur.x, 0, blank(this.attrs))
    line.length = this.cols
  }

  private insertLines(n: number) {
    if (this.cur.y < this.top || this.cur.y > this.bottom) return
    for (let i = 0; i < n; i++) {
      this.grid.splice(this.bottom, 1)
      this.grid.splice(this.cur.y, 0, this.row())
    }
  }

  private deleteLines(n: number) {
    if (this.cur.y < this.top || this.cur.y > this.bottom) return
    for (let i = 0; i < n; i++) {
      this.grid.splice(this.cur.y, 1)
      this.grid.splice(this.bottom, 0, this.row())
    }
  }

  private saveCursor() {
    this.saved = { x: this.cur.x, y: this.cur.y }
  }

  private restoreCursor() {
    this.cur = { x: Math.min(this.saved.x, this.cols - 1), y: Math.min(this.saved.y, this.rows - 1) }
    this.wrapPending = false
  }

  private clearAll() {
    this.grid = Array.from({ length: this.rows }, () => this.row())
    this.cur = { x: 0, y: 0 }
    this.wrapPending = false
  }

  private reset() {
    this.attrs = {}
    this.history = []
    this.top = 0
    this.bottom = this.rows - 1
    this.clearAll()
  }

  private sgr(p: number[]) {
    if (p.length === 0) {
      this.attrs = {}
      return
    }
    for (let i = 0; i < p.length; i++) {
      const code = p[i]
      if (code === 0) this.attrs = {}
      else if (code === 1) this.attrs.bold = true
      else if (code === 2) this.attrs.dim = true
      else if (code === 3) this.attrs.italic = true
      else if (code === 4) this.attrs.underline = true
      else if (code === 7) this.attrs.inverse = true
      else if (code === 22) {
        this.attrs.bold = false
        this.attrs.dim = false
      } else if (code === 23) this.attrs.italic = false
      else if (code === 24) this.attrs.underline = false
      else if (code === 27) this.attrs.inverse = false
      else if (code >= 30 && code <= 37) this.attrs.fg = code - 30
      else if (code === 39) this.attrs.fg = undefined
      else if (code >= 40 && code <= 47) this.attrs.bg = code - 40
      else if (code === 49) this.attrs.bg = undefined
      else if (code >= 90 && code <= 97) this.attrs.fg = code - 90 + 8
      else if (code >= 100 && code <= 107) this.attrs.bg = code - 100 + 8
      else if (code === 38 || code === 48) {
        const target = code === 38 ? "fg" : "bg"
        const mode = p[i + 1]
        if (mode === 5) {
          this.attrs[target] = p[i + 2] ?? 0
          i += 2
        } else if (mode === 2) {
          this.attrs[target] = { r: p[i + 2] ?? 0, g: p[i + 3] ?? 0, b: p[i + 4] ?? 0 }
          i += 4
        }
      }
    }
  }
}
