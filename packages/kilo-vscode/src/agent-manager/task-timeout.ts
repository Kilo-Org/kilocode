export interface TaskEnd {
  execution: unknown
  exitCode?: number | null
}

export interface TaskHandlers {
  onProcess: (cb: (event: TaskEnd) => void) => { dispose(): void }
  onEnd: (cb: (event: TaskEnd) => void) => { dispose(): void }
}

export interface WatchOptions {
  execution: { terminate(): unknown }
  handlers: TaskHandlers
  budget: number
  message: string
  stop: boolean
  grace: number
  fallback?: number
}

/** Resolve on the task's exit code, or reject when its budget expires. */
export function watchTask(opts: WatchOptions): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    let done = false
    let stopping = false
    let failure: Error | undefined
    let grace: ReturnType<typeof setTimeout> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let limit: ReturnType<typeof setTimeout> | undefined

    const finish = (code?: number, error?: Error) => {
      if (done) return
      done = true
      if (grace) clearTimeout(grace)
      if (timeout) clearTimeout(timeout)
      if (limit) clearTimeout(limit)
      processListener.dispose()
      endListener.dispose()
      if (error) reject(error)
      else resolve(code)
    }

    const processListener = opts.handlers.onProcess((event) => {
      if (event.execution !== opts.execution) return
      if (stopping) return finish(undefined, failure)
      finish(event.exitCode ?? undefined)
    })

    const endListener = opts.handlers.onEnd((event) => {
      if (event.execution !== opts.execution || done) return
      if (stopping) return finish(undefined, failure)
      grace = setTimeout(() => finish(undefined), opts.grace)
    })

    timeout = setTimeout(() => {
      if (!opts.stop) return finish(undefined, new Error(opts.message))
      stopping = true
      failure = new Error(opts.message)
      try {
        void Promise.resolve(opts.execution.terminate()).catch(() => undefined)
      } catch {
        finish(undefined, failure)
        return
      }
      limit = setTimeout(() => finish(undefined, failure), opts.fallback ?? 5_000)
    }, opts.budget)
  })
}
