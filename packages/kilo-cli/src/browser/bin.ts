// How to re-run this CLI as a child process. A release build is a single executable;
// a source checkout is `bun <entry>`.
import path from "path"

export function bin(
  proc = { argv: process.argv, execArgv: process.execArgv, execPath: process.execPath },
): [string, ...string[]] {
  const script = proc.argv[1]
  const bundled = script?.startsWith("/$bunfs/") || (script !== undefined && /^[A-Za-z]:[\\/]~BUN[\\/]/.test(script))
  // The installed shim is launched by the browser from its own working directory, so
  // the script path must be absolute and `--cwd` (which is relative to the developer's
  // shell) must not be carried along.
  if (script && !bundled && /\.(ts|js|mjs|cjs)$/.test(script))
    return [proc.execPath, ...clean(proc.execArgv), path.resolve(script)]
  return [proc.execPath]
}

export function clean(input: string[]) {
  return input.filter((arg, index) => {
    if (arg === "--cwd") return false
    if (input[index - 1] === "--cwd") return false
    if (arg.startsWith("--cwd=")) return false
    return true
  })
}
