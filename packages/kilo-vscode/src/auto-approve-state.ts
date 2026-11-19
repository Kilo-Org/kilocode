// The persisted auto-approve toggle. One host path owns the write, the broadcast to every open composer, the approval
// sweep notification and the confirmation, so the composer, the keyboard shortcut and the Agent Manager cannot show
// different values.
export type AutoApproveState = {
  /** The stored value. Read at each decision, so a changed value applies without restarting a consumer. */
  read: () => boolean
  /** Writes the value. A store that keeps the old value cancels the broadcast and the confirmation. */
  update: (value: boolean) => PromiseLike<unknown>
  /** Sends the stored value to every open composer. */
  broadcast: (value: boolean) => void
  /** Wakes the host sweep, so requests that are already pending are approved. */
  notify: () => void
  /** The confirmation text for a value. */
  message: (value: boolean) => string
  show: (message: string) => void
}

export function createAutoApproveState(input: AutoApproveState) {
  const set = async (value: boolean) => {
    await input.update(value)
    if (input.read() !== value) return
    input.broadcast(value)
    input.notify()
    input.show(input.message(value))
  }

  return {
    value: input.read,
    toggle: () => set(!input.read()),
    set,
  }
}
