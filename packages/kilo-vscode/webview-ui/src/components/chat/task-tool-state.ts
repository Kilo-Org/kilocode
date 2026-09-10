export function taskRunning(status: string | undefined) {
  return status === "pending" || status === "running"
}

export function taskVisible(open: boolean | undefined, id: string | undefined) {
  return open ? id : undefined
}

export function taskResult(output: string | undefined, id: string | undefined) {
  if (id || typeof output !== "string") return
  const match = /<task_result>\s*([\s\S]*?)\s*<\/task_result>/.exec(output)
  return match?.[1] ?? output
}
