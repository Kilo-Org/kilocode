export function completesWithoutStatus(command: string): boolean {
  return command === "goal" || command === "local-review" || command === "local-review-uncommitted"
}

export function goalControl(command: string, args: string): boolean {
  return command === "goal" && ["", "pause", "clear"].includes(args.trim())
}
