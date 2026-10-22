export const FILE_EXTENSION_PATTERN = /^\.?[A-Za-z0-9][A-Za-z0-9_+-]*$/

export function isFileExtension(input: string): boolean {
  return FILE_EXTENSION_PATTERN.test(input.trim())
}

export function normalizeFileExtensions(input: readonly string[] | undefined): string[] | undefined {
  if (!input) return undefined
  const values = new Set<string>()
  for (const raw of input) {
    const item = raw.trim().toLowerCase()
    if (!item) continue
    values.add(item.startsWith(".") ? item : `.${item}`)
  }
  return values.size > 0 ? [...values].sort() : undefined
}

export function parseFileExtensions(input: string): string[] | undefined {
  const values = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length > 0 ? normalizeFileExtensions(values) : undefined
}
