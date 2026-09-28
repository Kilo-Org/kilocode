export function completesWithoutStatus(command: string): boolean {
  return command === "goal"
}

export function goalControl(command: string, args: string): boolean {
  return command === "goal" && ["", "pause", "clear"].includes(args.trim())
}
