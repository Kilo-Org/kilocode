// kilocode_change - new file

export function count(text: string) {
  return (text.match(/\n/g)?.length ?? 0) + 1
}

export function shouldSummarize(text: string) {
  const lines = count(text)
  return {
    lines,
    summarize: lines >= 5 || text.length > 800,
  }
}
