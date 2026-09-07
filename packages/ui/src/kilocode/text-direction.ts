// Direction detection for displayed text.
//
// `dir="auto"` resolves direction from the FIRST strong character only, so a
// message like "OK باشه من این تابع را عوض میکنم" renders left-to-right even
// though it is almost entirely Persian. That is the common case for technical
// RTL text, which regularly opens with an identifier, a command, or a latin
// acronym.
//
// Instead of first-strong, count the strong-directional WORDS and pick the
// paragraph direction from the mix.

const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thaana}\p{Script=Syriac}\p{Script=Nko}\p{Script=Adlam}]/u
const LTR = /\p{L}/u

// Invisible characters must never vote. U+061C ARABIC LETTER MARK and friends
// are Script=Arabic but render nothing, so counting them lets text that looks
// purely latin force the whole block to rtl.
const INVISIBLE = /[\p{Cf}\p{Cc}\p{Mn}\p{Me}]/gu

// A minority of RTL words still flips the whole block, because RTL text mixed
// with latin identifiers is far more common than the reverse. Two RTL words is
// the floor so a single borrowed word never flips an English sentence.
const MIN_WORDS = 2
const RATIO = 1 / 3

// Direction only needs a representative sample, and the counting regexes are
// linear per character. Cap the input so a giant pasted blob cannot stall a
// render that reruns on every streamed chunk.
const MAX = 8000

// Token runs are bounded so the scans stay linear on a long unbroken token
// such as a base64 data URI or a minified bundle.
const RUN = 64

export type TextDirection = "rtl" | "ltr" | "auto"

// Code, tags, URLs and paths are latin by nature and say nothing about the
// language of the prose around them, so they must not outvote it.
function prose(text: string) {
  return text
    .replace(INVISIBLE, "")
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<\/?[A-Za-z][^>\n]*>/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(new RegExp(`[^\\s\\\\/]{0,${RUN}}[\\\\/]\\S{0,${RUN}}`, "g"), " ")
    .replace(new RegExp(`[A-Za-z0-9_$]{1,${RUN}}\\.[A-Za-z0-9_$]{1,${RUN}}`, "g"), " ")
    .replace(/[@#]\S+/g, " ")
}

export function countDirectionalWords(text: string) {
  const count = { rtl: 0, ltr: 0 }
  for (const word of prose(text.slice(0, MAX)).split(/\s+/)) {
    if (!word) continue
    if (RTL.test(word)) {
      count.rtl++
      continue
    }
    if (LTR.test(word)) count.ltr++
  }
  return count
}

export function textDirection(text: string | undefined | null): TextDirection {
  if (!text) return "auto"
  const count = countDirectionalWords(text)
  const total = count.rtl + count.ltr
  if (!total) return "auto"
  if (count.rtl >= MIN_WORDS && count.rtl >= total * RATIO) return "rtl"
  return count.rtl > count.ltr ? "rtl" : "ltr"
}

// Rendered code carries no language signal, and it is already isolated by its
// own dir, so its text must not vote for the prose around it.
const SKIP = new Set(["CODE", "PRE", "KBD", "SAMP", "VAR", "SVG", "MATH"])

function visible(node: Element): string {
  const parts: string[] = []
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      parts.push(child.nodeValue ?? "")
      continue
    }
    if (child.nodeType !== 1) continue
    const elem = child as Element
    if (SKIP.has(elem.tagName.toUpperCase())) continue
    if (elem.classList?.contains("katex")) continue
    parts.push(visible(elem))
  }
  return parts.join(" ")
}

// A rendered markdown block can hold several paragraphs, and once a message is
// complete the whole document is a single block. Giving the block one direction
// would force an English paragraph and a Persian paragraph to share it, so each
// top-level element resolves its own.
//
// The block is not always parsed into elements: while a parse is still pending
// the html is escaped source with <br> separators, so the prose sits in bare
// top-level text nodes. Those cannot carry dir, and tagging the <br> between
// them does nothing, so that block resolves one direction as a whole.
export function applyTextDirection(root: Element) {
  const loose = Array.from(root.childNodes).some((node) => node.nodeType === 3 && (node.nodeValue ?? "").trim())
  if (loose) {
    root.setAttribute("dir", textDirection(visible(root)))
    return
  }
  for (const child of Array.from(root.children)) child.setAttribute("dir", textDirection(visible(child)))
}
