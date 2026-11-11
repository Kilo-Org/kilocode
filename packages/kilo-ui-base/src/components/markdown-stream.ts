import { marked, type Tokens } from "marked"
import remend from "remend"

export type Block = {
  raw: string
  src: string
  mode: "full" | "live" | "code"
  language?: string
  complete?: boolean
}

export type Projection = {
  text: string
  blocks: Block[]
}

function refs(text: string) {
  if (!text.includes("]:")) return false
  return /^[ \t]{0,3}\[[^\]]+\]:[ \t]*(?:\S+|\r?\n[ \t]+\S+)/m.test(text)
}

function language(value: string | undefined) {
  return value?.trim().split(/\s+/, 1)[0] || undefined
}

function openCode(raw: string) {
  const newline = raw.indexOf("\n")
  return newline < 0 ? "" : raw.slice(newline + 1)
}

function open(raw: string) {
  const match = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
  if (!match) return false
  const mark = match[1]
  if (!mark) return false
  const char = mark[0]
  const size = mark.length
  const last = raw.trimEnd().split("\n").at(-1)?.trim() ?? ""
  return !new RegExp(`^[\\t ]{0,3}${char}{${size},}[\\t ]*$`).test(last)
}

function closesFence(raw: string, suffix: string) {
  const mark = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/)?.[1]
  if (!mark) return suffix.includes("```") || suffix.includes("~~~")
  return `${raw.slice(-(mark.length - 1))}${suffix}`.includes(mark)
}

function heal(text: string) {
  return remend(text, { linkMode: "text-only" })
}

export function stream(text: string, live: boolean): Block[] {
  if (!live) return [{ raw: text, src: text, mode: "full" }] satisfies Block[]
  if (refs(text)) return [{ raw: text, src: heal(text), mode: "live" }] satisfies Block[]
  return derive(marked.lexer(text))
}

// Top-level tokens to blocks. The tail is the only block that can still change, so it is the only one healed.
function derive(tokens: Tokens.Generic[]): Block[] {
  const tail = tokens.findLastIndex((token) => token.type !== "space")
  const last = tokens[tail]
  if (!last) {
    const whole = tokens.map((token) => token.raw).join("")
    return [{ raw: whole, src: heal(whole), mode: "live" }] satisfies Block[]
  }

  const result: Block[] = []
  for (let index = 0; index < tail; index++) {
    const token = tokens[index]
    if (!token || token.type === "space") continue
    let raw = token.raw
    while (tokens[index + 1]?.type === "space" && index + 1 < tail) raw += tokens[++index]!.raw
    if (token.type === "code") {
      const code = token as Tokens.Code
      result.push({ raw, src: code.text, mode: "code", language: language(code.lang), complete: true })
      continue
    }
    result.push({ raw, src: raw, mode: "full" })
  }

  const raw = tokens
    .slice(tail)
    .map((token) => token.raw)
    .join("")
  if (last.type !== "code") return [...result, { raw, src: heal(raw), mode: "live" }]

  const code = last as Tokens.Code
  if (!open(code.raw))
    return [...result, { raw, src: code.text, mode: "code", language: language(code.lang), complete: true }]
  return [...result, { raw, src: openCode(code.raw), mode: "code", language: language(code.lang) }]
}

export function canReusePendingBlock(current: Pick<Block, "mode" | "raw"> | undefined, next: Block) {
  if (!current || current.mode !== next.mode) return false
  // kilocode_change start: a growing live tail keeps its rendered HTML until the parse lands a microtask later.
  // Painting the escaped fallback in between doubled the DOM writes and forced layouts of every streamed frame.
  if (next.mode === "code" || next.mode === "live") return next.raw.startsWith(current.raw)
  // kilocode_change end
  return current.raw === next.raw
}

export function project(previous: Projection | undefined, text: string, live: boolean): Projection {
  // kilocode_change start: keep the streamed block layout when a stream ends so
  // the finished message does not rebuild every paragraph and drop a selection.
  // Mirror session-ui's settle path: re-derive the layout when more text
  // arrived, and mark an unterminated code block complete. This returns for
  // every !live input, so the upstream guard below keeps its original shape.
  if (!live) {
    const current =
      previous?.text === text
        ? previous
        : previous && text.startsWith(previous.text)
          ? project(previous, text, true)
          : undefined
    if (!current) return { text, blocks: stream(text, false) }
    return {
      text,
      blocks: current.blocks.map((block) => {
        if (block.mode === "live") return { raw: block.raw, src: block.raw, mode: "full" as const }
        if (block.mode === "code" && !block.complete) return { ...block, complete: true }
        return block
      }),
    }
  }
  // kilocode_change end
  if (!live || !previous) return { text, blocks: stream(text, live) }
  // kilocode_change start: an unchanged text reuses the previous projection, so
  // a repeated frame costs nothing.
  if (previous.text === text) return previous
  if (!text.startsWith(previous.text)) return { text, blocks: stream(text, live) }
  const tail = previous.blocks.at(-1)
  const suffix = text.slice(previous.text.length)
  if (!suffix || !tail) return { text, blocks: stream(text, live) }
  if (tail.mode === "code" && !tail.complete && !closesFence(tail.raw, suffix))
    return {
      text,
      blocks: [
        ...previous.blocks.slice(0, -1),
        {
          ...tail,
          raw: tail.raw + suffix,
          src: tail.src + suffix,
        },
      ],
    }
  // kilocode_change start: only the trailing blocks can change, and a block
  // boundary from an earlier full lex is a valid start for the lexer, so re-lex
  // that window instead of the whole accumulated message. The block before the
  // tail is part of the window because a list or quote can absorb the next line
  // across a blank line. Reference definitions anywhere in the text can change
  // earlier blocks, so they keep the full path.
  const keep = Math.max(0, previous.blocks.length - 2)
  const size = previous.blocks.slice(keep).reduce((total, block) => total + block.raw.length, 0)
  const start = previous.text.length - size
  const window = start < 0 ? "" : text.slice(start)
  if (!window || refs(text)) return { text, blocks: stream(text, live) }
  const blocks = derive(marked.lexer(window))
  if (blocks.reduce((total, block) => total + block.raw.length, 0) !== window.length)
    return { text, blocks: stream(text, live) }
  return { text, blocks: [...previous.blocks.slice(0, keep), ...blocks] }
  // kilocode_change end
}
