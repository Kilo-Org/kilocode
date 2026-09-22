import { KilocodeMarkdown } from "../config/markdown"

// Max instruction chars in the system prompt, to avoid oversized prompts. Override with KILO_INSTRUCTIONS_MAX_CHARS.
const DEFAULT_MAX_CHARS = 400_000
const maxChars = () => {
  const n = Number(process.env["KILO_INSTRUCTIONS_MAX_CHARS"])
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CHARS
}

export namespace KilocodeInstruction {
  export function content(text: string, item: string, options: KilocodeMarkdown.Options) {
    return KilocodeMarkdown.substitute(text, item, options)
  }

  export async function read(item: string, options: KilocodeMarkdown.Options) {
    return content(await KilocodeMarkdown.read(item, options), item, options)
  }

  // Keeps blocks in order until the budget is spent; the rest are named in one summary line.
  export function budget(blocks: string[], max = maxChars()) {
    const out: string[] = []
    const skipped: string[] = []
    let used = 0
    for (const block of blocks) {
      if (used + block.length > max) {
        const end = block.indexOf("\n")
        skipped.push(end === -1 ? block : block.slice("Instructions from: ".length, end))
        continue
      }
      used += block.length
      out.push(block)
    }
    if (skipped.length)
      out.push(`${skipped.length} instruction file(s) skipped (over ${max}-char budget): ${skipped.join(", ")}`)
    return out
  }
}
