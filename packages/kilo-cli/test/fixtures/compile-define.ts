// Bun.build resolves both libc branches of `@opentui/core` on Linux when it compiles a binary, and only the installed
// one resolves. Pin the host libc the way `script/build.ts` does for release targets, so a compiled test binary uses
// the native package that is installed for the running libc. Loader files are not a reliable signal: glibc hosts with
// musl installed for static builds have them too.
import { existsSync } from "node:fs"
import path from "node:path"

const hostLibc = process.platform === "linux" && !runningGlibc() ? "musl" : "glibc"

export const compileDefine = {
  KILO_BRANDING_COMPILED: "true",
  ...(process.platform === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(hostLibc) } : {}),
} as const

function runningGlibc() {
  const report = process.report?.getReport() as { header?: Record<string, unknown> } | undefined
  if (report?.header && "glibcVersionRuntime" in report.header) return true
  // Bun installs the native variant for the running libc, so the installed package is the next-best signal.
  if (installed("")) return true
  return !installed("-musl")
}

function installed(suffix: string) {
  return existsSync(path.join(import.meta.dir, "../../node_modules/@opentui", `core-linux-${process.arch}${suffix}`))
}
