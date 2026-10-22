// kilocode_change - new file
// Bun 1.4 narrows NodeJS.Process event overloads.
declare global {
  namespace NodeJS {
    interface Process {
      on(event: string | symbol, listener: (...args: never[]) => void): this
      off(event: string | symbol, listener: (...args: never[]) => void): this
    }
  }
}

export {}
