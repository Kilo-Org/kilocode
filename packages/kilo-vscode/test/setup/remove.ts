import { promises as fs } from "fs"

// Bun ignores the maxRetries option of fs.rm, and Windows keeps a directory locked for a short time
// after a child process that used it as its working directory exits. Retry those failures here.
const BUSY = new Set(["EBUSY", "EPERM", "ENOTEMPTY"])
const ATTEMPTS = 40
const DELAY = 100

/** Remove a temporary directory, retrying while Windows still holds it. */
export async function remove(dir: string, attempt = 1): Promise<void> {
  const error = await fs.rm(dir, { recursive: true, force: true }).then(
    () => undefined,
    (cause: unknown) => cause,
  )
  if (error === undefined) return
  if (attempt >= ATTEMPTS || !busy(error)) throw error
  await Bun.sleep(DELAY)
  return remove(dir, attempt + 1)
}

function busy(error: unknown) {
  return error instanceof Error && "code" in error && BUSY.has(String(error.code))
}
