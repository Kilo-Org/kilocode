// kilocode_change - new file

const LINE_THRESHOLD = 10
const LENGTH_THRESHOLD = 500

export namespace Paste {
  export function lineCount(text: string): number {
    return (text.match(/\n/g)?.length ?? 0) + 1
  }

  export function shouldSummarize(text: string): boolean {
    const lines = lineCount(text)
    if (lines >= LINE_THRESHOLD) return true
    if (lines >= 2 && text.length > LENGTH_THRESHOLD) return true
    return false
  }

  export function summary(text: string): string {
    return `[Pasted ~${lineCount(text)} lines]`
  }
}
