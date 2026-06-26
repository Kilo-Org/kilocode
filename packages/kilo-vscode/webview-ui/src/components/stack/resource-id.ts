function segment(value: string): string {
  return Array.from(value, (char) =>
    /^[A-Za-z0-9_-]$/.test(char) ? char : `_${char.codePointAt(0)!.toString(16)}_`,
  ).join("")
}

export function fieldID(technology: string, resource: string, field: string): string {
  return `stack-${segment(technology)}-${segment(resource)}-${segment(field)}`
}
