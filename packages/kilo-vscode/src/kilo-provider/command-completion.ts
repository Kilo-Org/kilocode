export function completesWithoutStatus(command: string): boolean {
  return command === "goal" || command === "local-review" || command === "local-review-uncommitted"
}
