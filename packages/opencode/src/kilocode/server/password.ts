import { readFile } from "node:fs/promises"
import { Flag } from "@opencode-ai/core/flag/flag"

// Loads the server Basic Auth password from KILO_SERVER_PASSWORD_FILE so callers can keep the
// secret out of the process environment, which other same-user processes can read (`ps eww`,
// /proc/<pid>/environ). The value is kept in memory only and never written back to process.env.
export namespace ServerPassword {
  let value: string | undefined
  let previous: string | undefined

  export function get() {
    return value
  }

  // Returns an error message instead of throwing so the caller decides how to surface it.
  export async function load(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
    const file = env.KILO_SERVER_PASSWORD_FILE
    if (!file) return undefined
    // An explicit KILO_SERVER_PASSWORD wins, so embedders that pass it keep working.
    if (env.KILO_SERVER_PASSWORD) return undefined
    // node:fs instead of Bun.file(): Bun.file().text() does not finish on FIFOs.
    const text = await readFile(file, "utf8").catch((err: Error) => err)
    if (text instanceof Error) return `Could not read KILO_SERVER_PASSWORD_FILE (${file}): ${text.message}`
    const password = text.replace(/\r?\n$/, "")
    if (!password) return `KILO_SERVER_PASSWORD_FILE (${file}) is empty`
    value = password
    previous = Flag.KILO_SERVER_PASSWORD
    Flag.KILO_SERVER_PASSWORD = password
    return undefined
  }

  // Undoes load(): clears the stored value and restores the flag if load() set it.
  export function reset() {
    if (value !== undefined && Flag.KILO_SERVER_PASSWORD === value) Flag.KILO_SERVER_PASSWORD = previous
    value = undefined
    previous = undefined
  }
}
