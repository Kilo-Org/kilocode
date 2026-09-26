import path from "node:path"
import { interactiveSkipReason } from "../test/fixture"

const reason = interactiveSkipReason()
if (reason) {
  console.error(`Cannot run the interactive proofs: ${reason}.`)
  process.exit(1)
}

// Delegate to the standard test harness unchanged; with the interactive
// runtime present the gated proofs run instead of skipping.
const tests = Bun.spawn(
  [process.execPath, "--no-env-file", path.join(import.meta.dir, "test.ts"), ...process.argv.slice(2)],
  {
    cwd: path.resolve(import.meta.dir, ".."),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
)
process.exitCode = await tests.exited
