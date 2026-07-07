/**
 * A small, self-contained vim emulation engine for the prompt textarea.
 *
 * The engine is intentionally decoupled from the OpenTUI renderable so it can be
 * unit-tested against a plain in-memory document. The prompt component adapts the
 * live `TextareaRenderable` to the {@link VimDoc} interface (see `index.tsx`).
 *
 * Supported (NORMAL mode):
 *   motions:   h j k l, w W b B e, 0 ^ $, gg G, with numeric counts (e.g. 3w, 5j)
 *   edits:     x X, D C, s, r{char}, dd cc yy, d/c/y + motion, p P
 *   inserts:   i I a A o O
 *   history:   u (undo), <C-r> (redo)
 *   visual:    v (charwise), V (linewise); motions extend the selection,
 *              d/x/c/s/y operate on it, o swaps ends, Esc/v/V exit
 *
 * This is a practical subset, not a complete vim. A few behaviours are
 * approximations of real vim and are documented inline.
 */

export type VimMode = "insert" | "normal" | "visual" | "visual-line"

/**
 * Minimal mutable document the engine operates on. Offsets are character
 * offsets into `text`, in the range [0, text.length].
 */
export interface VimDoc {
  readonly text: string
  readonly cursor: number
  setCursor(offset: number): void
  /** Insert `value` at `offset`. The engine sets the cursor separately. */
  insert(offset: number, value: string): void
  /** Remove the half-open range [start, end) and return the removed text. */
  remove(start: number, end: number): string
  undo(): void
  redo(): void
  /** Highlight the half-open range [start, end) (used to show a visual selection). */
  setSelection(start: number, end: number): void
  /** Clear any visual selection highlight. */
  clearSelection(): void
}

export interface VimRegister {
  text: string
  linewise: boolean
}

export interface VimState {
  mode: VimMode
  /** Digits accumulated for a numeric count, e.g. "12". */
  countDigits: string
  /** Pending operator awaiting a motion. */
  operator?: "d" | "c" | "y"
  /** `g` was pressed, waiting for the second key (e.g. `gg`). */
  awaitingG: boolean
  /** `r` was pressed, waiting for the replacement character. */
  awaitingReplace: boolean
  register: VimRegister
  /** Sticky column preserved across consecutive `j`/`k` moves (vim behaviour). */
  desiredColumn?: number
  /** Fixed end of the selection in visual modes; the cursor is the moving end. */
  visualAnchor?: number
}

export function createVimState(mode: VimMode = "insert"): VimState {
  return {
    mode,
    countDigits: "",
    awaitingG: false,
    awaitingReplace: false,
    register: { text: "", linewise: false },
  }
}

export interface VimKey {
  /** The literal character or named key (e.g. "w", "$", "escape"). */
  key: string
  ctrl?: boolean
}

export interface VimResult {
  /** Whether the engine consumed the key (caller should preventDefault). */
  handled: boolean
  /** True when the engine switched into insert mode as a result of this key. */
  enteredInsert?: boolean
}

// --- character classification --------------------------------------------

// Character classes for word motions (avoid `const enum` so the module stays
// safe under isolatedModules / esbuild per-file transpilation).
const CharClass = { Blank: 0, Word: 1, Punct: 2 } as const
type CharClass = (typeof CharClass)[keyof typeof CharClass]

function classOf(ch: string): CharClass {
  if (ch === "" || /\s/.test(ch)) return CharClass.Blank
  if (/[A-Za-z0-9_]/.test(ch)) return CharClass.Word
  return CharClass.Punct
}

function isBlank(ch: string): boolean {
  return ch === "" || /\s/.test(ch)
}

// --- line helpers ----------------------------------------------------------

export function lineStart(text: string, pos: number): number {
  if (pos <= 0) return 0
  const idx = text.lastIndexOf("\n", pos - 1)
  return idx === -1 ? 0 : idx + 1
}

export function lineEnd(text: string, pos: number): number {
  const idx = text.indexOf("\n", pos)
  return idx === -1 ? text.length : idx
}

function firstNonBlank(text: string, pos: number): number {
  const start = lineStart(text, pos)
  const end = lineEnd(text, pos)
  let i = start
  while (i < end && /\s/.test(text[i]!)) i++
  return i < end ? i : start
}

/**
 * Clamp a NORMAL-mode cursor so it rests on a character rather than past the
 * end of the line (vim never lets the block cursor sit on the trailing
 * newline of a non-empty line).
 */
export function clampNormal(text: string, pos: number): number {
  if (text.length === 0) return 0
  let p = Math.max(0, Math.min(pos, text.length))
  const start = lineStart(text, p)
  const end = lineEnd(text, p)
  if (end > start && p >= end) p = end - 1
  return p
}

// --- word motions ----------------------------------------------------------

function wordForward(text: string, pos: number, big: boolean): number {
  const n = text.length
  if (pos >= n) return n
  const startClass = big ? (isBlank(text[pos]!) ? CharClass.Blank : CharClass.Word) : classOf(text[pos]!)
  let i = pos
  // Skip the current run (same class) unless we're on whitespace.
  if (startClass !== CharClass.Blank) {
    const matches = (ch: string) => (big ? !isBlank(ch) : classOf(ch) === startClass)
    while (i < n && matches(text[i]!)) i++
  }
  // Skip following whitespace.
  while (i < n && isBlank(text[i]!)) i++
  return i
}

function wordBackward(text: string, pos: number, big: boolean): number {
  if (pos <= 0) return 0
  let i = pos - 1
  // Skip whitespace to the left.
  while (i > 0 && isBlank(text[i]!)) i--
  if (i <= 0) return 0
  const targetClass = big ? CharClass.Word : classOf(text[i]!)
  const matches = (ch: string) => (big ? !isBlank(ch) : classOf(ch) === targetClass)
  while (i > 0 && matches(text[i - 1]!)) i--
  return i
}

function wordEnd(text: string, pos: number, big: boolean): number {
  const n = text.length
  if (pos >= n - 1) return Math.max(0, n - 1)
  let i = pos + 1
  // Skip whitespace.
  while (i < n && isBlank(text[i]!)) i++
  if (i >= n) return n - 1
  const targetClass = big ? CharClass.Word : classOf(text[i]!)
  const matches = (ch: string) => (big ? !isBlank(ch) : classOf(ch) === targetClass)
  while (i + 1 < n && matches(text[i + 1]!)) i++
  return i
}

function verticalMove(text: string, pos: number, delta: number, col?: number): number {
  const start = lineStart(text, pos)
  const column = col ?? pos - start
  if (delta < 0) {
    if (start === 0) return pos
    const prevEnd = start - 1
    const prevStart = lineStart(text, prevEnd)
    return Math.min(prevStart + column, prevEnd)
  }
  const end = lineEnd(text, pos)
  if (end >= text.length) return pos
  const nextStart = end + 1
  const nextEnd = lineEnd(text, nextStart)
  return Math.min(nextStart + column, nextEnd)
}

/**
 * Move the cursor vertically `reps` lines, preserving a sticky desired column
 * across consecutive moves (matching vim's behaviour where a short
 * intermediate line does not permanently shrink the column).
 */
function moveVertical(doc: VimDoc, state: VimState, delta: number, reps: number) {
  const text = doc.text
  if (state.desiredColumn === undefined) {
    state.desiredColumn = doc.cursor - lineStart(text, doc.cursor)
  }
  let t = doc.cursor
  for (let i = 0; i < reps; i++) t = verticalMove(text, t, delta, state.desiredColumn)
  doc.setCursor(clampNormal(text, t))
}

// --- motion resolution -----------------------------------------------------

interface Motion {
  /** Target offset (cursor destination, or operator boundary). */
  target: number
  /** Inclusive motions (e.g. `e`, `$`) include the target char when used with an operator. */
  inclusive: boolean
  /** Linewise motions (e.g. `j`, `G`) operate on whole lines. */
  linewise: boolean
}

/**
 * Resolve a single-key motion. Returns undefined for keys that are not motions.
 */
function resolveMotion(text: string, pos: number, key: string, count: number, awaitingG: boolean): Motion | undefined {
  const reps = Math.max(1, count)
  if (awaitingG) {
    if (key === "g") {
      // gg -> first line (or `count`gg -> line `count`)
      let target = 0
      if (count > 0) {
        target = 0
        for (let line = 1; line < count; line++) target = Math.min(text.length, lineEnd(text, target) + 1)
      }
      return { target: firstNonBlank(text, target), inclusive: false, linewise: true }
    }
    return undefined
  }

  switch (key) {
    case "h": {
      let t = pos
      const start = lineStart(text, pos)
      for (let i = 0; i < reps && t > start; i++) t--
      return { target: t, inclusive: false, linewise: false }
    }
    case "l":
    case " ": {
      let t = pos
      const end = lineEnd(text, pos)
      for (let i = 0; i < reps && t < end; i++) t++
      return { target: t, inclusive: false, linewise: false }
    }
    case "j": {
      let t = pos
      for (let i = 0; i < reps; i++) t = verticalMove(text, t, +1)
      return { target: t, inclusive: false, linewise: true }
    }
    case "k": {
      let t = pos
      for (let i = 0; i < reps; i++) t = verticalMove(text, t, -1)
      return { target: t, inclusive: false, linewise: true }
    }
    case "w": {
      let t = pos
      for (let i = 0; i < reps; i++) t = wordForward(text, t, false)
      return { target: t, inclusive: false, linewise: false }
    }
    case "W": {
      let t = pos
      for (let i = 0; i < reps; i++) t = wordForward(text, t, true)
      return { target: t, inclusive: false, linewise: false }
    }
    case "b": {
      let t = pos
      for (let i = 0; i < reps; i++) t = wordBackward(text, t, false)
      return { target: t, inclusive: false, linewise: false }
    }
    case "B": {
      let t = pos
      for (let i = 0; i < reps; i++) t = wordBackward(text, t, true)
      return { target: t, inclusive: false, linewise: false }
    }
    case "e": {
      let t = pos
      for (let i = 0; i < reps; i++) t = wordEnd(text, t, false)
      return { target: t, inclusive: true, linewise: false }
    }
    case "E": {
      let t = pos
      for (let i = 0; i < reps; i++) t = wordEnd(text, t, true)
      return { target: t, inclusive: true, linewise: false }
    }
    case "0":
      return { target: lineStart(text, pos), inclusive: false, linewise: false }
    case "^":
      return { target: firstNonBlank(text, pos), inclusive: false, linewise: false }
    case "$": {
      let t = pos
      for (let i = 0; i < reps; i++) t = lineEnd(text, lineEnd(text, t) + (i === 0 ? 0 : 1))
      return { target: lineEnd(text, t), inclusive: true, linewise: false }
    }
    case "G": {
      let target = 0
      if (count > 0) {
        for (let line = 1; line < count; line++) target = Math.min(text.length, lineEnd(text, target) + 1)
      } else {
        target = text.length
      }
      return { target: firstNonBlank(text, target), inclusive: false, linewise: true }
    }
    default:
      return undefined
  }
}

// --- operators -------------------------------------------------------------

/**
 * Apply a `d`/`c`/`y` operator to whole lines spanning [start, contentEnd],
 * where `contentEnd` is the offset of the last line's trailing newline (or EOF
 * when the last line has none). Centralises the fiddly EOF rules so delete,
 * change and yank stay consistent:
 *   - yank/delete take the line(s) plus one adjoining newline (trailing, or the
 *     leading one when deleting through EOF) and the register is always
 *     newline-terminated so `p` pastes as full lines;
 *   - change removes only the line *content*, leaving an empty line to type on.
 */
function linewiseOperate(
  doc: VimDoc,
  state: VimState,
  operator: "d" | "c" | "y",
  start: number,
  contentEnd: number,
): VimResult {
  const text = doc.text
  const hasTrailingNewline = contentEnd < text.length
  const yanked = text.slice(start, hasTrailingNewline ? contentEnd + 1 : contentEnd)
  state.register = { text: yanked.endsWith("\n") ? yanked : yanked + "\n", linewise: true }

  if (operator === "y") {
    doc.setCursor(clampNormal(text, start))
    return { handled: true }
  }

  if (operator === "c") {
    // Keep the line, clear its content, and type on the now-empty line.
    if (contentEnd > start) doc.remove(start, contentEnd)
    doc.setCursor(start)
    state.mode = "insert"
    return { handled: true, enteredInsert: true }
  }

  // delete: remove the line(s) and one adjoining newline.
  const delStart = hasTrailingNewline ? start : start > 0 ? start - 1 : 0
  const delEnd = hasTrailingNewline ? contentEnd + 1 : contentEnd
  doc.remove(delStart, delEnd)
  doc.setCursor(clampNormal(doc.text, delStart))
  return { handled: true }
}

function applyOperator(
  doc: VimDoc,
  state: VimState,
  operator: "d" | "c" | "y",
  motion: Motion,
  pos: number,
): VimResult {
  const text = doc.text

  if (motion.linewise) {
    const a = Math.min(pos, motion.target)
    const b = Math.max(pos, motion.target)
    return linewiseOperate(doc, state, operator, lineStart(text, a), lineEnd(text, b))
  }

  const start = Math.min(pos, motion.target)
  let end = Math.max(pos, motion.target)
  if (motion.inclusive) end = Math.min(text.length, end + 1)

  if (start === end) return { handled: true }

  state.register = { text: text.slice(start, end), linewise: false }

  if (operator === "y") {
    doc.setCursor(clampNormal(text, start))
    return { handled: true }
  }

  doc.remove(start, end)
  if (operator === "c") {
    doc.setCursor(start)
    state.mode = "insert"
    return { handled: true, enteredInsert: true }
  }

  doc.setCursor(clampNormal(doc.text, start))
  return { handled: true }
}

function doubledOperator(doc: VimDoc, state: VimState, operator: "d" | "c" | "y"): VimResult {
  // dd / cc / yy — linewise on the current (and `count`) lines.
  const text = doc.text
  const reps = Math.max(1, parseInt(state.countDigits || "1", 10))
  const start = lineStart(text, doc.cursor)
  let contentEnd = lineEnd(text, start)
  for (let i = 1; i < reps; i++) {
    if (contentEnd >= text.length) break
    contentEnd = lineEnd(text, contentEnd + 1)
  }
  return linewiseOperate(doc, state, operator, start, contentEnd)
}

function paste(doc: VimDoc, state: VimState, after: boolean): VimResult {
  const reg = state.register
  if (!reg.text) return { handled: true }
  const payload = repeat(reg.text, Math.max(1, parseInt(state.countDigits || "1", 10)))
  if (reg.linewise) {
    const body = payload.endsWith("\n") ? payload : payload + "\n"
    if (after) {
      const le = lineEnd(doc.text, doc.cursor)
      if (le < doc.text.length) {
        // Normal case: paste a new line after the current line's newline.
        doc.insert(le + 1, body)
        doc.setCursor(clampNormal(doc.text, le + 1))
      } else {
        // Current line is the final line and has no trailing newline; add the
        // separator ourselves so the pasted line is not merged onto it.
        const core = body.endsWith("\n") ? body.slice(0, -1) : body
        const at = doc.text.length
        doc.insert(at, "\n" + core)
        doc.setCursor(clampNormal(doc.text, at + 1))
      }
    } else {
      const at = lineStart(doc.text, doc.cursor)
      doc.insert(at, body)
      doc.setCursor(clampNormal(doc.text, at))
    }
    return { handled: true }
  }
  const at = after ? Math.min(doc.text.length, doc.cursor + (doc.text.length === 0 ? 0 : 1)) : doc.cursor
  doc.insert(at, payload)
  doc.setCursor(clampNormal(doc.text, at + payload.length - 1))
  return { handled: true }
}

function repeat(value: string, times: number): string {
  let out = ""
  for (let i = 0; i < times; i++) out += value
  return out
}

// --- main entry point ------------------------------------------------------

/**
 * Process a key in NORMAL mode. Mutates `state` and `doc`. The caller is
 * responsible for routing INSERT-mode keys to the native textarea and only
 * invoking this when `state.mode === "normal"` (plus escape handling, see
 * {@link enterNormal}).
 */
export function handleNormalKey(doc: VimDoc, state: VimState, input: VimKey): VimResult {
  const { key } = input

  if (input.ctrl && key === "r") {
    doc.redo()
    resetPending(state)
    return { handled: true }
  }

  if (key === "escape") {
    resetPending(state)
    doc.setCursor(clampNormal(doc.text, doc.cursor))
    return { handled: true }
  }

  // Pending `r{char}` replace.
  if (state.awaitingReplace) {
    state.awaitingReplace = false
    if (key.length === 1) {
      const reps = Math.max(1, parseInt(state.countDigits || "1", 10))
      const start = doc.cursor
      const end = Math.min(doc.text.length, lineEnd(doc.text, start), start + reps)
      if (end > start) {
        doc.remove(start, end)
        doc.insert(start, repeat(key, end - start))
        doc.setCursor(clampNormal(doc.text, start + (end - start) - 1))
      }
    }
    state.countDigits = ""
    return { handled: true }
  }

  // Numeric count (a leading 0 is the line-start motion, not a count).
  if (/[0-9]/.test(key) && !(key === "0" && state.countDigits === "")) {
    state.countDigits += key
    return { handled: true }
  }

  const count = state.countDigits ? parseInt(state.countDigits, 10) : 0

  // Operator already pending: handle doubled operator or motion.
  if (state.operator) {
    const op = state.operator
    if (state.awaitingG && key !== "g") {
      resetPending(state)
      return { handled: true }
    }
    // Doubled operator (dd, cc, yy).
    if (!state.awaitingG && key === op) {
      const result = doubledOperator(doc, state, op)
      const enteredInsert = result.enteredInsert
      resetPending(state)
      if (enteredInsert) state.mode = "insert"
      return result
    }
    if (key === "g" && !state.awaitingG) {
      state.awaitingG = true
      return { handled: true }
    }
    // vim special case: `cw`/`cW` behave like `ce`/`cE` (change to word end).
    const motionKey = op === "c" && !state.awaitingG && (key === "w" || key === "W") ? (key === "w" ? "e" : "E") : key
    const motion = resolveMotion(doc.text, doc.cursor, motionKey, count, state.awaitingG)
    if (!motion) {
      resetPending(state)
      return { handled: true }
    }
    const result = applyOperator(doc, state, op, motion, doc.cursor)
    const enteredInsert = result.enteredInsert
    resetPending(state)
    if (enteredInsert) state.mode = "insert"
    return result
  }

  // `g` prefix (gg).
  if (key === "g" && !state.awaitingG) {
    state.awaitingG = true
    return { handled: true }
  }
  if (state.awaitingG) {
    const motion = resolveMotion(doc.text, doc.cursor, key, count, true)
    state.awaitingG = false
    state.countDigits = ""
    if (motion) doc.setCursor(clampNormal(doc.text, motion.target))
    return { handled: true }
  }

  // Operators.
  if (key === "d" || key === "c" || key === "y") {
    state.operator = key
    return { handled: true }
  }

  // Visual mode entry.
  if (key === "v" || key === "V") {
    state.mode = key === "v" ? "visual" : "visual-line"
    state.visualAnchor = doc.cursor
    state.countDigits = ""
    updateVisualSelection(doc, state)
    return { handled: true }
  }

  // Insert-mode transitions.
  switch (key) {
    case "i":
      state.mode = "insert"
      resetPending(state)
      return { handled: true, enteredInsert: true }
    case "I":
      doc.setCursor(firstNonBlank(doc.text, doc.cursor))
      state.mode = "insert"
      resetPending(state)
      return { handled: true, enteredInsert: true }
    case "a":
      doc.setCursor(Math.min(doc.text.length, doc.cursor + (doc.text.length === 0 ? 0 : 1)))
      state.mode = "insert"
      resetPending(state)
      return { handled: true, enteredInsert: true }
    case "A":
      doc.setCursor(lineEnd(doc.text, doc.cursor))
      state.mode = "insert"
      resetPending(state)
      return { handled: true, enteredInsert: true }
    case "o": {
      const end = lineEnd(doc.text, doc.cursor)
      doc.insert(end, "\n")
      doc.setCursor(end + 1)
      state.mode = "insert"
      resetPending(state)
      return { handled: true, enteredInsert: true }
    }
    case "O": {
      const start = lineStart(doc.text, doc.cursor)
      doc.insert(start, "\n")
      doc.setCursor(start)
      state.mode = "insert"
      resetPending(state)
      return { handled: true, enteredInsert: true }
    }
  }

  // Single-key edits.
  switch (key) {
    case "x": {
      const reps = Math.max(1, count)
      const start = doc.cursor
      const end = Math.min(lineEnd(doc.text, start), start + reps)
      if (end > start) {
        state.register = { text: doc.text.slice(start, end), linewise: false }
        doc.remove(start, end)
        doc.setCursor(clampNormal(doc.text, start))
      }
      state.countDigits = ""
      return { handled: true }
    }
    case "X": {
      const reps = Math.max(1, count)
      const lstart = lineStart(doc.text, doc.cursor)
      const start = Math.max(lstart, doc.cursor - reps)
      if (doc.cursor > start) {
        state.register = { text: doc.text.slice(start, doc.cursor), linewise: false }
        doc.remove(start, doc.cursor)
        doc.setCursor(clampNormal(doc.text, start))
      }
      state.countDigits = ""
      return { handled: true }
    }
    case "D": {
      const start = doc.cursor
      const end = lineEnd(doc.text, start)
      if (end > start) {
        state.register = { text: doc.text.slice(start, end), linewise: false }
        doc.remove(start, end)
        doc.setCursor(clampNormal(doc.text, start))
      }
      state.countDigits = ""
      return { handled: true }
    }
    case "C": {
      const start = doc.cursor
      const end = lineEnd(doc.text, start)
      if (end > start) {
        state.register = { text: doc.text.slice(start, end), linewise: false }
        doc.remove(start, end)
      }
      doc.setCursor(start)
      state.mode = "insert"
      state.countDigits = ""
      return { handled: true, enteredInsert: true }
    }
    case "s": {
      const reps = Math.max(1, count)
      const start = doc.cursor
      const end = Math.min(lineEnd(doc.text, start), start + reps)
      if (end > start) {
        state.register = { text: doc.text.slice(start, end), linewise: false }
        doc.remove(start, end)
      }
      doc.setCursor(start)
      state.mode = "insert"
      state.countDigits = ""
      return { handled: true, enteredInsert: true }
    }
    case "r":
      state.awaitingReplace = true
      return { handled: true }
    case "p":
      return finishSimple(state, paste(doc, state, true))
    case "P":
      return finishSimple(state, paste(doc, state, false))
    case "u":
      doc.undo()
      state.countDigits = ""
      return { handled: true }
  }

  // Plain vertical motions preserve a sticky desired column.
  if (key === "j" || key === "k") {
    moveVertical(doc, state, key === "j" ? +1 : -1, Math.max(1, count))
    state.countDigits = ""
    return { handled: true }
  }

  // Plain motions.
  const motion = resolveMotion(doc.text, doc.cursor, key, count, false)
  if (motion) {
    state.desiredColumn = undefined
    doc.setCursor(clampNormal(doc.text, motion.target))
    state.countDigits = ""
    return { handled: true }
  }

  // Unknown key: swallow it so stray characters never leak into the prompt
  // while in NORMAL mode.
  state.countDigits = ""
  return { handled: true }
}

function finishSimple(state: VimState, result: VimResult): VimResult {
  state.countDigits = ""
  return result
}

function resetPending(state: VimState) {
  state.operator = undefined
  state.awaitingG = false
  state.awaitingReplace = false
  state.countDigits = ""
  state.desiredColumn = undefined
}

/** Switch to NORMAL mode, clamping the cursor like vim does on `<Esc>`. */
export function enterNormal(doc: VimDoc, state: VimState) {
  state.mode = "normal"
  state.visualAnchor = undefined
  doc.clearSelection()
  resetPending(state)
  // On leaving insert mode vim moves the cursor one left (unless at line start).
  const start = lineStart(doc.text, doc.cursor)
  if (doc.cursor > start) doc.setCursor(doc.cursor - 1)
  doc.setCursor(clampNormal(doc.text, doc.cursor))
}

// --- visual mode -----------------------------------------------------------

function updateVisualSelection(doc: VimDoc, state: VimState) {
  if (doc.text.length === 0) {
    doc.clearSelection()
    return
  }
  const anchor = state.visualAnchor ?? doc.cursor
  const a = Math.min(anchor, doc.cursor)
  const b = Math.max(anchor, doc.cursor)
  if (state.mode === "visual-line") {
    doc.setSelection(lineStart(doc.text, a), lineEnd(doc.text, b))
    return
  }
  doc.setSelection(a, Math.min(doc.text.length, b + 1))
}

/** Leave any visual mode and return to NORMAL, clearing the highlight. */
export function exitVisual(doc: VimDoc, state: VimState) {
  state.mode = "normal"
  state.visualAnchor = undefined
  doc.clearSelection()
  resetPending(state)
  doc.setCursor(clampNormal(doc.text, doc.cursor))
}

function visualOperate(doc: VimDoc, state: VimState, op: "d" | "c" | "y"): VimResult {
  const linewise = state.mode === "visual-line"
  const anchor = state.visualAnchor ?? doc.cursor
  const a = Math.min(anchor, doc.cursor)
  const b = Math.max(anchor, doc.cursor)
  doc.clearSelection()
  state.visualAnchor = undefined

  let result: VimResult
  if (linewise) {
    result = linewiseOperate(doc, state, op, lineStart(doc.text, a), lineEnd(doc.text, b))
  } else {
    const start = a
    const end = Math.min(doc.text.length, b + 1) // charwise visual is inclusive
    if (start === end) {
      exitVisual(doc, state)
      return { handled: true }
    }
    state.register = { text: doc.text.slice(start, end), linewise: false }
    if (op === "y") {
      doc.setCursor(clampNormal(doc.text, start))
      result = { handled: true }
    } else {
      doc.remove(start, end)
      if (op === "c") {
        doc.setCursor(start)
        state.mode = "insert"
        result = { handled: true, enteredInsert: true }
      } else {
        doc.setCursor(clampNormal(doc.text, start))
        result = { handled: true }
      }
    }
  }

  if (!result.enteredInsert) state.mode = "normal"
  resetPending(state)
  return result
}

/**
 * Process a key in VISUAL / VISUAL-LINE mode. Mutates `state` and `doc`. The
 * caller routes here when `state.mode` is "visual" or "visual-line".
 */
export function handleVisualKey(doc: VimDoc, state: VimState, input: VimKey): VimResult {
  const { key } = input

  if (key === "escape") {
    exitVisual(doc, state)
    return { handled: true }
  }

  // Numeric count (a leading 0 is the line-start motion, not a count).
  if (/[0-9]/.test(key) && !(key === "0" && state.countDigits === "")) {
    state.countDigits += key
    return { handled: true }
  }
  const count = state.countDigits ? parseInt(state.countDigits, 10) : 0

  // `g` prefix (gg).
  if (key === "g" && !state.awaitingG) {
    state.awaitingG = true
    return { handled: true }
  }
  if (state.awaitingG) {
    const motion = resolveMotion(doc.text, doc.cursor, key, count, true)
    state.awaitingG = false
    state.countDigits = ""
    if (motion) {
      doc.setCursor(clampNormal(doc.text, motion.target))
      updateVisualSelection(doc, state)
    }
    return { handled: true }
  }

  // Toggle / switch visual sub-modes.
  if (key === "v") {
    if (state.mode === "visual") exitVisual(doc, state)
    else {
      state.mode = "visual"
      updateVisualSelection(doc, state)
    }
    state.countDigits = ""
    return { handled: true }
  }
  if (key === "V") {
    if (state.mode === "visual-line") exitVisual(doc, state)
    else {
      state.mode = "visual-line"
      updateVisualSelection(doc, state)
    }
    state.countDigits = ""
    return { handled: true }
  }

  // Swap the moving end with the anchor.
  if (key === "o") {
    const anchor = state.visualAnchor ?? doc.cursor
    state.visualAnchor = doc.cursor
    doc.setCursor(clampNormal(doc.text, anchor))
    updateVisualSelection(doc, state)
    state.countDigits = ""
    return { handled: true }
  }

  // Operators act on the selection, then leave visual mode.
  if (key === "d" || key === "x") return finishSimple(state, visualOperate(doc, state, "d"))
  if (key === "c" || key === "s") return finishSimple(state, visualOperate(doc, state, "c"))
  if (key === "y") return finishSimple(state, visualOperate(doc, state, "y"))

  // Motions extend the selection.
  if (key === "j" || key === "k") {
    moveVertical(doc, state, key === "j" ? +1 : -1, Math.max(1, count))
    updateVisualSelection(doc, state)
    state.countDigits = ""
    return { handled: true }
  }
  const motion = resolveMotion(doc.text, doc.cursor, key, count, false)
  if (motion) {
    state.desiredColumn = undefined
    doc.setCursor(clampNormal(doc.text, motion.target))
    updateVisualSelection(doc, state)
    state.countDigits = ""
    return { handled: true }
  }

  // Unknown key: swallow so nothing leaks into the prompt.
  state.countDigits = ""
  return { handled: true }
}

export function enterInsert(state: VimState) {
  state.mode = "insert"
  resetPending(state)
}
