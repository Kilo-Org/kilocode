export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

// kilocode_change start - `scheduled` is a Kilo-only status and must not read as running
export function running(type: string) {
  return type === "busy" || type === "retry" || type === "offline"
}
// kilocode_change end
