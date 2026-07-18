export const TERMINAL_OUTPUT_LIMIT = 2 * 1024 * 1024

export function trimTerminalOutput(output: string) {
  const buf = Buffer.from(output, "utf-8")
  if (buf.length <= TERMINAL_OUTPUT_LIMIT) return output
  let start = buf.length - TERMINAL_OUTPUT_LIMIT
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
  return buf.subarray(start).toString("utf-8")
}

export function appendTerminalOutput(output: string, data: string) {
  return trimTerminalOutput(output + data)
}
