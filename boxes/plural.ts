export function plural(n: number, one: string, many: string): string {
  const tpl = n === 1 ? one : many
  return tpl.replace("{}", String(n))
}
