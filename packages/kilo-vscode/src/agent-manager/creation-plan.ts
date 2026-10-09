export type Start = "immediate" | "afterSetup"

export function plan(input: { setupScript: boolean }): Start {
  return input.setupScript ? "afterSetup" : "immediate"
}
