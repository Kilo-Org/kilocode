// kilocode_change - new file

declare global {
  namespace NodeJS {
    interface Process {
      on(event: Signals, listener: (...args: unknown[]) => void): this
      once(event: Signals, listener: (...args: unknown[]) => void): this
      off(event: Signals, listener: (...args: unknown[]) => void): this
      on(event: "uncaughtException", listener: (err: Error, origin: string) => void): this
      once(event: "uncaughtException", listener: (err: Error, origin: string) => void): this
      off(event: "uncaughtException", listener: (err: Error, origin: string) => void): this
      on(event: "unhandledRejection", listener: (reason: unknown, promise: Promise<unknown>) => void): this
      once(event: "unhandledRejection", listener: (reason: unknown, promise: Promise<unknown>) => void): this
      off(event: "unhandledRejection", listener: (reason: unknown, promise: Promise<unknown>) => void): this
    }
  }
}

export {}
