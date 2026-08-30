export function zeroID(...parts: (string | number | boolean)[]) {
  if (parts.length === 2) return `${parts[0]}\0${parts[1]}`
  if (parts.length === 3) return `${parts[0]}\0${parts[1]}\0${parts[2]}`
  return parts.join("\0")
}
