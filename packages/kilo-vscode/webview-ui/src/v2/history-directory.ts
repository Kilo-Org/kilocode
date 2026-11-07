/** Compare cached session paths without rejecting Windows separator/case aliases. */
export function sameSessionDirectory(left: string, right: string): boolean {
  const clean = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "") || "/"
  const a = clean(left)
  const b = clean(right)
  return /^[A-Za-z]:/.test(a) && /^[A-Za-z]:/.test(b)
    ? a.toLowerCase() === b.toLowerCase()
    : a === b
}
