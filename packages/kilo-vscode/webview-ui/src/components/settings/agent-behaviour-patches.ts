export function selectedDefaultAgentValue(value: string): string | null {
  return value || null
}

export function selectedAgentTextOverrideValue(value: string): string | null {
  return value === "" ? null : value
}

export function selectedAgentNumberOverrideValue(
  value: string,
  parse: (value: string) => number,
): number | null | undefined {
  if (value.trim() === "") return null
  const parsed = parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

export function shouldClearDefaultAgentWhenAgentBecomesUnavailable(
  nextValue: boolean,
  currentDefaultAgent: string | null | undefined,
  agentName: string,
): boolean {
  return nextValue && currentDefaultAgent === agentName
}
