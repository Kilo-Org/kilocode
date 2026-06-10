export function splitDiffHunks(diff: string): string[] {
  const parse = (line: string) => {
    const match = line.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/)
    if (!match) return
    return {
      old: Number(match[1] ?? "1"),
      next: Number(match[2] ?? "1"),
    }
  }

  const split = (section: string[]) => {
    const start = section.findIndex((line) => line.startsWith("@@"))
    if (start === -1) return [section.join("\n")]

    const prefix = section.slice(0, start)
    const hunks = section.slice(start).reduce((acc, line) => {
      if (line.startsWith("@@")) return [...acc, [line]]
      if (acc.length === 0) return [[line]]
      return [...acc.slice(0, -1), [...acc.at(-1)!, line]]
    }, [] as string[][])

    const head = prefix.join("\n")
    return hunks.map((hunk) => [head, ...hunk].join("\n"))
  }

  const lines = diff.split("\n")
  const files = lines.reduce(
    (acc, line, index) => {
      const hunk = parse(line)
      if (hunk) {
        return { files: acc.files, old: hunk.old, next: hunk.next }
      }

      if (
        acc.old !== 0 &&
        acc.next !== 0 &&
        line.startsWith("--- ") &&
        lines[index + 1]?.startsWith("+++ ") &&
        lines[index + 2]?.startsWith("@@")
      ) {
        return { files: [...acc.files, index], old: 0, next: 0 }
      }

      if (acc.old === 0 && acc.next === 0) {
        if (line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) {
          return { files: [...acc.files, index], old: 0, next: 0 }
        }
        return acc
      }

      if (line.startsWith("\\ ")) return acc
      if (line.startsWith("+")) {
        return { files: acc.files, old: acc.old, next: acc.next - 1 }
      }
      if (line.startsWith("-")) {
        return { files: acc.files, old: acc.old - 1, next: acc.next }
      }
      return { files: acc.files, old: acc.old - 1, next: acc.next - 1 }
    },
    { files: [] as number[], old: 0, next: 0 },
  ).files

  if (files.length === 0) {
    const hunks = split(lines)
    if (hunks.length <= 1) return [diff]
    return hunks
  }

  const hunks = files
    .map((line, index) => {
      const start = index === 0 ? 0 : line
      const end = files[index + 1] ?? lines.length
      return split(lines.slice(start, end))
    })
    .flat()

  if (hunks.length <= 1) return [diff]
  return hunks
}
