import { readFileSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { Worker } from "node:worker_threads"
import { createRequire } from "node:module"
import { getHeapStatistics } from "node:v8"

function denied(action) {
  try {
    action()
    return false
  } catch (error) {
    return error.code === "ERR_ACCESS_DENIED"
  }
}
const require = createRequire(import.meta.url)
const text = JSON.stringify({
  env: Object.keys(process.env).filter(
    (name) => !["ELECTRON_RUN_AS_NODE", "SYSTEMROOT"].includes(name) && process.env[name] !== "",
  ),
  runAsNode: process.env.ELECTRON_RUN_AS_NODE,
  heap: getHeapStatistics().heap_size_limit,
  self: readFileSync(import.meta.filename).length > 0,
  read: denied(() => readFileSync(process.execPath)),
  write: denied(() => writeFileSync(new URL("./denied.txt", import.meta.url), "must not exist")),
  load: denied(() => require("./host.cjs")),
  child: denied(() => spawn(process.execPath, ["-e", "process.exit(99)"])),
  worker: denied(() => new Worker("process.exit(99)", { eval: true })),
  eval: (() => {
    try {
      Function("return 1")()
      return false
    } catch (error) {
      return error instanceof EvalError
    }
  })(),
  pid: process.pid,
})
process.stdin.resume()
process.stdin.on("end", () =>
  process.stdout.write(JSON.stringify({ text, detail: "Test process probe.", truncated: false })),
)
