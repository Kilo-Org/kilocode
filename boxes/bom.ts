/**
 * bom.ts — UTF-8 BOM split/join
 * Zero deps.
 *
 * split("\uFEFFhello") → { bom: true, text: "hello" }
 * join("hello", true) → "\uFEFFhello"
 */
const BOM = 0xfeff

export function split(text: string) {
  if (text.charCodeAt(0) !== BOM) return { bom: false as const, text }
  return { bom: true as const, text: text.slice(1) }
}

export function join(text: string, bom: boolean) {
  const t = split(text).text
  return bom ? String.fromCharCode(BOM) + t : t
}
