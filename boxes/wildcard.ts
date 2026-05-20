export function globMatch(str: string, pat: string, ci = false): boolean {
  const s = str ? str.replaceAll("\\", "/") : str
  let p = pat ? pat.replaceAll("\\", "/") : pat
  let esc = p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (esc.endsWith(" .*")) {
    esc = esc.slice(0, -3) + "( .*)?"
  }
  const flags = ci ? "si" : "s"
  return new RegExp("^" + esc + "$", flags).test(s)
}

function sortByLength(a: [string, unknown], b: [string, unknown]): number {
  const d = a[0].length - b[0].length
  return d !== 0 ? d : a[0].localeCompare(b[0])
}

export function globBest(
  input: string,
  pats: Record<string, unknown>,
  ci = false,
): unknown {
  const sorted = Object.entries(pats).sort(sortByLength)
  let result: unknown
  for (const [p, v] of sorted) {
    if (globMatch(input, p, ci)) result = v
  }
  return result
}

export function globStructured(
  input: { head: string; tail: string[] },
  pats: Record<string, unknown>,
  ci = false,
): unknown {
  const sorted = Object.entries(pats).sort(sortByLength)
  let result: unknown
  for (const [p, v] of sorted) {
    const parts = p.split(/\s+/)
    if (!globMatch(input.head, parts[0], ci)) continue
    if (parts.length === 1 || seqMatch(input.tail, parts.slice(1), ci)) result = v
  }
  return result
}

function seqMatch(items: string[], pats: string[], ci: boolean): boolean {
  if (pats.length === 0) return true
  const [first, ...rest] = pats
  if (first === "*") return seqMatch(items, rest, ci)
  for (let i = 0; i < items.length; i++) {
    if (globMatch(items[i], first, ci) && seqMatch(items.slice(i + 1), rest, ci)) {
      return true
    }
  }
  return false
}
