export function completesWithoutStatus(command: string): boolean {
  return command === "local-review" || command === "local-review-uncommitted"
}
