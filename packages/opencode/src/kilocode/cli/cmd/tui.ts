export function preload(compiled: boolean, resolve: () => string) {
  if (compiled) return []
  return [resolve()]
}

export async function validate(input: Parameters<typeof import("@/cli/tui/validate-session").validateSession>[0]) {
  if (!input.sessionID) return
  const { validateSession } = await import("@/cli/tui/validate-session")
  return validateSession(input)
}
