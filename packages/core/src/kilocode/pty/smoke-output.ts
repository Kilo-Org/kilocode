export function hasReadyMarker(output: string) {
  const lines = output
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
  return lines.some((line) => line.trim() === "KILO_PTY_READY")
}
