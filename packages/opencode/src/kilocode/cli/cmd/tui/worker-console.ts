import * as Log from "@opencode-ai/core/util/log"

type Writer = Pick<Log.Logger, "debug" | "info" | "warn" | "error">

/** Console writers the redirect covers, each paired with the log level that carries it. */
const levels = [
  ["log", "info"],
  ["info", "info"],
  ["dir", "info"],
  ["table", "info"],
  ["debug", "debug"],
  ["trace", "debug"],
  ["warn", "warn"],
  ["error", "error"],
] as const satisfies ReadonlyArray<readonly [keyof Console, keyof Writer]>

type Name = (typeof levels)[number][0]
type Target = Pick<Console, Name>

const patched = new WeakSet<Target>()

function format(args: unknown[]) {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg
      if (arg instanceof Error) return arg.stack ?? arg.message
      // The log file is line based, so an inspected value has to stay on one line.
      return Bun.inspect(arg, { depth: 2, colors: false }).replace(/\s*\n\s*/g, " ")
    })
    .join(" ")
}

export namespace WorkerConsole {
  /**
   * Route this realm's console writes into the log file instead of the terminal.
   *
   * The TUI worker shares the process stdout with the OpenTUI renderer in the parent
   * thread, and OpenTUI repaints only the cells it knows changed. A console write from
   * this realm lands straight on the live frame and survives until a full redraw — the
   * MCP SDK's `console.warn` about OAuth tokens stored without an `issuer` shredded the
   * startup screen that way. OpenTUI installs its own console capture, but it patches
   * the renderer realm's `globalThis.console`, which a worker does not share.
   *
   * Returns a restore function. A second call on an already redirected console is a
   * no-op so the first restore stays the one that owns the originals.
   */
  export function redirect(
    target: Target = globalThis.console,
    log: Writer = Log.create({ service: "console" }),
  ): () => void {
    if (patched.has(target)) return () => {}
    patched.add(target)
    const original = levels.map(([name]) => [name, target[name]] as const)
    for (const [name, level] of levels) {
      target[name] = (...args: unknown[]) => log[level](format(args))
    }
    return () => {
      patched.delete(target)
      for (const [name, fn] of original) target[name] = fn
    }
  }
}
