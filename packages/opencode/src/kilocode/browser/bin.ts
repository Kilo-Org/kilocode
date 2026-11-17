// How to re-run this CLI as a child process. A release build is a single executable;
// a source checkout is `bun <entry>`.
export function bin(proc = { argv: process.argv, execArgv: process.execArgv, execPath: process.execPath }): [string, ...string[]] {
  const script = proc.argv[1]
  const bundled = script?.startsWith("/$bunfs/") || (script !== undefined && /^[A-Za-z]:[\\/]~BUN[\\/]/.test(script))
  if (script && !bundled && /\.(ts|js|mjs|cjs)$/.test(script)) return [proc.execPath, ...proc.execArgv, script]
  return [proc.execPath]
}
