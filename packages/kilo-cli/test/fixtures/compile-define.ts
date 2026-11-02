// Bun.build resolves both libc branches of `@opentui/core` on Linux when it compiles a binary, and only the installed
// one resolves. Pin the host libc the way `script/build.ts` does for release targets, so a compiled test binary uses
// the native package that is installed here.
import { existsSync } from "node:fs"

const hostLibc = existsSync("/lib/ld-musl-x86_64.so.1") || existsSync("/lib/ld-musl-aarch64.so.1") ? "musl" : "glibc"

export const compileDefine = {
  KILO_BRANDING_COMPILED: "true",
  ...(process.platform === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(hostLibc) } : {}),
} as const
