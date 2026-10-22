type Entry = {
  debug(message?: unknown, extra?: Record<string, unknown>): void
  info(message?: unknown, extra?: Record<string, unknown>): void
  warn(message?: unknown, extra?: Record<string, unknown>): void
  error(message?: unknown, extra?: Record<string, unknown>): void
  tag(key: string, value: string): Entry
  clone(): Entry
  time(
    message: string,
    extra?: Record<string, unknown>,
  ): {
    stop(): void
    [Symbol.dispose](): void
  }
}

const enabled = process.env.KILO_INDEXING_LOG === "1" || process.env.KILO_INDEXING_LOG === "true"

export namespace Log {
  export type Logger = Entry

  export function create(input: Record<string, unknown> = {}): Entry {
    const tags = { ...input }

    function write(level: string, message?: unknown, extra?: Record<string, unknown>) {
      if (!enabled) return

      const line = JSON.stringify({
        level,
        time: new Date().toISOString(),
        message,
        ...tags,
        ...extra,
      })
      console.error(line)
    }

    const log: Entry = {
      debug(message, extra) {
        write("DEBUG", message, extra)
      },
      info(message, extra) {
        write("INFO", message, extra)
      },
      warn(message, extra) {
        write("WARN", message, extra)
      },
      error(message, extra) {
        write("ERROR", message, extra)
      },
      tag(key, value) {
        tags[key] = value
        return log
      },
      clone() {
        return create(tags)
      },
      time(message, extra) {
        const start = Date.now()
        const stop = () => {
          write("INFO", message, { duration: Date.now() - start, ...extra })
        }
        return {
          stop,
          [Symbol.dispose]() {
            stop()
          },
        }
      },
    }

    return log
  }
}
