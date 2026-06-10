import { KilocodeMarkdown } from "../config/markdown"

export namespace KilocodeInstruction {
  export function content(text: string, item: string) {
    return KilocodeMarkdown.substitute(text, item)
  }
}
