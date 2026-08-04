// kilocode_change - Kilo exit banner instead of the opencode wordmark
import { session } from "@/kilocode/cli/logo"

const reset = "\x1b[0m"
const dim = "\x1b[90m"

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  return session(input.title, input.sessionID, dim, reset)
}
