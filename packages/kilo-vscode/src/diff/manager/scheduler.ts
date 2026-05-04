import * as vscode from "vscode"

/**
 * Testable abstraction over `setTimeout`.
 */
export interface Scheduler {
  delay(ms: number, fn: () => void): vscode.Disposable
}

export function realScheduler(): Scheduler {
  return {
    delay(ms, fn) {
      const handle = setTimeout(fn, ms)
      return new vscode.Disposable(() => clearTimeout(handle))
    },
  }
}
