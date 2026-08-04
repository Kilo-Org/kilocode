import { start } from "./runtime"

start().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`daemon fatal: ${message}\n`)
  process.exit(1)
})
