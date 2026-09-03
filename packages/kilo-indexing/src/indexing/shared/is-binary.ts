const SAMPLE_BYTES = 4096

export function isBinary(input: Uint8Array): boolean {
  const length = Math.min(input.length, SAMPLE_BYTES)
  if (length === 0) return false

  let control = 0
  for (let index = 0; index < length; index++) {
    const byte = input[index]
    if (byte === 0) return true
    if (byte < 9 || (byte > 13 && byte < 32)) control++
  }
  return control / length > 0.3
}
