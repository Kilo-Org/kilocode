// kilocode_change - new file

/**
 * Line-wise stdin→stdout filter that redacts secret-looking env values.
 * Used in the docs-sync workflow so kilo stdout piped to edit-log.txt is safe.
 * Env values contain no newlines, so line-wise processing never splits a value.
 */

import { redactEnvSecrets } from "./lib.mjs"

let carry = ""

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  carry += chunk
  let idx
  while ((idx = carry.indexOf("\n")) !== -1) {
    const line = carry.slice(0, idx + 1)
    carry = carry.slice(idx + 1)
    process.stdout.write(redactEnvSecrets(line))
  }
})
process.stdin.on("end", () => {
  if (carry.length > 0) process.stdout.write(redactEnvSecrets(carry))
})
