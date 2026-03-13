function bytes(sample: Uint8Array) {
  if (sample.length === 0) return false

  let count = 0
  for (const value of sample) {
    if (value === 0) return true
    if (value < 9 || (value > 13 && value < 32)) count += 1
  }
  return count / sample.length > 0.3
}

export namespace BinaryFile {
  export function isBytes(sample: Uint8Array) {
    return bytes(sample)
  }

  export function isNumstat(additions: string | undefined, deletions: string | undefined) {
    return additions === "-" && deletions === "-"
  }

  export function isDiff(diff: { binary?: boolean }) {
    return diff.binary === true
  }
}
