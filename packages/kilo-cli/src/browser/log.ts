// Diagnostics for the browser bridge. The hub is started by the browser, whose
// native messaging channel owns stdout, so every line goes through the CLI's Effect
// logger (stderr or the log file) and never to the protocol stream.
import { Effect } from "effect"

type Level = "debug" | "info" | "warn" | "error"

const write = {
  debug: Effect.logDebug,
  info: Effect.logInfo,
  warn: Effect.logWarning,
  error: Effect.logError,
} as const

export type Logger = Record<Level, (message?: string, extra?: Record<string, unknown>) => void>

export namespace Log {
  export function create(tags: Record<string, unknown> = {}): Logger {
    const emit = (level: Level) => (message?: string, extra?: Record<string, unknown>) => {
      // The hub's callers are promise-shaped, so each line is forked on the default
      // runtime instead of carrying an Effect context through the transport code.
      Effect.runFork(write[level](message ?? "").pipe(Effect.annotateLogs({ ...tags, ...extra })))
    }
    return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") }
  }
}
