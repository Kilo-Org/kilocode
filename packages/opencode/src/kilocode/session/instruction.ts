import { KilocodeMarkdown } from "../config/markdown"

// Max instruction chars in the system prompt, to avoid oversized prompts. Override with KILO_INSTRUCTIONS_MAX_CHARS.
const DEFAULT_MAX_CHARS = 400_000
const PREFIX = "Instructions from: "
const MAX_LISTED = 20
const maxChars = () => {
  const n = Number(process.env["KILO_INSTRUCTIONS_MAX_CHARS"])
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CHARS
}

const nameOf = (block: string) => {
  const end = block.indexOf("\n")
  const head = end === -1 ? block : block.slice(0, end)
  return head.startsWith(PREFIX) ? head.slice(PREFIX.length) : head
}

export namespace KilocodeInstruction {
  export function content(text: string, item: string, options: KilocodeMarkdown.Options) {
    return KilocodeMarkdown.substitute(text, item, options)
  }

  export async function read(item: string, options: KilocodeMarkdown.Options) {
    return content(await KilocodeMarkdown.read(item, options), item, options)
  }

  // Keeps blocks in order until the budget is spent. A block that doesn't fully fit is
  // truncated to the remaining budget so partial instructions still reach the model; the
  // rest are named in one size-capped summary line instead of silently vanishing.
  export function budget(blocks: string[], max = maxChars()) {
    const out: string[] = []
    const skipped: string[] = []
    let used = 0
    for (const block of blocks) {
      const remaining = max - used
      if (remaining <= 0) {
        skipped.push(nameOf(block))
        continue
      }
      if (block.length > remaining) {
        out.push(block.slice(0, remaining))
        skipped.push(`${nameOf(block)} (truncated)`)
        used = max
        continue
      }
      used += block.length
      out.push(block)
    }
    if (skipped.length) {
      const shown = skipped.slice(0, MAX_LISTED)
      const more = skipped.length - shown.length
      const list = more > 0 ? `${shown.join(", ")}, and ${more} more` : shown.join(", ")
      out.push(`${skipped.length} instruction file(s) skipped or truncated (over ${max}-char budget): ${list}`)
    }
    return out
  }
}
